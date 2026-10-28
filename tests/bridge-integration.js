// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {DBusMenuBridge} from '../companion/dbusmenuBridge.js';
import {GMenuSource} from '../extension/gmenuSource.js';
import {setImportedSubmenuOpen} from './bridge-helpers.js';

const bus = Gio.DBus.session;
const owner = ARGV[0];
const bridges = [];
const sources = [];
const statuses = [];
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children)]);
const find = (index, label) => flatten(sources[index]?.snapshot ?? []).find(node => node.label === label);
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
        await pause(10);
    }
    throw new Error(`Timed out: ${message}`);
}
function control(index, method, parameters = null, reply = '()') {
    return new Promise((resolve, reject) => bus.call(owner, `/menu/${index + 1}`, 'org.example.GnoMenu.Test',
        method, parameters, new GLib.VariantType(reply), Gio.DBusCallFlags.NO_AUTO_START, 1500, null,
        (connection, result) => {
            try {
                resolve(connection.call_finish(result));
            } catch (error) {
                reject(error);
            }
        }));
}
async function stats(index) {
    const value = await control(index, 'GetStats', null, '(a{sv})');
    return Object.fromEntries(Object.entries(value.get_child_value(0).deep_unpack()).map(([key, item]) => [key, item.deep_unpack()]));
}

