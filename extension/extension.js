// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Clutter from 'gi://Clutter';
import Atk from 'gi://Atk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {GMenuSource} from './gmenuSource.js';
import {FilesDesktopSource} from './filesDesktopSource.js';
import {sourceForWindow} from './windowSource.js';

function label(text) {
    return text.replace(/__|_/g, match => match === '__' ? '_' : '').slice(0, 200);
}

function flatten(items) {
    return items.flatMap(item => item.kind === 'section' ? flatten(item.children) : [item]);
}

function structure(items) {
    return JSON.stringify(items, (key, value) => {
        if (['enabled', 'toggle'].includes(key))
            return undefined;
        return key === 'target' && value ? value.print(true) : value;
    });
}

export default class GnoMenu extends Extension {
    enable() {
        this._enabled = true;
        this._buttons = [];
        this._buttonPool = [];
        this._bindings = [];
        this._menus = [];
        this._pendingOpenMenus = null;
        this._emptyMenuEpoch = null;
        this._windowSignals = [];
        this._window = null;
        this._focusedWindow = null;
        this._source = null;
        this._focusEntry = null;
        this._filesEntry = null;
        this._lastFilesWindow = null;
        this._desktopMode = true;
        this._unmanagedWindows = new WeakSet();
        this._epoch = 0;
        this._renderId = 0;
        this._focusId = 0;
        this._restoreId = 0;
        this._rendering = false;
        this._restoringMenus = false;
        this._renderedEpoch = null;
        this._tree = [];
        this._appTree = [];
        this._partial = false;
        this._signature = null;
        this._status = _('No menu available');
        const files = Shell.AppSystem.get_default().lookup_app('org.gnome.Nautilus.desktop');
        this._desktopSource = files ? new FilesDesktopSource(Gio.DBus.session, {
            openWindow: () => files.open_new_window(-1),
            openHome: () => files.app_info.launch_uris([
                Gio.File.new_for_path(GLib.get_home_dir()).get_uri()], global.create_app_launch_context(0, -1)),
        }, () => this._presentSource(), this.gettext.bind(this)) : null;
        this._displaySignal = global.display.connect('notify::focus-window', () => this._syncFocus());
        this._createdSignal = global.display.connect('window-created', () => this._queueFocus());
        this._appSignal = Shell.AppSystem.get_default().connect('app-state-changed', () => this._queueFocus());
        this._panelDestroySignal = Main.panel.connect('destroy', () => this.disable());
        this._syncFocus();
    }

