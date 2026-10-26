// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAME = 'com.canonical.AppMenu.Registrar';
const PATH = '/com/canonical/AppMenu/Registrar';

// Resolves explicitly supplied X11 window IDs. Does not infer a Wayland surface
// from a PID, title, zero ID, tray menu, or another application's registration.
export class AppMenuDiscovery {
    constructor(connection, changed) {
        this._bus = connection;
        this._changed = changed;
        this._closed = false;
        this._windowId = null;
        this._owner = null;
        this._generation = 0;
        this._pending = null;
        this._subscriptions = [];
        this._key = undefined;
        this._watch = Gio.bus_watch_name_on_connection(connection, NAME,
            Gio.BusNameWatcherFlags.NONE, (_bus, _name, owner) => this._registrarChanged(owner),
            () => this._registrarChanged(null));
    }

    setWindowId(windowId) {
        const valid = Number.isInteger(windowId) && windowId > 0 && windowId <= 0xffffffff;
        const next = valid ? windowId : null;
        if (next === this._windowId)
            return;
        this._windowId = next;
        this._resolve();
    }

    _registrarChanged(owner) {
        if (this._closed || owner === this._owner)
            return;
        for (const id of this._subscriptions)
            this._bus.signal_unsubscribe(id);
        this._subscriptions = [];
        this._owner = owner;
        if (owner) {
            this._subscriptions = ['WindowRegistered', 'WindowUnregistered'].map(signal =>
                this._bus.signal_subscribe(owner, NAME, signal, PATH, null,
                    Gio.DBusSignalFlags.NONE, (_bus, _sender, _path, _interface, _signal, args) => {
                        if (args.get_child_value(0).get_uint32() === this._windowId)
                            this._resolve();
                    }));
        }
        this._resolve();
    }

    _publish(descriptor) {
        const key = JSON.stringify(descriptor);
        if (key === this._key)
            return;
        this._key = key;
        this._changed(descriptor);
    }

    _call(destination, path, iface, method, parameters, type, cancellable) {
        return new Promise((resolve, reject) => this._bus.call(destination, path, iface, method,
            parameters, new GLib.VariantType(type), Gio.DBusCallFlags.NO_AUTO_START,
            1500, cancellable, (connection, result) => {
                try {
                    resolve(connection.call_finish(result).deep_unpack());
                } catch (error) {
                    reject(error);
                }
            }));
    }

    async _resolve() {
        if (this._closed)
            return;
        const generation = ++this._generation;
        this._pending?.cancel();
        this._pending = null;
        this._publish(null); // Invalidate the old menu before making any query.
        if (!this._owner || !this._windowId)
            return;
        const cancellable = new Gio.Cancellable();
        this._pending = cancellable;
        const registrarOwner = this._owner;
        const windowId = this._windowId;
        try {
            let [busName, menuPath] = await this._call(registrarOwner, PATH, NAME,
                'GetMenuForWindow', new GLib.Variant('(u)', [windowId]), '(so)', cancellable);
            if (!busName)
                return;
            if (!Gio.dbus_is_unique_name(busName)) {
                [busName] = await this._call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                    'org.freedesktop.DBus', 'GetNameOwner', new GLib.Variant('(s)', [busName]),
                    '(s)', cancellable);
            }
            if (!this._closed && generation === this._generation)
                this._publish({kind: 'dbusmenu', busName, menuPath, windowId, registrarOwner});
        } catch {
            // Missing source, timeout and cancellation all leave this target unavailable.
        } finally {
            if (generation === this._generation)
                this._pending = null;
        }
    }

    destroy() {
        if (this._closed)
            return;
        this._closed = true;
        ++this._generation;
        this._pending?.cancel();
        this._pending = null;
        Gio.bus_unwatch_name(this._watch);
        for (const id of this._subscriptions)
            this._bus.signal_unsubscribe(id);
        this._subscriptions = [];
        this._changed = null;
    }
}
