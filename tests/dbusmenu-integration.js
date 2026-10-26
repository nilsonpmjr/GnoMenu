// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {DBusMenuSource} from '../extension/dbusmenuSource.js';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}

function pause(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function until(predicate, message, timeout = 4000) {
    const deadline = GLib.get_monotonic_time() + timeout * 1000;
    while (GLib.get_monotonic_time() < deadline) {
        if (await predicate())
            return;
        await pause(10);
    }
    throw new Error(`Timed out: ${message}`);
}

function flatten(items) {
    return items.flatMap(item => [item, ...flatten(item.children)]);
}

const owner = ARGV[0];
const bus = Gio.DBus.session;
const sources = [];
const history = [];
let lastInfo;
function control(path, method, parameters = null, type = '()') {
    return new Promise((resolve, reject) => bus.call(owner, path, 'org.example.GnoMenu.Test',
        method, parameters, new GLib.VariantType(type), Gio.DBusCallFlags.NO_AUTO_START,
        4000, null, (connection, result) => {
            try {
                resolve(connection.call_finish(result));
            } catch (error) {
                reject(error);
            }
        }));
}

async function stats(path) {
    const result = await control(path, 'GetStats', null, '(a{sv})');
    const values = result.get_child_value(0).deep_unpack();
    return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.deep_unpack()]));
}

const set = (id, name, value) => control('/menu/1', 'SetProperty', new GLib.Variant('(isv)', [id, name, value]));
const remove = (id, name) => control('/menu/1', 'RemoveProperty', new GLib.Variant('(is)', [id, name]));
const find = (source, name) => flatten(source.snapshot).find(item => item.label === name);

async function run() {
    for (const number of [1, 2]) {
        sources.push(new DBusMenuSource(bus, {busName: owner, menuPath: `/menu/${number}`},
            (tree, info) => {
                if (number === 1) {
                    lastInfo = info;
                    history.push(flatten(tree).map(item => item.label));
                }
            }));
    }
    const [first, second] = sources;
    await until(() => find(first, 'Increment') && find(second, 'Increment'), 'initial layouts');
    assert(find(first, '_File').kind === 'submenu', 'Submenu kind must be preserved');
    assert(!find(first, 'Hidden'), 'Invisible items must not be exposed');
    assert(flatten(first.snapshot).some(item => item.kind === 'separator'), 'Separator must be preserved');
    assert(find(first, 'Radio').toggle.checked, 'Radio state must be decoded');
    print('PASS: DBusMenu hierarchy, visibility, separators and toggle properties');
    assert(!first.activate(find(first, 'Disabled')), 'Disabled item must not dispatch');
    assert(!first.activate(find(second, 'Increment')), 'A node from another source must not dispatch');
    const item = find(first, 'Increment');
    assert(first.activate(item, 1234), 'Enabled item must dispatch');
    await until(async () => (await stats('/menu/1')).clicked.includes(2), 'clicked event');
    assert((await stats('/menu/1')).timestamp === 1234, 'Event timestamp must be preserved');
    assert((await stats('/menu/2')).clicked.length === 0, 'Other menu instance must remain untouched');
    print('PASS: events retain source, remote item ID and timestamp');
    const oldCheck = find(first, 'Check');
    first.activate(oldCheck);
    await until(() => find(first, 'Check')?.toggle.checked, 'property signal refresh');
    assert(!first.activate(oldCheck), 'Old snapshot must not activate a reused item ID');
    assert(!find(second, 'Check').toggle.checked, 'Property change must remain source-scoped');
    print('PASS: property changes propagate and old snapshots reject activation');
    await set(2, 'enabled', new GLib.Variant('b', false));
    await until(() => find(first, 'Increment')?.enabled === false, 'disabled property');
    await remove(2, 'enabled');
    await until(() => find(first, 'Increment')?.enabled === true, 'removed property defaults to enabled');
    await set(2, 'visible', new GLib.Variant('b', false));
    await until(() => !find(first, 'Increment'), 'invisible property');
    await remove(2, 'visible');
    await until(() => find(first, 'Increment'), 'removed property defaults to visible');
    print('PASS: removed properties restore protocol defaults');
    assert(await first.prepare(find(first, 'Lazy submenu')), 'AboutToShow must prepare submenu');
    await until(() => find(first, 'Lazy command'), 'lazy submenu layout');
    await until(async () => (await stats('/menu/1')).opened.includes(8), 'opened event');
    first.close(find(first, 'Lazy submenu'));
    await until(async () => (await stats('/menu/1')).closed.includes(8), 'closed event');
    const requestCount = (await stats('/menu/1')).requests;
    assert(await first.prepare(find(first, 'Lazy submenu')), 'Unchanged submenu can still open');
    await pause(60);
    assert((await stats('/menu/1')).requests === requestCount,
        'AboutToShow false must not create a refresh feedback loop');
    print('PASS: lazy submenus prepare correctly without refresh feedback loops');
    await control('/menu/1', 'DelayNextLayout', new GLib.Variant('(u)', [140]));
    await set(2, 'label', new GLib.Variant('s', 'STALE RESPONSE'));
    await until(async () => (await stats('/menu/1')).requests > requestCount, 'delayed request starts');
    await set(2, 'label', new GLib.Variant('s', 'Fresh response'));
    await until(() => find(first, 'Fresh response'), 'new revision after delayed reply');
    assert(!history.some(labels => labels.includes('STALE RESPONSE')), 'Obsolete reply must never be published');
    print('PASS: revisions arriving during an in-flight query discard obsolete responses');
    await control('/menu/1', 'DelayNextLayout', new GLib.Variant('(u)', [1800]));
    await set(2, 'label', new GLib.Variant('s', 'Slow response'));
    await until(() => lastInfo?.error && !lastInfo.available, 'bounded request timeout', 3000);
    assert(first.snapshot.length === 0, 'Timeout must clear actionable state');
    await set(2, 'label', new GLib.Variant('s', 'Recovered'));
    await until(() => find(first, 'Recovered'), 'recovery after new signal');
    print('PASS: request timeouts clear state and a subsequent update recovers');
    await control('/menu/2', 'Oversize');
    await until(() => second.truncated, 'oversized model bound');
    assert(flatten(second.snapshot).length <= 512, 'Decoded snapshot must remain bounded');
    print('PASS: oversized DBusMenu models are bounded and marked truncated');
    const stale = find(first, 'Recovered');
    await control('/menu/1', 'DelayNextLayout', new GLib.Variant('(u)', [180]));
    const before = (await stats('/menu/1')).requests;
    await set(2, 'label', new GLib.Variant('s', 'After dispose'));
    await until(async () => (await stats('/menu/1')).requests > before, 'pending request before dispose');
    first.destroy();
    first.destroy();
    const published = history.length;
    await pause(240);
    assert(history.length === published && !first.activate(stale), 'Disposed source must remain silent');
    print('PASS: disposal cancels pending work and rejects stale activation');
    await control('/menu/2', 'Quit');
    await until(() => second.closed, 'owner disappears');
    assert(second.snapshot.length === 0, 'Owner disappearance must clear menus');
    print('PASS: disappearing DBus owner clears its source');
}

const loop = new GLib.MainLoop(null, false);
let failure = false;
run().catch(error => {
    printerr(error.stack);
    failure = true;
}).finally(() => {
    for (const source of sources)
        source.destroy();
    loop.quit();
});
loop.run();
if (failure)
    imports.system.exit(1);
