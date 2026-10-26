// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const INTERFACE = 'com.canonical.dbusmenu';
const MAX_ITEMS = 512;
const MAX_DEPTH = 12;
const PROPERTIES = ['label', 'enabled', 'visible', 'type', 'children-display',
    'toggle-type', 'toggle-state'];

// Transport adapter only. A registrar entry/tray menu does NOT establish which
// Mutter window owns this source. Discovery must establish that separately.
export class DBusMenuSource {
    constructor(connection, descriptor, changed) {
        if (!descriptor.busName?.startsWith(':'))
            throw new Error('A unique D-Bus owner is required');
        this.descriptor = descriptor;
        this._connection = connection;
        this._changed = changed;
        this._cancellable = new Gio.Cancellable();
        this._closed = false;
        this._serial = 0;
        this._idle = 0;
        this._loading = false;
        this._dirty = false;
        this._snapshot = [];
        this._items = new Map();
        this.truncated = false;
        this._subscriptions = ['LayoutUpdated', 'ItemsPropertiesUpdated'].map(signal =>
            connection.signal_subscribe(descriptor.busName, INTERFACE, signal,
                descriptor.menuPath, null, Gio.DBusSignalFlags.NONE, () => this._invalidate()));
        this._watch = Gio.bus_watch_name_on_connection(connection, descriptor.busName,
            Gio.BusNameWatcherFlags.NONE, () => {}, () => {
                this.destroy();
                changed([], {available: false, truncated: false, applicationMenu: []});
            });
        this._invalidate();
    }

    get closed() {
        return this._closed;
    }

    get snapshot() {
        return this._snapshot;
    }

    get applicationMenu() {
        return [];
    }

    _call(method, parameters, replyType) {
        return new Promise((resolve, reject) => {
            this._connection.call(this.descriptor.busName, this.descriptor.menuPath,
                INTERFACE, method, parameters, new GLib.VariantType(replyType),
                Gio.DBusCallFlags.NO_AUTO_START, 1500, this._cancellable, (bus, result) => {
                    try {
                        resolve(bus.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    _invalidate() {
        if (this._closed)
            return;
        ++this._serial;
        this._dirty = true;
        // Any old actor becomes non-actionable as soon as an update is announced.
        this._items.clear();
        this._queue();
    }

    _queue() {
        if (this._closed || this._idle || this._loading || !this._dirty)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._load();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _load() {
        const serial = this._serial;
        this._loading = true;
        this._dirty = false;
        try {
            const reply = await this._call('GetLayout',
                new GLib.Variant('(iias)', [0, MAX_DEPTH, PROPERTIES]), '(u(ia{sv}av))');
            if (this._closed || serial !== this._serial)
                return;
            this.revision = reply.get_child_value(0).get_uint32();
            const layout = reply.get_child_value(1);
            const index = new Map();
            let remaining = MAX_ITEMS;
            this.truncated = false;
            const readChildren = (children, depth) => {
                const result = [];
                for (let i = 0; i < children.n_children(); i++) {
                    if (remaining-- <= 0 || depth >= MAX_DEPTH) {
                        this.truncated = true;
                        break;
                    }
                    const tuple = children.get_child_value(i).get_variant();
                    const remoteId = tuple.get_child_value(0).get_int32();
                    if (remoteId <= 0 || index.has(`dbus:${remoteId}`))
                        throw new Error('Invalid or duplicate DBusMenu item ID');
                    const properties = tuple.get_child_value(1).deep_unpack();
                    const property = (name, type, fallback) => {
                        const value = properties[name];
                        return value?.is_of_type(new GLib.VariantType(type)) ? value.unpack() : fallback;
                    };
                    if (!property('visible', 'b', true))
                        continue;
                    const descendants = tuple.get_child_value(2);
                    const submenu = property('children-display', 's', '') === 'submenu' ||
                        descendants.n_children() > 0;
                    const toggleType = property('toggle-type', 's', '');
                    const toggleState = property('toggle-state', 'i', 0);
                    const node = {
                        id: `dbus:${remoteId}`, remoteId,
                        label: property('label', 's', '').slice(0, 2048),
                        kind: property('type', 's', '') === 'separator' ? 'separator' :
                            submenu ? 'submenu' : 'item',
                        enabled: property('enabled', 'b', true),
                        action: '', target: null, children: [],
                        toggle: ['checkmark', 'radio'].includes(toggleType) ? {
                            type: toggleType === 'radio' ? 'radio' : 'check',
                            checked: toggleState === 1,
                            indeterminate: toggleState === -1,
                        } : null,
                    };
                    index.set(node.id, node);
                    node.children = readChildren(descendants, depth + 1);
                    if (depth + 1 >= MAX_DEPTH && submenu)
                        this.truncated = true;
                    result.push(node);
                }
                return result;
            };
            this._snapshot = readChildren(layout.get_child_value(2), 0);
            this._items = index;
            this._changed(this._snapshot, {available: true, truncated: this.truncated,
                applicationMenu: []});
        } catch (error) {
            if (!this._closed && serial === this._serial) {
                this._snapshot = [];
                this._items.clear();
                this._changed([], {available: false, truncated: false,
                    applicationMenu: [], error: error.message});
            }
        } finally {
            this._loading = false;
            this._queue();
        }
    }

    _current(item) {
        return !this._closed && item && this._items.get(item.id) === item;
    }

    _event(id, name, timestamp) {
        return this._call('Event', new GLib.Variant('(isvu)',
            [id, name, new GLib.Variant('i', 0), timestamp >>> 0]), '()');
    }

    activate(item, timestamp = 0) {
        if (!this._current(item) || !item.enabled || item.kind !== 'item')
            return false;
        this._event(item.remoteId, 'clicked', timestamp).catch(() => {});
        return true;
    }

    async prepare(item) {
        if (!this._current(item) || !item.enabled || item.kind !== 'submenu')
            return false;
        try {
            const reply = await this._call('AboutToShow', new GLib.Variant('(i)',
                [item.remoteId]), '(b)');
            if (this._closed)
                return false;
            // The server may also have invalidated the layout while preparing.
            if (reply.get_child_value(0).get_boolean())
                this._invalidate();
            await this._event(item.remoteId, 'opened', 0);
            return !this._closed;
        } catch {
            return false;
        }
    }

    close(item) {
        if (this._current(item) && item.kind === 'submenu')
            this._event(item.remoteId, 'closed', 0).catch(() => {});
    }

    destroy() {
        if (this._closed)
            return;
        this._closed = true;
        this._cancellable.cancel();
        if (this._idle)
            GLib.source_remove(this._idle);
        this._idle = 0;
        Gio.bus_unwatch_name(this._watch);
        for (const id of this._subscriptions)
            this._connection.signal_unsubscribe(id);
        this._subscriptions = [];
        this._snapshot = [];
        this._items.clear();
        this._changed = null;
    }
}
