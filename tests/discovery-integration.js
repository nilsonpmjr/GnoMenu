// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AppMenuDiscovery} from '../extension/appmenuDiscovery.js';
import {DBusMenuSource} from '../extension/dbusmenuSource.js';

const [exporter, registrarPid] = ARGV;
const bus = Gio.DBus.session;
let source = null;
let selected = null;
const history = [];
const discovery = new AppMenuDiscovery(bus, descriptor => {
    source?.destroy();
    selected = descriptor;
    history.push(descriptor);
    source = descriptor ? new DBusMenuSource(bus, descriptor, () => {}) : null;
});

const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};
const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));
async function until(predicate, message) {
    const deadline = GLib.get_monotonic_time() + 4000000;
    while (GLib.get_monotonic_time() < deadline) {
        if (await predicate())
            return;
        await pause(10);
    }
    throw new Error(message);
}

function request(destination, path, iface, method, args = null, type = '()') {
    return new Promise((resolve, reject) => bus.call(destination, path, iface, method, args,
        new GLib.VariantType(type), Gio.DBusCallFlags.NO_AUTO_START, 1500, null,
        (connection, result) => {
            try {
                resolve(connection.call_finish(result).deep_unpack());
            } catch (error) {
                reject(error);
            }
        }));
}
const control = (method, args = null) => request(exporter, '/menu/1', 'org.example.GnoMenu.Test', method, args);
async function clicked(path) {
    const [stats] = await request(exporter, path, 'org.example.GnoMenu.Test', 'GetStats', null, '(a{sv})');
    return stats.clicked.deep_unpack();
}
function findIncrement(items = source?.snapshot ?? []) {
    for (const item of items) {
        if (item.label === 'Increment')
            return item;
        const nested = findIncrement(item.children);
        if (nested)
            return nested;
    }
    return null;
}

async function select(windowId, path) {
    discovery.setWindowId(windowId);
    await until(() => selected?.windowId === windowId && selected.menuPath === path &&
        findIncrement(), 'Registered target must resolve and load its menu');
}

async function run() {
    await select(101, '/menu/1');
    assert(selected.busName === exporter && selected.registrarOwner.startsWith(':'),
        'Both exporter and registrar must have pinned unique owners');
    const first = source;
    const stale = findIncrement();
    first.activate(stale);
    await until(async () => (await clicked('/menu/1')).length === 1, 'First menu event');
    assert((await clicked('/menu/2')).length === 0, 'Second declared window must remain unchanged');
    print('PASS: registrar declarations resolve to the exact exporter and menu source');
    await select(102, '/menu/2');
    assert(first.closed && !first.activate(stale), 'Target change must invalidate old menu clicks');
    source.activate(findIncrement());
    await until(async () => (await clicked('/menu/2')).length === 1, 'Second menu event');
    assert((await clicked('/menu/1')).length === 1, 'First menu must remain unchanged');
    print('PASS: declared window changes route actions only to the selected menu');
    for (let i = 0; i < 12; i++)
        discovery.setWindowId(i % 2 ? 102 : 101);
    await select(101, '/menu/1');
    assert(selected.menuPath === '/menu/1', 'Rapid changes must not publish an old query as the final source');
    print('PASS: rapid target changes cancel obsolete registrar queries');
    const unregistered = source;
    await control('UnregisterWindow', new GLib.Variant('(u)', [101]));
    await until(() => selected === null && source === null, 'Unregistered menu must disappear');
    assert(unregistered.closed, 'Unregistration must dispose the active source');
    discovery.setWindowId(999);
    await pause(80);
    assert(selected === null, 'Unknown ID must never use another application menu');
    print('PASS: unregistering or selecting an unknown window clears the active source');
    await request('com.canonical.AppMenu.Registrar', '/com/canonical/AppMenu/Registrar',
        'com.canonical.AppMenu.Registrar', 'RegisterWindow', new GLib.Variant('(uo)', [0, '/unidentified']));
    discovery.setWindowId(0);
    await pause(40);
    assert(source === null, 'A zero declaration must never be used as a Wayland surface');
    discovery.setWindowId(null);
    assert(selected === null, 'No ID means no source');
    print('PASS: zero and absent window identities never select a menu');
    await control('RegisterWindows');
    await select(101, '/menu/1');
    const beforeLoss = source;
    assert(/^\d+$/.test(registrarPid), 'Registrar PID must come from the private fixture runner');
    Gio.Subprocess.new(['kill', '-TERM', registrarPid], Gio.SubprocessFlags.NONE);
    await until(() => selected === null && beforeLoss.closed, 'Registrar loss must invalidate the source');
    discovery.destroy();
    discovery.destroy();
    const count = history.length;
    discovery.setWindowId(102);
    await pause(60);
    assert(history.length === count, 'Disposed discovery must not notify consumers');
    print('PASS: lost registrar and discovery disposal invalidate sources and silence callbacks');
}

const loop = new GLib.MainLoop(null, false);
let failed = false;
run().catch(error => {
    printerr(`${error.message}\n${error.stack}`);
    failed = true;
}).finally(() => {
    discovery.destroy();
    source?.destroy();
    loop.quit();
});
loop.run();
if (failed)
    imports.system.exit(1);
