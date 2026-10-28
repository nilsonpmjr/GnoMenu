// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
// Experimental companion transport; not installed or started by the extension.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {DBusMenuSource} from '../extension/dbusmenuSource.js';

export class DBusMenuBridge {
    constructor(connection, descriptor, paths, changed = () => {}) {
        this._bus = connection;
        this._closed = false;
        this._generation = 0;
        this._changed = changed;
        this._menu = new Gio.Menu();
        this._actions = new Gio.SimpleActionGroup();
        this._exports = [];
        this.descriptor = {busName: connection.get_unique_name(), menuPath: paths.menuPath,
            windowPath: paths.actionPath};
        try {
            this._exports.push(['menu', connection.export_menu_model(paths.menuPath, this._menu)]);
            this._exports.push(['actions', connection.export_action_group(paths.actionPath, this._actions)]);
            this._source = new DBusMenuSource(connection, descriptor, (tree, info) => this._refresh(tree, info));
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    _refresh(tree, info) {
        if (this._closed)
            return;
        const generation = ++this._generation;
        // New action names on every native snapshot ensure queued old commands
        // cannot address a reused item ID after layout replacement.
        for (const name of this._actions.list_actions())
            this._actions.remove_action(name);
        this._menu.remove_all();
        if (!info.available || info.truncated) {
            this._changed({available: false, truncated: Boolean(info.truncated), error: info.error});
            return;
        }
        const actionFor = (node, submenu, ancestorsEnabled) => {
            const name = `g${generation}n${node.remoteId}`;
            const options = {name, enabled: node.enabled && ancestorsEnabled && !node.toggle?.indeterminate};
            if (submenu || node.toggle?.type === 'check')
                options.state = new GLib.Variant('b', submenu ? false : node.toggle.checked);
            else if (node.toggle?.type === 'radio') {
                options.state = new GLib.Variant('s', node.toggle.checked ? 'selected' : 'unselected');
                options.parameter_type = new GLib.VariantType('s');
            }
            const action = new Gio.SimpleAction(options);
            if (submenu) {
                let preparing = false;
                let requestedOpen = false;
                action.connect('change-state', (_action, value) => {
                    if (this._closed || generation !== this._generation || value.get_type_string() !== 'b')
                        return;
                    requestedOpen = value.get_boolean();
                    if (value.get_boolean()) {
                        if (preparing)
                            return;
                        preparing = true;
                        this._source.prepare(node).then(prepared => {
                            if (prepared && !this._closed && generation === this._generation) {
                                if (!requestedOpen)
                                    this._source.close(node);
                                action.set_state(new GLib.Variant('b', requestedOpen));
                            }
                        }).finally(() => { preparing = false; });
                    } else {
                        this._source.close(node);
                        action.set_state(value);
                    }
                });
            } else {
                // Keep advertised toggle state authoritative. Never optimistically
                // flip it: some native Electron exporters announce stale values.
                action.connect('activate', () => {
                    if (!this._closed && generation === this._generation)
                        this._source.activate(node);
                });
                if (node.toggle)
                    action.connect('change-state', () => {});
            }
            this._actions.add_action(action);
            return `win.${name}`;
        };
        const append = (model, nodes, ancestorsEnabled = true) => {
            let section = new Gio.Menu();
            const sections = nodes.some(node => node.kind === 'separator');
            const flush = () => {
                if (section.get_n_items())
                    model.append_section(null, section);
                section = new Gio.Menu();
            };
            for (const node of nodes) {
                if (node.kind === 'separator') {
                    flush();
                    continue;
                }
                const item = Gio.MenuItem.new(node.label, null);
                if (node.kind === 'submenu') {
                    const child = new Gio.Menu();
                    append(child, node.children, ancestorsEnabled && node.enabled);
                    item.set_submenu(child);
                    item.set_attribute_value('submenu-action', new GLib.Variant('s', actionFor(node, true, ancestorsEnabled)));
                } else {
                    const action = actionFor(node, false, ancestorsEnabled);
                    item.set_action_and_target_value(action, node.toggle?.type === 'radio' ?
                        new GLib.Variant('s', 'selected') : null);
                    if (node.toggle?.indeterminate)
                        item.set_attribute_value('x-gnomenu-indeterminate', new GLib.Variant('b', true));
                }
                (sections ? section : model).append_item(item);
            }
            if (sections)
                flush();
        };
        append(this._menu, tree);
        this._changed({available: true, truncated: false});
    }

    destroy() {
        if (this._closed)
            return;
        this._closed = true;
        this._source?.destroy();
        this._menu.remove_all();
        for (const name of this._actions.list_actions())
            this._actions.remove_action(name);
        for (const [kind, id] of this._exports) {
            if (kind === 'menu')
                this._bus.unexport_menu_model(id);
            else
                this._bus.unexport_action_group(id);
        }
        this._exports = [];
    }
}
