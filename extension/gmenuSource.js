// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {actionMenus} from './actionMenus.js';

const MAX_ITEMS = 512;
const MAX_DEPTH = 12;

// No Shell imports: this adapter is also exercised on an isolated D-Bus bus.
export class GMenuSource {
    constructor(connection, descriptor, changed, translate = text => text) {
        if (!descriptor.busName?.startsWith(':'))
            throw new Error('A unique D-Bus owner is required');
        this._changed = changed;
        this._gettext = translate;
        this._closed = false;
        this._idle = 0;
        this._modelSignals = [];
        this._groupSignals = [];
        this._groups = new Map();
        this._snapshot = [];
        this._applicationMenu = [];
        this._items = new Map();
        this._issuedNodes = new WeakSet();
        this._captured = false;
        this._hiddenMenubar = null;
        this.truncated = false;
        this.descriptor = descriptor;
        this.partial = !descriptor.menuPath && !descriptor.appMenuPath;
        this._model = descriptor.menuPath ? Gio.DBusMenuModel.get(connection,
            descriptor.busName, descriptor.menuPath) : null;
        this._appModel = descriptor.appMenuPath ? Gio.DBusMenuModel.get(connection,
            descriptor.busName, descriptor.appMenuPath) : null;
        for (const [prefix, path] of [['app', descriptor.appPath],
            ['win', descriptor.windowPath]]) {
            if (!path)
                continue;
            const group = Gio.DBusActionGroup.get(connection, descriptor.busName, path);
            this._groups.set(prefix, group);
            for (const signal of ['action-added', 'action-removed',
                'action-enabled-changed', 'action-state-changed']) {
                this._groupSignals.push([group, group.connect(signal, () => this._queue())]);
            }
            group.list_actions(); // Starts the asynchronous remote subscription.
        }
        this._watch = Gio.bus_watch_name_on_connection(connection, descriptor.busName,
            Gio.BusNameWatcherFlags.NONE, () => {}, () => {
                this.destroy();
                changed([], {available: false, truncated: false});
            });
        this._queue();
    }

    get closed() {
        return this._closed;
    }

    get snapshot() {
        return this._snapshot;
    }

    get applicationMenu() {
        return this._applicationMenu;
    }

