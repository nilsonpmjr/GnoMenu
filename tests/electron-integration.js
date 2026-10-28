// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {AppMenuDiscovery} from '../extension/appmenuDiscovery.js';
import {DBusMenuSource} from '../extension/dbusmenuSource.js';
import {verifyWindowAssociation} from './electron-window-association.js';

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
async function until(predicate, message) {
    const deadline = GLib.get_monotonic_time() + 5000000;
    while (GLib.get_monotonic_time() < deadline) {
        if (await predicate())
            return;
        await pause(20);
    }
    throw new Error(`Timed out: ${message}`);
}
const file = Gio.File.new_for_path(ARGV[0]);
function state() {
    const [, bytes] = file.load_contents(null);
    return JSON.parse(imports.byteArray.toString(bytes));
}
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children)]);
const sources = [];
const discoveries = [];
const evidence = [];
const latest = [];
const layouts = [];
const observations = {};
const loop = new GLib.MainLoop(null, false);
let failed = false;
async function run() {
    const original = state();
    assert(original.windows.length === 2 && original.windows[0].xid !== original.windows[1].xid,
        'Two actual native window handles must be distinct');
    for (const window of original.windows) {
        let descriptor = null;
        const index = discoveries.length;
        const discovery = new AppMenuDiscovery(Gio.DBus.session, value => {
            descriptor = value;
            latest[index] = value;
            sources[index]?.destroy();
            sources[index] = value ? new DBusMenuSource(Gio.DBus.session, value, (tree, info) => {
                layouts[index] = {descriptor: value, tree, info};
                GLib.file_set_contents(ARGV[1] + '.layouts.json', JSON.stringify(layouts, null, 2));
            }) : null;
        });
        discoveries.push(discovery);
        discovery.setWindowId(window.xid);
        await until(() => descriptor !== null, 'native Electron registrar declaration');
        assert(descriptor.windowId === window.xid && descriptor.busName.startsWith(':'),
            'Discovery pins the declared native handle to a unique exporter');
        evidence.push(descriptor);
        for (const heading of ['File', 'View']) {
            await until(async () => {
                const source = sources[index];
                const menu = source?.snapshot.find(node => node.label === heading);
                return menu ? source.prepare(menu) : false;
            }, 'lazy native submenu preparation');
            await until(() => flatten(sources[index]?.snapshot ?? []).some(node =>
                node.label === (heading === 'File' ? 'Increment this window' : 'Checked option')), 'real Electron layout');
        }
    }
    assert(evidence[0].busName === evidence[1].busName && evidence[0].menuPath !== evidence[1].menuPath,
        'One actual process exports two independent menu paths');
    print('PASS: Actual Electron native handles resolve to distinct menubars despite identical titles and a shared process');
    print('PASS: Actual lazy Electron submenus populate through AboutToShow before their commands are imported');
    observations.association = await verifyWindowAssociation(original.windows, sources, ARGV[2], ARGV[3], state);
    const baseline = state().windows.map(window => window.counter);
    const find = (index, label) => flatten(sources[index]?.snapshot ?? []).find(node => node.label === label);
    const reopen = async (index, label) => {
        const item = find(index, label);
        if (item)
            sources[index].close(item);
        await until(() => {
            const menu = find(index, label);
            return menu ? sources[index].prepare(menu) : false;
        }, 'native menu reopen refresh');
    };
    assert(sources[0].activate(find(0, 'Increment this window')), 'First window dispatch');
    await until(() => state().windows[0].counter === baseline[0] + 1, 'first actual Electron handler');
    assert(state().windows[1].counter === baseline[1], 'First menu must not reach the second window');
    assert(sources[1].activate(find(1, 'Increment this window')), 'Second window dispatch');
    await until(() => state().windows[1].counter === baseline[1] + 1, 'second actual Electron handler');
    assert(state().windows[0].counter === baseline[0] + 1, 'Second menu must not reach the first window');
    assert(!sources[0].activate(find(0, 'Disabled command')), 'Disabled command is rejected');
    print('PASS: GnoMenu dispatch reaches only the selected actual Electron window and rejects disabled commands');
    // The bridge test replaced the native menu. Electron recreates its lazy
    // submenus, so prepare View again instead of assuming its old contents live.
    await reopen(0, 'View');
    await until(() => find(0, 'Checked option'), 'recreated native View contents');
    await until(() => sources[0]?.activate(find(0, 'Checked option')), 'current native checkbox command can dispatch');
    await until(() => state().windows[0].checked, 'native checkbox callback');
    await reopen(0, 'View');
    await pause(500);
    const rawLayout = await sources[0]._call('GetLayout', new GLib.Variant('(iias)', [0, 12, []]), '(u(ia{sv}av))');
    GLib.file_set_contents(ARGV[1] + '.raw-layout.txt', rawLayout.print(true));
    const advertised = tuple => {
        const properties = tuple.get_child_value(1).deep_unpack();
        if (properties.label?.unpack() === 'Checked option')
            return properties['toggle-state']?.unpack() ?? null;
        const children = tuple.get_child_value(2);
        for (let i = 0; i < children.n_children(); i++) {
            const result = advertised(children.get_child_value(i).get_variant());
            if (result !== null)
                return result;
        }
        return null;
    };
    const nativeCheck = advertised(rawLayout.get_child_value(1));
    observations.checkbox = {fixtureChecked: state().windows[0].checked, advertisedToggleState: nativeCheck,
        importedChecked: find(0, 'Checked option')?.toggle?.checked, waitAfterReopenMs: 500};
    assert(!state().windows[1].checked, 'Checkbox state remains per-window');
    print('PASS: Actual Electron checkbox dispatch is scoped and its advertised state is recorded separately from callback state');
    await until(() => sources[0]?.activate(find(0, 'Add dynamic command')), 'current native dynamic command can dispatch');
    await until(() => state().windows[0].dynamic, 'native dynamic menu callback');
    await reopen(0, 'File');
    await until(() => find(0, 'Dynamic command') !== undefined, 'dynamic native layout publication');
    assert(state().windows[1].counter === baseline[1] + 1, 'Native dynamic command dispatch preserves the other window');
    await until(() => sources[0]?.activate(find(0, 'Dynamic command')), 'new native command can dispatch');
    await until(() => state().windows[0].counter === baseline[0] + 2, 'dynamic native command dispatch');
    print('PASS: Native dynamic commands remain window-scoped and invocable after full bridge cleanup');
    const stale = find(0, 'Increment this window');
    const originalSource = sources[0];
    await until(() => sources[0]?.activate(find(0, 'Close this window')), 'current native close command can dispatch');
    await until(() => state().windows[0].closed, 'native first-window close');
    // The discovery callback disposes a source when its real declaration ends.
    await until(() => latest[0] === null && originalSource.closed, 'native registration withdrawal');
    let invalidDescriptor = null;
    const invalid = new AppMenuDiscovery(Gio.DBus.session, value => {invalidDescriptor = value;});
    invalid.setWindowId(0);
    await pause(100);
    assert(invalidDescriptor === null, 'A zero window identity cannot select an Electron menu');
    invalid.destroy();
    assert(!originalSource.activate(stale) && !state().windows[1].closed,
        'Disposed first-window commands cannot affect the remaining window');
    sources[1].activate(find(1, 'Increment this window'));
    await until(() => state().windows[1].counter === baseline[1] + 2, 'remaining native menu keeps working');
    print('PASS: Closing one actual Electron window preserves the other menu and disposed commands cannot dispatch');
    GLib.file_set_contents(ARGV[1], JSON.stringify({success: true, descriptors: evidence, finalState: state(), observations}, null, 2));
}
run().catch(error => {
    failed = true;
    GLib.file_set_contents(ARGV[1] + '.failure.json', JSON.stringify({error: error.message, fixture: state()}, null, 2));
    printerr(error.message);
    printerr(error.stack);
}).finally(() => {
    for (const source of sources)
        source?.destroy();
    for (const discovery of discoveries)
        discovery.destroy();
    loop.quit();
});
loop.run();
if (failed)
    imports.system.exit(1);