    disable() {
        if (!this._enabled)
            return;
        this._enabled = false;
        Main.panel.disconnect(this._panelDestroySignal);
        this._panelDestroySignal = 0;
        ++this._epoch;
        global.display.disconnect(this._displaySignal);
        global.display.disconnect(this._createdSignal);
        Shell.AppSystem.get_default().disconnect(this._appSignal);
        for (const [object, id] of this._windowSignals)
            object.disconnect(id);
        this._windowSignals = [];
        for (const entry of new Set([this._focusEntry, this._filesEntry]))
            entry?.source.destroy();
        this._focusEntry = this._filesEntry = null;
        this._desktopSource?.destroy();
        this._desktopSource = null;
        this._lastFilesWindow = null;
        this._unmanagedWindows = null;
        this._source = null;
        this._rendering = true;
        this._clearButtons();
        for (const id of [this._renderId, this._focusId, this._restoreId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._renderId = this._focusId = this._restoreId = 0;
        this._window = null;
        this._focusedWindow = null;
        this._tree = [];
        this._appTree = [];
        this._signature = null;
        this._partial = false;
        this._status = null;
        this._pendingOpenMenus = null;
        this._emptyMenuEpoch = null;
    }

    _syncFocus() {
        if (!this._enabled)
            return;
        const window = global.display.focus_window;
        // A Shell popup can temporarily take keyboard focus away from its client.
        if (!window && (this._rendering || this._buttons.some(button => button.menu.isOpen)))
            return;
        this._focusedWindow = window && !this._unmanagedWindows.has(window) ? window : null;
        const windows = global.get_window_actors().map(actor => actor.meta_window)
            .filter(candidate => !this._unmanagedWindows.has(candidate));
        const files = windows.filter(candidate => candidate.get_gtk_application_id() === 'org.gnome.Nautilus');
        if (files.includes(window))
            this._lastFilesWindow = window;
        if (!files.includes(this._lastFilesWindow))
            this._lastFilesWindow = files.sort((a, b) => b.get_stable_sequence() - a.get_stable_sequence())[0] ?? null;
        const previous = new Set([this._focusEntry, this._filesEntry]);
        const entryFor = target => {
            if (!target || this._unmanagedWindows.has(target))
                return null;
            const descriptor = sourceForWindow(target);
            if (!descriptor)
                return null;
            const key = JSON.stringify([target.get_stable_sequence(), descriptor]);
            const existing = [...previous].find(entry => entry?.key === key && !entry.source.closed);
            if (existing)
                return existing;
            const entry = {key, window: target, tree: [], info: {}, source: null};
            entry.source = new GMenuSource(Gio.DBus.session, descriptor, (tree, info) => {
                entry.tree = tree;
                entry.info = info;
                if (entry === this._focusEntry || entry === this._filesEntry)
                    this._presentSource();
            }, this.gettext.bind(this));
            return entry;
        };
        this._focusEntry = entryFor(window);
        this._filesEntry = window === this._lastFilesWindow ? this._focusEntry : entryFor(this._lastFilesWindow);
        for (const entry of previous) {
            if (entry && entry !== this._focusEntry && entry !== this._filesEntry)
                entry.source.destroy();
        }
        for (const [object, id] of this._windowSignals)
            object.disconnect(id);
        this._windowSignals = [];
        for (const target of windows) {
            this._windowSignals.push([target, target.connect('unmanaged', () => {
                this._unmanagedWindows.add(target);
                if (this._focusedWindow === target)
                    this._focusedWindow = null;
                // Drop the displayed source immediately; the actor can remain
                // in get_window_actors() until its closing animation finishes.
                for (const entry of [this._focusEntry, this._filesEntry]) {
                    if (entry?.window === target)
                        entry.source.destroy();
                }
                if (this._lastFilesWindow === target)
                    this._lastFilesWindow = null;
                this._presentSource();
                this._queueFocus();
            })]);
            for (const property of ['gtk-unique-bus-name', 'gtk-application-id', 'gtk-menubar-object-path',
                'gtk-app-menu-object-path', 'gtk-application-object-path', 'gtk-window-object-path', 'title']) {
                this._windowSignals.push([target,
                    target.connect(`notify::${property}`, () => this._queueFocus())]);
            }
        }
        this._presentSource();
    }

    _presentSource() {
        if (!this._enabled)
            return;
        const usable = entry => entry && !entry.source.closed &&
            (entry.tree.length || entry.info.applicationMenu?.length ||
                (entry.info.available && entry.source.descriptor.menuPath));
        const focused = this._focusedWindow;
        const entry = focused ? (usable(this._focusEntry) ? this._focusEntry : null) :
            usable(this._filesEntry) ? this._filesEntry : null;
        const source = entry?.source ?? (focused ? null : this._desktopSource);
        const window = focused ?? entry?.window ?? null;
        if (this._source !== source || this._window !== window) {
            this._source?.setCaptured(false);
            ++this._epoch;
            this._source = source;
            source?.setCaptured(true);
        }
        this._window = window;
        this._desktopMode = !focused;
        this._tree = entry?.tree ?? source?.snapshot ?? [];
        this._appTree = entry?.info.applicationMenu ?? source?.applicationMenu ?? [];
        this._partial = Boolean(entry?.info.partial ?? source?.partial);
        this._status = entry?.info.truncated ? _('Some menu items could not be displayed') : _('No menu available');
        this._queueRender();
    }

    _queueRender() {
        if (!this._enabled || this._renderId)
            return;
        this._renderId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._renderId = 0;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueFocus() {
        if (!this._enabled || this._focusId || this._rendering)
            return;
        this._focusId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._focusId = 0;
            this._syncFocus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _button(text, index) {
        const cached = this._buttonPool[index];
        if (cached) {
            cached.get_first_child().text = text;
            cached.accessible_name = text;
            cached.setSensitive(true);
            cached.container.show();
            cached.show();
            this._buttons.push(cached);
            return cached;
        }
        const button = new PanelMenu.Button(0, text);
        // PopupMenu's default source anchor is the centre of the title. For a
        // menubar, anchor its leading edge to the popup's leading edge instead.
        const align = () => {
            const direction = button.text_direction;
            button.menu.actor.text_direction = direction;
            button.menu.setSourceAlignment(direction === Clutter.TextDirection.RTL ? 1 : 0);
        };
        align();
        button.connect('notify::text-direction', align);
        button.add_style_class_name('gnomenu-button');
        if (index === 0)
            button.add_style_class_name('gnomenu-application-button');
        button.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        // PanelMenu constrains the popup to the monitor work area. Give its
        // content a scrollable allocation so imported commands remain reachable.
        button.menu._boxPointer.bin.set_child(null);
        button.menu._boxPointer.bin.set_child(new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: button.menu.box,
        }));
        button.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this._queueFocus();
        });
        Main.panel.addToStatusArea(`${this.uuid}-${index}`, button, index + 1, 'left');
        this._buttons.push(button);
        this._buttonPool[index] = button;
        button.connect('destroy', () => {
            this._buttons = this._buttons.filter(candidate => candidate !== button);
        });
        return button;
    }