    _queue() {
        this._items.clear();
        if (this._closed || this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        for (const [object, id] of this._modelSignals)
            object.disconnect(id);
        this._modelSignals = [];
        const watched = new Set();
        let remaining = MAX_ITEMS;
        this.truncated = false;
        const read = (model, path, depth, ancestors) => {
            if (depth > MAX_DEPTH || ancestors.has(model)) {
                this.truncated = true;
                return [];
            }
            if (!watched.has(model)) {
                watched.add(model);
                this._modelSignals.push([model,
                    model.connect('items-changed', () => this._queue())]);
            }
            const branch = new Set(ancestors);
            branch.add(model);
            const items = [];
            const count = model.get_n_items();
            for (let i = 0; i < count; i++) {
                if (remaining-- <= 0) {
                    this.truncated = true;
                    break;
                }
                const attr = name => model.get_item_attribute_value(i, name, null);
                const text = name => {
                    const value = attr(name);
                    return value?.is_of_type(new GLib.VariantType('s')) ? value.unpack() : '';
                };
                const submenu = model.get_item_link(i, 'submenu');
                const section = model.get_item_link(i, 'section');
                const item = {
                    id: `${path}/${i}`,
                    label: text('label'),
                    action: text('action'),
                    target: attr('target'),
                    kind: submenu ? 'submenu' : section ? 'section' : 'item',
                    children: [],
                };
                const resolved = this._resolve(item);
                const hidden = text('hidden-when');
                if ((hidden === 'action-missing' && !resolved.exists) ||
                    (hidden === 'action-disabled' && !resolved.enabled))
                    continue;
                item.enabled = item.action ? resolved.enabled : Boolean(submenu || section);
                item.toggle = resolved.toggle;
                if (submenu || section)
                    item.children = read(submenu || section, item.id, depth + 1, branch);
                items.push(item);
            }
            return items;
        };
        this._applicationMenu = this._appModel ? read(this._appModel, 'app', 0, new Set()) : [];
        const actions = new Set();
        const collect = nodes => {
            for (const node of nodes) {
                if (node.action)
                    actions.add(node.action);
                collect(node.children);
            }
        };
        collect(this._applicationMenu);
        // GTK4 often publishes application actions without an app-menu model.
        // These are explicit exported actions, not invented shortcuts or flags.
        const appGroup = this._groups.get('app');
        const _ = this._gettext;
        for (const [name, title] of [['preferences', _('Preferences…')],
            ['settings', _('Preferences…')], ['about', _('About…')], ['quit', _('Quit')]]) {
            const fullName = `app.${name}`;
            if (actions.has(fullName) || !appGroup?.has_action(name) ||
                appGroup.get_action_parameter_type(name) ||
                (name === 'settings' && actions.has('app.preferences')) ||
                (name === 'preferences' && actions.has('app.settings')))
                continue;
            if (remaining-- <= 0) {
                this.truncated = true;
                break;
            }
            const node = {id: `app-action/${name}`, label: title, action: fullName,
                target: null, kind: 'item', children: []};
            const resolved = this._resolve(node);
            node.enabled = resolved.enabled;
            node.toggle = resolved.toggle;
            this._applicationMenu.push(node);
            actions.add(fullName);
        }
        this._snapshot = this._model ? read(this._model, 'root', 0, new Set()) :
            actionMenus(this.descriptor.applicationId,
                this._resolve.bind(this), this._gettext, this._groups, actions);
        this.partial = !this._model && (!this._appModel || this._snapshot.length > 0);
        if (this._snapshot.some(node => node.id === 'actions/menu/additional' && node.children.length >= 256))
            this.truncated = true;
        const index = nodes => {
            for (const node of nodes) {
                this._items.set(node.id, node);
                this._issuedNodes.add(node);
                index(node.children);
            }
        };
        index(this._applicationMenu);
        index(this._snapshot);
        if (this.truncated)
            this._restoreLocalMenubar();
        else if (this._captured)
            this._hideLocalMenubar();
        this._changed(this._snapshot, {available: true, truncated: this.truncated,
            applicationMenu: this._applicationMenu, partial: this.partial});
    }

    _resolve(item) {
        const dot = item.action.indexOf('.');
        const prefix = item.action.slice(0, dot);
        const name = item.action.slice(dot + 1);
        const group = dot > 0 ? this._groups.get(prefix) : null;
        if (!group?.has_action(name))
            return {exists: false, enabled: false, toggle: null};
        const type = group.get_action_parameter_type(name);
        const validTarget = type ? Boolean(item.target?.is_of_type(type)) : !item.target;
        const state = group.get_action_state(name);
        let toggle = null;
        if (state?.is_of_type(new GLib.VariantType('b')) && !item.target)
            toggle = {type: 'check', checked: state.unpack()};
        else if (state && item.target && state.get_type_string() === item.target.get_type_string())
            toggle = {type: 'radio', checked: state.equal(item.target)};
        return {exists: true, enabled: validTarget && group.get_action_enabled(name),
            acceptsTarget: validTarget, group, name, toggle};
    }

    activate(item) {
        if (this._closed || !item || !this._issuedNodes.has(item))
            return false;
        // A state notification can arrive between drawing an item and its click.
        // Refresh from Gio's cached models, then validate the action identity.
        if (this._idle) {
            GLib.source_remove(this._idle);
            this._idle = 0;
            this._refresh();
        }
        const current = this._items.get(item.id);
        const sameTarget = (!current?.target && !item.target) ||
            (current?.target && item.target && current.target.equal(item.target));
        if (!current || current.action !== item.action || !sameTarget)
            return false;
        const resolved = this._resolve(current);
        if (!resolved.enabled)
            return false;
        resolved.group.activate_action(resolved.name, current.target);
        return true;
    }

    setCaptured(captured) {
        this._captured = captured;
        if (captured)
            this._hideLocalMenubar();
        else
            this._restoreLocalMenubar();
    }

    _hideLocalMenubar() {
        // Only remove a local menubar when its original model is imported and
        // the application exports a window-scoped visibility control.
        if (this._closed || !this._model || !this._snapshot.length || this.truncated)
            return;
        if (this._hiddenMenubar) {
            const {group, name} = this._hiddenMenubar;
            if (group.has_action(name) && group.get_action_enabled(name) &&
                group.get_action_state(name)?.unpack() === true)
                group.change_action_state(name, new GLib.Variant('b', false));
            return;
        }
        const group = this._groups.get('win');
        for (const name of ['show-menubar', 'show-menu-bar', 'menubar-visible']) {
            if (!group?.has_action(name))
                continue;
            const state = group?.get_action_state(name);
            if (!group?.get_action_enabled(name) || state?.get_type_string() !== 'b')
                continue;
            this._hiddenMenubar = {group, name, original: state};
            if (state.unpack())
                group.change_action_state(name, new GLib.Variant('b', false));
            break;
        }
    }

    _restoreLocalMenubar() {
        const hidden = this._hiddenMenubar;
        this._hiddenMenubar = null;
        if (hidden?.group.has_action(hidden.name) &&
            hidden.group.get_action_state(hidden.name)?.get_type_string() === 'b')
            hidden.group.change_action_state(hidden.name, hidden.original);
    }

    destroy() {
        if (this._closed)
            return;
        this._restoreLocalMenubar();
        this._closed = true;
        if (this._idle)
            GLib.source_remove(this._idle);
        this._idle = 0;
        if (this._watch)
            Gio.bus_unwatch_name(this._watch);
        this._watch = 0;
        for (const [object, id] of [...this._modelSignals, ...this._groupSignals])
            object.disconnect(id);
        this._modelSignals = [];
        this._groupSignals = [];
        this._groups.clear();
        this._items.clear();
        this._issuedNodes = null;
        this._model = null;
        this._appModel = null;
        this._snapshot = [];
        this._applicationMenu = [];
        this._changed = null;
        this._gettext = null;
    }
}
