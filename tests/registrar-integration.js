// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAME = 'com.canonical.AppMenu.Registrar';
const PATH = '/com/canonical/AppMenu/Registrar';
const owner = ARGV[0];
const clients = [];
const signals = [];

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function call(bus, method, parameters = null, type = '()') {
    return new Promise((resolve, reject) => bus.call(NAME, PATH, NAME, method,
        parameters, new GLib.VariantType(type), Gio.DBusCallFlags.NO_AUTO_START,
        1500, null, (connection, result) => {
            try {
                resolve(connection.call_finish(result).deep_unpack());
            } catch (error) {
                reject(error);
            }
        }));
}

async function until(predicate, message) {
    const deadline = GLib.get_monotonic_time() + 3000000;
    while (GLib.get_monotonic_time() < deadline) {
        if (await predicate())
            return;
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
    }
    throw new Error(message);
}

async function denied(operation, message) {
    let rejected = false;
    try {
        await operation();
    } catch (error) {
        rejected = error.message.includes('AccessDenied');
    }
    assert(rejected, message);
}

async function run() {
    for (let i = 0; i < 2; i++) {
        clients.push(Gio.DBusConnection.new_for_address_sync(GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            null, null));
    }
    const [first, second] = clients;
    const watch = first.signal_subscribe(owner, NAME, null, PATH, null,
        Gio.DBusSignalFlags.NONE, (_bus, _sender, _path, _iface, name, parameters) =>
            signals.push({name, args: parameters.deep_unpack()}));
    const register = (bus, id, path) => call(bus, 'RegisterWindow', new GLib.Variant('(uo)', [id, path]));
    const unregister = (bus, id) => call(bus, 'UnregisterWindow', new GLib.Variant('(u)', [id]));
    const lookup = id => call(first, 'GetMenuForWindow', new GLib.Variant('(u)', [id]), '(so)');
    const menus = async () => (await call(first, 'GetMenus', null, '(a(uso))'))[0];
    await register(first, 101, '/menu/one');
    await register(first, 102, '/menu/two');
    await register(second, 201, '/menu/other');
    assert((await menus()).length === 3, 'Independent registrations must coexist');
    const [service, path] = await lookup(101);
    assert(service === first.get_unique_name() && path === '/menu/one',
        'Registration must pin the calling connection rather than a claimed service');
    assert((await lookup(999))[0] === '', 'Unknown window must never fall back to another app');
    print('PASS: registrar preserves exact window IDs, object paths and unique exporters');
    await denied(() => register(second, 101, '/forged'), 'Another caller must not replace a window');
    await denied(() => unregister(second, 101), 'Another caller must not unregister a window');
    await register(first, 101, '/menu/replaced');
    assert((await lookup(101))[1] === '/menu/replaced', 'Same owner may update its own menu');
    print('PASS: registry updates require the original registering connection');
    await until(() => signals.filter(signal => signal.name === 'WindowRegistered').length >= 4,
        'Registration signals must reach subscribers');
    await unregister(first, 102);
    await until(() => signals.some(signal => signal.name === 'WindowUnregistered' && signal.args[0] === 102),
        'Unregistration signal must identify the exact window');
    assert((await lookup(102))[0] === '' && (await lookup(101))[0] !== '',
        'Removing one window must retain other windows');
    print('PASS: registration lifecycle signals track each window independently');
    second.close_sync(null);
    await until(async () => (await lookup(201))[0] === '', 'Exporter disconnect must remove its windows');
    assert((await menus()).length === 1, 'Disconnected exporter cleanup must preserve the surviving app');
    print('PASS: exporter disconnect removes its registrations without affecting other apps');
    await register(first, 0, '/menu/no_surface_identity');
    assert((await lookup(0))[1] === '/menu/no_surface_identity', 'Zero-ID declaration is retained as protocol data');
    assert((await lookup(101))[1] === '/menu/replaced', 'Zero must not alias a real window');
    await unregister(first, 0);
    print('PASS: zero-ID declarations never alias another registered window');
    const reply = await new Promise((resolve, reject) =>
        first.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'RequestName', new GLib.Variant('(su)', [NAME, 4]), new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE, 1500, null, (connection, result) => {
                try {
                    resolve(connection.call_finish(result).deep_unpack()[0]);
                } catch (error) {
                    reject(error);
                }
            }));
    assert(reply === 3, 'A second process requesting the name must not take over or queue');
    print('PASS: an existing registrar cannot be replaced by the default name request');
    first.signal_unsubscribe(watch);
}

const loop = new GLib.MainLoop(null, false);
let failed = false;
run().catch(error => {
    printerr(`${error.message}\n${error.stack}`);
    failed = true;
}).finally(() => {
    for (const client of clients) {
        if (!client.is_closed())
            client.close_sync(null);
    }
    loop.quit();
});
loop.run();
if (failed)
    imports.system.exit(1);