    _render() {
        if (!this._enabled)
            return;
        const app = this._window ? Shell.WindowTracker.get_default().get_window_app(this._window) :
            Shell.AppSystem.get_default().lookup_app('org.gnome.Nautilus.desktop');
        const appName = app?.get_name() || this._window?.get_wm_class() || this._window?.title || _('Desktop');
        const signature = `${this._epoch}:${appName}:${this._partial}:${this._status}:${structure([this._appTree, this._tree])}`;
        if (signature === this._signature) {
            this._updateBindings();
            return;
        }
        this._signature = signature;
        const sameSource = this._renderedEpoch === this._epoch;
        const openNow = sameSource ? this._menus.filter(entry => entry.menu.isOpen).map(entry => entry.key) : [];
        const now = GLib.get_monotonic_time();
        const pending = this._pendingOpenMenus;
        if (!pending || pending.epoch !== this._epoch || pending.deadline < now)
            this._pendingOpenMenus = {epoch: this._epoch, keys: openNow, deadline: now + 500000};
        else
            pending.keys = [...new Set([...pending.keys, ...openNow])];
        const roots = flatten(this._tree);
        const headings = roots.filter(item => item.kind === 'submenu');
        const leaves = roots.filter(item => item.kind !== 'submenu');
        const appItems = [...this._appTree, ...leaves];
        if (roots.length || appItems.length)
            this._emptyMenuEpoch = null;
        // Remote GMenu groups subscribe separately. Do not destroy an open
        // popup while its replacement model is still arriving in another group.
        if (sameSource && !roots.length && !appItems.length && this._buttons.length > 1 && this._emptyMenuEpoch !== this._epoch &&
            this._pendingOpenMenus.deadline > now && this._source?.descriptor?.menuPath) {
            this._signature = null;
            for (const {actor} of this._bindings) {
                if (actor._menuLabNode?.kind === 'item')
                    actor.setSensitive(false);
            }
            this._restoreOpenMenus();
            return;
        }
        // Never transfer an open menu to another window during a focus change.
        this._renderedEpoch = this._epoch;
        this._rendering = true;
        try {
            const columns = [{label: appName, children: appItems},
                ...headings.map(item => ({label: label(item.label), children: item.children, node: item}))];
            // Avoid letting an unexpected model create unbounded panel actors.
            if (columns.length > 10) {
                const overflow = headings.slice(8);
                columns.splice(9, columns.length - 9, {label: _('More'), children: overflow});
            }
            this._clearMenuBindings();
            this._buttons = [];
            const activeCount = columns.length + (this._source?.truncated ? 1 : 0);
            for (const [index, button] of this._buttonPool.entries()) {
                button.menu.removeAll();
                if (index >= activeCount) {
                    button.hide();
                    button.container.hide();
                }
            }
            columns.forEach((column, index) => {
                const button = this._button(column.label || _('Menu'), index);
                this._watchSubmenu(button.menu, column.node, index === 0 ? 'application' : 'overflow', null, button);
                button.setSensitive(column.node?.enabled ?? true);
                this._fill(button.menu, column.children);
                if (!column.children.length)
                    button.menu.addMenuItem(new PopupMenu.PopupMenuItem(roots.length ?
                        _('Application actions unavailable') : this._status, {reactive: false}));
                if (index === 0 && this._partial && (appItems.length || roots.length)) {
                    button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    button.menu.addMenuItem(new PopupMenu.PopupMenuItem(_('Partial menu'),
                        {reactive: false}));
                }
            });
            if (this._source?.truncated) {
                const warning = this._button(_('Incomplete menu'), columns.length);
                warning.menu.addMenuItem(new PopupMenu.PopupMenuItem(this._status,
                    {reactive: false}));
            }
            this._updateBindings();
            if (sameSource)
                this._restoreOpenMenus();
        } finally {
            this._rendering = false;
        }
    }

