// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
// Experimental association probe, not a general DBusMenu-to-GMenu bridge.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {GMenuSource} from '../extension/gmenuSource.js';

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

export async function verifyWindowAssociation(windows, nativeSources, observationPath, state) {
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
            const group = new Gio.SimpleActionGroup();
            const action = new Gio.SimpleAction({name: 'increment'});
            action.connect('activate', () => {
                const source = nativeSources[index];
                const node = flatten(source?.snapshot ?? []).find(item => item.label === 'Increment this window');
                if (node)
                    source.activate(node);
            });
            group.add_action(action);
            const submenu = new Gio.Menu();
            submenu.append('Increment this window', 'win.increment');
            const menu = new Gio.Menu();
            menu.append_submenu('File', submenu);
            const record = {xid: window.xid, descriptor: {busName: owner, menuPath, windowPath},
                exports: [], source: null};
            records.push(record);
            record.exports.push(['menu', bus.export_menu_model(menuPath, menu)]);
            record.exports.push(['actions', bus.export_action_group(windowPath, group)]);
            for (const [property, value] of [[PROPERTIES[0], owner], [PROPERTIES[1], menuPath],
                [PROPERTIES[2], windowPath]])
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
            await until(() => flatten(record.source.snapshot).some(node => node.enabled && node.action === 'win.increment'),
                'GnoMenu imports the model selected through Meta.Window metadata');
            const before = state().windows.map(window => window.counter);
            const command = flatten(record.source.snapshot).find(node => node.action === 'win.increment');
            assert(record.source.activate(command), 'Imported association command is available');
            await until(() => state().windows[index].counter === before[index] + 1, 'associated native command dispatch');
            assert(state().windows[1 - index].counter === before[1 - index], 'Association must preserve the other window');
        }
        print('PASS: Standard X11 GTK properties associate distinct imported menus with the exact Meta windows');
        print('PASS: Commands imported through Meta.Window metadata reach only their original Electron window');
        return {success: true, descriptors: records.map(record => record.descriptor),
            scope: 'Owned XWayland fixture; single-command association probe, not a full menu bridge'};
    } finally {
        for (const record of records) {
            const stale = flatten(record.source?.snapshot ?? []).find(node => node.action === 'win.increment');
            record.source?.destroy();
            if (record.source)
                assert(!record.source.activate(stale), 'Disposed association commands cannot dispatch');
            for (const [kind, id] of record.exports) {
                if (kind === 'menu')
                    bus.unexport_menu_model(id);
                else
                    bus.unexport_action_group(id);
            }
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
