// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
// Full-model companion replay on owned fixture windows only.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {GMenuSource} from '../extension/gmenuSource.js';
import {DBusMenuBridge} from '../companion/dbusmenuBridge.js';
import {setImportedSubmenuOpen} from './bridge-helpers.js';
import {verifyElectronPanel} from './electron-panel.js';

const PROPERTIES = ['_GTK_UNIQUE_BUS_NAME', '_GTK_MENUBAR_OBJECT_PATH', '_GTK_WINDOW_OBJECT_PATH'];
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children)]);
function assert(value, message) {
    if (!value)
        throw new Error(message);
}
async function until(predicate, message) {
    const deadline = GLib.get_monotonic_time() + 5000000;
    while (GLib.get_monotonic_time() < deadline) {
        if (predicate())
            return;
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
    }
    throw new Error(`Timed out: ${message}`);
}
function xprop(xid, args) {
    const process = Gio.Subprocess.new(['xprop', '-id', `0x${xid.toString(16)}`, ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, output, error] = process.communicate_utf8(null, null);
    assert(process.get_successful(), `Private X11 property operation failed: ${error}`);
    return output;
}

export async function verifyWindowAssociation(windows, nativeSources, observationPath, commandPath, state) {
    const bus = Gio.DBus.session;
    const owner = bus.get_unique_name();
    const records = [];
    const observations = () => {
        const [, bytes] = GLib.file_get_contents(observationPath);
        return JSON.parse(imports.byteArray.toString(bytes)).windows;
    };
    try {
        for (const [index, window] of windows.entries()) {
            // Never replace existing application metadata. Only these owned
            // fixture XIDs, supplied by their native handles, are modified.
            for (const property of PROPERTIES)
                assert(!xprop(window.xid, [property]).includes(' = '), 'Existing GTK metadata must be preserved');
            const menuPath = `/org/gnomenu/Association/window${index}/menu`;
            const windowPath = `/org/gnomenu/Association/window${index}`;
            const bridge = new DBusMenuBridge(bus, nativeSources[index].descriptor,
                {menuPath, actionPath: windowPath}, info => {
                    if (info.error)
                        printerr(`Bridge: ${info.error}`);
                });
            const record = {xid: window.xid, descriptor: {busName: owner, menuPath, windowPath},
                bridge, source: null};
            records.push(record);
            // Publish the unique owner last, after both model/action paths exist.
            for (const [property, value] of [[PROPERTIES[1], menuPath], [PROPERTIES[2], windowPath],
                [PROPERTIES[0], owner]])
                xprop(window.xid, ['-f', property, '8u', '-set', property, value]);
        }
        await until(() => records.every(record => observations().some(window =>
            window.menuSource?.busName === owner && window.menuSource?.menuPath === record.descriptor.menuPath &&
            window.menuSource?.windowPath === record.descriptor.windowPath)), 'Mutter GTK metadata association');
        const observed = observations();
        assert(observed.filter(window => window.menuSource?.busName === owner).length === records.length,
            'Each exported descriptor belongs to one observed window');
        for (const [index, record] of records.entries()) {
            const descriptor = observed.find(window => window.menuSource?.menuPath === record.descriptor.menuPath).menuSource;
            record.source = new GMenuSource(bus, descriptor, () => {});
            await until(() => flatten(record.source.snapshot).some(node => node.enabled && node.label === 'Increment this window'),
                'GnoMenu imports the model selected through Meta.Window metadata');
            const before = state().windows.map(window => window.counter);
            const command = flatten(record.source.snapshot).find(node => node.label === 'Increment this window');
            assert(record.source.activate(command), 'Imported association command is available');
            await until(() => state().windows[index].counter === before[index] + 1, 'associated native command dispatch');
            assert(state().windows[1 - index].counter === before[1 - index], 'Association must preserve the other window');
        }
        print('PASS: Standard X11 GTK properties associate distinct imported menus with the exact Meta windows');
        print('PASS: Commands imported through Meta.Window metadata reach only their original Electron window');
        const find = (index, label) => flatten(records[index].source.snapshot).find(node => node.label === label);
        const outline = nodes => nodes.flatMap(node => node.kind === 'separator' ? [] :
            node.kind === 'section' ? outline(node.children) :
                [{label: node.label, kind: node.kind, children: outline(node.children)}]);
        for (const index of [0, 1]) {
            await until(() => find(index, 'Disabled command') && find(index, 'Checked option'), 'full native model import');
            await until(() => JSON.stringify(outline(records[index].source.snapshot)) ===
                JSON.stringify(outline(nativeSources[index].snapshot)), 'all exported native menu entries cross the bridge');
            assert(!records[index].source.activate(find(index, 'Disabled command')), 'Bridge rejects native disabled commands');
            assert(find(index, 'Checked option').toggle?.type === 'check', 'Native checkbox remains a stateful action');
            assert(records[index].source.snapshot.filter(node => node.kind === 'submenu').map(node => node.label).join(',') === 'File,View',
                'Native heading order and labels are preserved');
        }
        print('PASS: The complete Electron fixture model retains native headings, disabled commands and advertised checkbox roles');
        const previous = find(0, 'Increment this window');
        const beforeDynamic = state().windows[0].counter;
        assert(records[0].source.activate(find(0, 'Add dynamic command')), 'Bridge can invoke native model replacement');
        await until(() => state().windows[0].dynamic, 'native layout replacement from bridged command');
        await until(() => {
            if (find(0, 'Dynamic command'))
                return true;
            // Replaced native menus acquire a new GMenu action generation.
            // Reopen the current heading instead of keeping an obsolete action.
            setImportedSubmenuOpen(records[0].source, 'File', true);
            return false;
        }, 'bridge republishes dynamic native layout');
        assert(!find(1, 'Dynamic command'), 'Bridged model replacement remains window-scoped');
        assert(!records[0].source.activate(previous), 'Old GMenu command cannot address replacement native items');
        await until(() => records[0].source.activate(find(0, 'Dynamic command')), 'current dynamic bridged action');
        await until(() => state().windows[0].counter === beforeDynamic + 1, 'dynamic command forwarded through both protocols');
        await until(() => setImportedSubmenuOpen(records[0].source, 'File', false), 'standard exported submenu close');
        print('PASS: Native layout replacement crosses the full bridge, prepares lazily, rejects stale commands and preserves window scope');
        const panel = await verifyElectronPanel(records, observationPath, commandPath, state);
        return {success: true, descriptors: records.map(record => record.descriptor),
            panel, scope: 'Owned XWayland fixture; full exported model bridge and private panel rendering, no production discovery'};
    } finally {
        for (const record of records) {
            const stale = flatten(record.source?.snapshot ?? []).find(node => node.label === 'Increment this window');
            record.source?.destroy();
            if (record.source)
                assert(!record.source.activate(stale), 'Disposed association commands cannot dispatch');
            record.bridge.destroy();
            // Remove only values still owned by this probe, preserving any
            // replacement metadata rather than overwriting another writer.
            for (const [property, value] of [[PROPERTIES[0], owner],
                [PROPERTIES[1], record.descriptor.menuPath], [PROPERTIES[2], record.descriptor.windowPath]]) {
                if (xprop(record.xid, [property]).includes(` = "${value}"`))
                    xprop(record.xid, ['-remove', property]);
            }
        }
        if (records.length) {
            await until(() => observations().every(window => window.menuSource?.busName !== owner),
                'Mutter clears the removed association metadata');
            print('PASS: Association probe restores absent GTK metadata and removes its menu/action exports');
        }
    }
}