    _fill(menu, nodes) {
        for (const node of nodes) {
            if (node.kind === 'section') {
                if (menu.numMenuItems && node.children.length)
                    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(label(node.label)));
                this._fill(menu, node.children);
                continue;
            }
            let item;
            if (node.kind === 'submenu') {
                item = new PopupMenu.PopupSubMenuMenuItem(label(node.label));
                this._watchSubmenu(item.menu, node, null, menu);
                this._fill(item.menu, node.children);
                // Shell refuses to open an empty submenu. Keep it openable so
                // its native submenu-action can populate the actual contents.
                if (!node.children.length)
                    item.menu.addMenuItem(new PopupMenu.PopupMenuItem(_('Application actions unavailable'), {reactive: false}));
            } else {
                item = new PopupMenu.PopupMenuItem(label(node.label));
                // Capture source lifetime, not a mutable global current-window pointer.
                const source = this._source;
                item.connect('activate', () => source?.activate(item._menuLabNode));
            }
            menu.addMenuItem(item);
            const binding = {id: node.id, actor: item};
            this._bindings.push(binding);
            item.connect('destroy', () => {
                this._bindings = this._bindings.filter(entry => entry !== binding);
            });
        }
    }

    _updateBindings() {
        const byId = new Map();
        const visit = nodes => {
            for (const node of nodes) {
                byId.set(node.id, node);
                visit(node.children);
            }
        };
        visit(this._tree);
        visit(this._appTree);
        for (const entry of this._menus) {
            if (entry.node)
                entry.node = byId.get(entry.node.id) ?? entry.node;
            if (entry.actor && entry.node)
                entry.actor.setSensitive(entry.node.enabled);
            if (entry.menu.isOpen && !entry.prepared)
                entry.prepared = Boolean(entry.source?.prepare?.(entry.node));
        }
        for (const {id, actor} of this._bindings) {
            const node = byId.get(id);
            actor._menuLabNode = node;
            actor.setSensitive(Boolean(node?.enabled));
            const toggle = node?.toggle;
            actor.accessible_role = !toggle ? Atk.Role.MENU_ITEM :
                toggle.type === 'radio' ? Atk.Role.RADIO_MENU_ITEM : Atk.Role.CHECK_MENU_ITEM;
            actor.setOrnament(!toggle ? PopupMenu.Ornament.HIDDEN :
                toggle.type === 'radio' ?
                    (toggle.checked ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT) :
                    (toggle.checked ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE));
        }
    }

    _clearButtons() {
        const buttons = this._buttonPool;
        this._buttonPool = [];
        this._buttons = [];
        this._clearMenuBindings();
        for (const button of buttons)
            button.destroy();
    }

    _clearMenuBindings() {
        this._bindings = [];
        const menus = this._menus;
        this._menus = [];
        for (const entry of menus.reverse()) {
            entry.menu.close();
            entry.menu.disconnect(entry.signal);
            entry.menu.actor.disconnect(entry.destroySignal);
        }
    }

    _watchSubmenu(menu, node, fallback, parent = null, actor = null) {
        const entry = {menu, node, source: this._source, prepared: false,
            parent, actor, key: node ? `${node.id}\u0000${node.label}` : fallback};
        this._menus.push(entry);
        entry.destroySignal = menu.actor.connect('destroy', () => {
            this._menus = this._menus.filter(candidate => candidate !== entry);
        });
        entry.signal = menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                if (!this._rendering && !this._restoringMenus) {
                    this._pendingOpenMenus = {epoch: this._epoch,
                        keys: this._menus.filter(candidate => candidate.menu.isOpen).map(candidate => candidate.key),
                        deadline: GLib.get_monotonic_time() + 500000};
                }
                entry.prepared = Boolean(entry.source?.prepare?.(entry.node));
            } else {
                if (entry.prepared)
                    entry.source?.close?.(entry.node);
                entry.prepared = false;
                if (!this._rendering && this._pendingOpenMenus?.epoch === this._epoch) {
                    this._pendingOpenMenus.keys = entry.parent ? this._pendingOpenMenus.keys.filter(key =>
                        key !== entry.key && !key.startsWith(`${entry.node.id}/`)) : [];
                }
            }
        });
    }

    _restoreOpenMenus() {
        if (this._restoreId)
            GLib.source_remove(this._restoreId);
        // New popup anchors need an allocation before BoxPointer positions the
        // menu. Nested menus also wait for their parent popup's allocation.
        this._restoreId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            const pending = this._pendingOpenMenus;
            const waitingEmpty = this._source?.descriptor?.menuPath && this._buttons.length > 1 &&
                !flatten(this._tree).length && !this._appTree.length && this._emptyMenuEpoch !== this._epoch;
            if (!pending || (!pending.keys.length && !waitingEmpty) || pending.epoch !== this._epoch || pending.deadline < GLib.get_monotonic_time()) {
                this._restoreId = 0;
                if (pending?.epoch === this._epoch && pending.deadline < GLib.get_monotonic_time()) {
                    pending.keys = [];
                    if (!flatten(this._tree).length && !this._appTree.length) {
                        this._emptyMenuEpoch = this._epoch;
                        for (const entry of this._menus)
                            entry.menu.close();
                        this._queueRender();
                    }
                }
                return GLib.SOURCE_REMOVE;
            }
            const allocated = actor => actor?.mapped && actor.has_allocation() && actor.width > 0 && actor.height > 0;
            this._restoringMenus = true;
            try {
                for (const key of pending.keys) {
                    const entry = this._menus.find(candidate => candidate.key === key);
                    if (!entry || entry.menu.isOpen || (entry.node && !entry.node.enabled) ||
                        !allocated(entry.menu.sourceActor) ||
                        (entry.parent && (!entry.parent.isOpen || !allocated(entry.parent.actor))))
                        continue;
                    entry.menu.open();
                }
            } finally {
                this._restoringMenus = false;
            }
            if (pending.keys.every(key => this._menus.some(entry => entry.key === key && entry.menu.isOpen))) {
                this._restoreId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

}