async function run() {
    for (const index of [0, 1]) {
        const bridge = new DBusMenuBridge(bus, {busName: owner, menuPath: `/menu/${index + 1}`},
            {menuPath: `/org/gnomenu/bridge/w${index}/menu`, actionPath: `/org/gnomenu/bridge/w${index}`},
            info => { statuses[index] = info; });
        bridges.push(bridge);
        sources.push(new GMenuSource(bus, bridge.descriptor, () => {}));
    }
    await until(() => find(0, 'Increment')?.enabled && find(1, 'Increment')?.enabled, 'both bridged models');
    assert(find(0, '_File').kind === 'submenu' && !find(0, 'Hidden'), 'Native labels, hierarchy and visibility');
    assert(flatten(sources[0].snapshot).some(node => node.kind === 'section'), 'Native separator represented by GMenu sections');
    assert(find(0, 'Radio').toggle?.type === 'radio' && find(0, 'Radio').toggle.checked, 'Advertised radio state');
    assert(find(0, 'Check').toggle?.type === 'check' && !find(0, 'Check').toggle.checked, 'Advertised checkbox state');
    assert(!sources[0].activate(find(0, 'Disabled')), 'Disabled native commands cannot dispatch');
    print('PASS: Bridged hierarchy, labels, visibility, separators, disabled commands and toggle roles retain native semantics');
    assert(sources[0].activate(find(0, 'Increment')), 'Bridged native command dispatch');
    await until(async () => (await stats(0)).clicked.includes(2), 'first bridged event');
    assert((await stats(1)).clicked.length === 0, 'Other window remains untouched');
    print('PASS: GMenu actions forward through DBusMenu to the exact original source');
    const old = find(0, 'Increment');
    assert(sources[0].activate(find(0, 'Check')), 'Native checkbox dispatch');
    await until(() => find(0, 'Check')?.toggle.checked, 'native state notification crosses bridge');
    assert(!find(1, 'Check').toggle.checked && !sources[0].activate(old), 'Old generation cannot invoke reused IDs');
    print('PASS: Advertised toggle notifications cross both protocols and invalidate old-generation commands');
    await until(() => setImportedSubmenuOpen(sources[0], 'Lazy submenu', true), 'exported lazy submenu action');
    await until(() => find(0, 'Lazy command')?.enabled, 'lazy native model reaches GMenu consumer');
    assert(!find(1, 'Lazy command'), 'Lazy expansion remains scoped');
    await until(() => setImportedSubmenuOpen(sources[0], 'Lazy submenu', false), 'exported submenu close');
    await until(async () => (await stats(0)).closed.includes(8), 'native submenu closed event');
    assert((await stats(0)).opened.includes(8), 'Native submenu opened event');
    print('PASS: Standard submenu actions prepare native lazy contents and relay opened/closed events');
    assert(!sources[0].prepare(find(0, 'Increment')), 'Leaf command cannot be prepared as a menu');
    assert(!sources[0].prepare(find(1, '_File')), 'A foreign source node cannot prepare this menu');
    assert(!sources[0].prepare({...find(0, '_File')}), 'A copied node cannot forge submenu preparation');
    const previousHeading = find(0, '_File');
    await control(0, 'SetProperty', new GLib.Variant('(isv)', [1, 'enabled', new GLib.Variant('b', false)]));
    await until(() => find(0, 'Increment') && !find(0, 'Increment').enabled, 'disabled native ancestor blocks descendants');
    assert(!sources[0].prepare(previousHeading) && !sources[0].prepare(find(0, '_File')),
        'Disabled and replaced menu generations cannot prepare native contents');
    assert(!sources[0].activate(find(0, 'Increment')), 'Disabled parent cannot be bypassed via a child action');
    await control(0, 'SetProperty', new GLib.Variant('(isv)', [1, 'enabled', new GLib.Variant('b', true)]));
    await until(() => find(0, 'Increment')?.enabled, 'native ancestor enabled again');
    await control(0, 'SetProperty', new GLib.Variant('(isv)', [3, 'toggle-state', new GLib.Variant('i', -1)]));
    await until(() => find(0, 'Check') && !find(0, 'Check').enabled, 'unsupported indeterminate display is non-actionable');
    assert(!sources[0].activate(find(0, 'Check')), 'Indeterminate toggle is not guessed or dispatched');
    print('PASS: Disabled native ancestors block descendant actions and unsupported indeterminate toggles remain non-actionable');
    print('PASS: Production submenu preparation rejects leaf commands, foreign or forged nodes, disabled menus and obsolete action generations');
    const stale = find(0, 'Increment');
    await control(0, 'SetProperty', new GLib.Variant('(isv)', [2, 'enabled', new GLib.Variant('b', false)]));
    await until(() => find(0, 'Increment') && !find(0, 'Increment').enabled, 'availability update crosses bridge');
    assert(!sources[0].activate(stale) && find(1, 'Increment').enabled, 'Availability remains source-scoped');
    print('PASS: Live native availability updates remain scoped and cannot be bypassed with old menu nodes');
    await control(0, 'Oversize');
    await until(() => statuses[0]?.truncated && sources[0].snapshot.length === 0, 'truncated native menu is withheld');
    assert(find(1, 'Increment').enabled, 'Oversized source does not affect another bridge');
    print('PASS: A truncated native model clears bridge exports instead of presenting a complete capture');
    const remaining = find(1, 'Increment');
    const before = (await stats(1)).clicked.length;
    bridges[1].destroy();
    await until(() => sources[1].snapshot.length === 0, 'unexported bridge clears the imported model');
    assert(!sources[1].activate(remaining), 'Disposed bridge cannot dispatch old commands');
    await pause(50);
    assert((await stats(1)).clicked.length === before, 'No command reaches native source after disposal');
    print('PASS: Bridge disposal unexports actions/models and makes cached commands inert');
    const survivor = new DBusMenuBridge(bus, {busName: owner, menuPath: '/menu/2'},
        {menuPath: '/org/gnomenu/bridge/survivor/menu', actionPath: '/org/gnomenu/bridge/survivor'},
        info => { statuses[2] = info; });
    bridges.push(survivor);
    sources.push(new GMenuSource(bus, survivor.descriptor, () => {}));
    await until(() => find(2, 'Increment')?.enabled, 'fresh bridge before native exporter exit');
    const ownerStale = find(2, 'Increment');
    await control(1, 'Quit');
    await until(() => statuses[2]?.available === false && sources[2].snapshot.length === 0, 'native owner loss clears bridged model');
    assert(!sources[2].activate(ownerStale), 'Lost native owner cannot receive old bridged commands');
    print('PASS: Native exporter loss clears the bridged model and invalidates commands without reconnecting to a replacement');
}

const loop = new GLib.MainLoop(null, false);
let failed = false;
run().catch(error => {
    failed = true;
    printerr(error.stack);
}).finally(() => {
    sources.forEach(source => source.destroy());
    bridges.forEach(bridge => bridge.destroy());
    loop.quit();
});
loop.run();
if (failed)
    imports.system.exit(1);
