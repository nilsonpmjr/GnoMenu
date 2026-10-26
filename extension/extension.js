// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {GMenuSource} from './gmenuSource.js';
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
        this._buttons = [];
        this._bindings = [];
        this._windowSignals = [];
        this._window = null;
        this._source = null;
        this._descriptorKey = '';
        this._epoch = 0;
        this._renderId = 0;
        this._focusId = 0;
        this._rendering = false;
        this._tree = [];
        this._appTree = [];
        this._partial = false;
        this._signature = null;
        this._status = _('No menu available');
        this._displaySignal = global.display.connect('notify::focus-window', () => this._syncFocus());
        this._syncFocus();
    }

    disable() {
        ++this._epoch;
        global.display.disconnect(this._displaySignal);
        for (const [object, id] of this._windowSignals)
            object.disconnect(id);
        this._windowSignals = [];
        this._source?.destroy();
        this._source = null;
        this._rendering = true;
        this._clearButtons();
        for (const id of [this._renderId, this._focusId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._renderId = this._focusId = 0;
        this._window = null;
        this._tree = [];
        this._appTree = [];
        this._signature = null;
        this._descriptorKey = '';
        this._partial = false;
        this._status = null;
    }

    _syncFocus() {
        const window = global.display.focus_window;
        // A Shell popup can temporarily take keyboard focus away from its client.
        if (!window && (this._rendering || this._buttons.some(button => button.menu.isOpen)))
            return;
        if (this._window !== window) {
            for (const [object, id] of this._windowSignals)
                object.disconnect(id);
            this._windowSignals = [];
            this._window = window;
            if (window) {
                this._windowSignals.push([window, window.connect('unmanaged', () => {
                    for (const [object, id] of this._windowSignals)
                        object.disconnect(id);
                    this._windowSignals = [];
                    this._window = null;
                    this._selectSource(null);
                })]);
                for (const property of ['gtk-unique-bus-name', 'gtk-application-id', 'gtk-menubar-object-path',
                    'gtk-app-menu-object-path', 'gtk-application-object-path',
                    'gtk-window-object-path']) {
                    this._windowSignals.push([window,
                        window.connect(`notify::${property}`, () => this._syncFocus())]);
                }
            }
        }
        this._selectSource(sourceForWindow(window));
    }

    _selectSource(descriptor) {
        const key = JSON.stringify([this._window?.get_stable_sequence(), descriptor]);
        if (this._descriptorKey === key)
            return;
        this._descriptorKey = key;
        const epoch = ++this._epoch;
        this._source?.destroy();
        this._source = null;
        this._tree = [];
        this._appTree = [];
        this._partial = false;
        this._signature = null;
        this._status = descriptor ? _('Loading menu…') : _('No menu available');
        this._queueRender();
        if (!descriptor)
            return;
        this._source = new GMenuSource(Gio.DBus.session, descriptor, (tree, info) => {
            if (epoch !== this._epoch)
                return;
            this._tree = tree;
            this._appTree = info.applicationMenu ?? [];
            this._partial = Boolean(info.partial);
            this._status = !info.available ? _('Application disconnected') :
                info.truncated ? _('Some menu items could not be displayed') :
                    info.partial && !tree.length && !this._appTree.length ? _('No menu available') : _('No menu items available');
            this._queueRender();
        }, this.gettext.bind(this));
    }

    _queueRender() {
        if (this._renderId)
            return;
        this._renderId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._renderId = 0;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueFocus() {
        if (this._focusId || this._rendering)
            return;
        this._focusId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._focusId = 0;
            this._syncFocus();
            return GLib.SOURCE_REMOVE;
        });
    }

    _button(text, index) {
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
        button.menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this._queueFocus();
        });
        Main.panel.addToStatusArea(`${this.uuid}-${index}`, button, index + 1, 'left');
        this._buttons.push(button);
        return button;
    }

    _render() {
        const app = this._window && Shell.WindowTracker.get_default().get_window_app(this._window);
        const appName = app?.get_name() || this._window?.get_wm_class() || 'GnoMenu';
        const signature = `${this._epoch}:${appName}:${this._partial}:${this._status}:${structure([this._appTree, this._tree])}`;
        if (signature === this._signature) {
            this._updateBindings();
            return;
        }
        this._signature = signature;
        const openIndex = this._buttons.findIndex(button => button.menu.isOpen);
        // Never transfer an open menu to another window during a focus change.
        const sameSource = this._renderedEpoch === this._epoch;
        this._renderedEpoch = this._epoch;
        this._rendering = true;
        try {
            this._clearButtons();
            const roots = flatten(this._tree);
            const headings = roots.filter(item => item.kind === 'submenu');
            const leaves = roots.filter(item => item.kind !== 'submenu');
            const appItems = [...this._appTree, ...leaves];
            const columns = [{label: appName, children: appItems},
                ...headings.map(item => ({label: label(item.label), children: item.children}))];
            // Avoid letting an unexpected model create unbounded panel actors.
            if (columns.length > 10) {
                const overflow = headings.slice(8);
                columns.splice(9, columns.length - 9, {label: _('More'), children: overflow});
            }
            columns.forEach((column, index) => {
                const button = this._button(column.label || _('Menu'), index);
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
            if (sameSource && openIndex >= 0)
                this._buttons[openIndex]?.menu.open();
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
                this._fill(item.menu, node.children);
            } else {
                item = new PopupMenu.PopupMenuItem(label(node.label));
                // Capture source lifetime, not a mutable global current-window pointer.
                const source = this._source;
                item.connect('activate', () => source?.activate(item._menuLabNode));
            }
            menu.addMenuItem(item);
            this._bindings.push({id: node.id, actor: item});
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
        for (const {id, actor} of this._bindings) {
            const node = byId.get(id);
            actor._menuLabNode = node;
            actor.setSensitive(Boolean(node?.enabled));
            const toggle = node?.toggle;
            actor.setOrnament(!toggle ? PopupMenu.Ornament.HIDDEN :
                toggle.type === 'radio' ?
                    (toggle.checked ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT) :
                    (toggle.checked ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE));
        }
    }

    _clearButtons() {
        for (const button of this._buttons)
            button.destroy();
        this._buttons = [];
        this._bindings = [];
    }

}
