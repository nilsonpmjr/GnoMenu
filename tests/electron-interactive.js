// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
// Owned fixture only: keep the verified bridge alive for manual interaction.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import {DBusMenuBridge} from '../companion/dbusmenuBridge.js';

if (GLib.getenv('GNOMENU_ELECTRON_INTERACTIVE') !== '1')
    throw new Error('This bridge requires the private interactive harness');
const [, bytes] = GLib.file_get_contents(ARGV[0]);
const identity = JSON.parse(imports.byteArray.toString(bytes));
if (!identity.success || identity.identities.length !== 2)
    throw new Error('Two independently verified fixture windows are required');
const bus = Gio.DBus.session;
const owner = bus.get_unique_name();
const records = [];
const loop = new GLib.MainLoop(null, false);
const handlers = [2, 15].map(signal => GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, () => {
    loop.quit();
    return GLib.SOURCE_CONTINUE;
}));
function xprop(xid, args) {
    const child = Gio.Subprocess.new(['xprop', '-id', `0x${xid.toString(16)}`, ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, output, error] = child.communicate_utf8(null, null);
    if (!child.get_successful())
        throw new Error(error);
    return output;
}
try {
    for (const [index, descriptor] of identity.identities.entries()) {
        const menuPath = `/org/gnomenu/Interactive/window${index}/menu`;
        const actionPath = `/org/gnomenu/Interactive/window${index}`;
        const properties = [['_GTK_UNIQUE_BUS_NAME', owner], ['_GTK_MENUBAR_OBJECT_PATH', menuPath],
            ['_GTK_WINDOW_OBJECT_PATH', actionPath]];
        for (const [property] of properties) {
            if (xprop(descriptor.windowId, [property]).includes(' = '))
                throw new Error('Existing GTK metadata must be preserved');
        }
        const bridge = new DBusMenuBridge(bus, descriptor, {menuPath, actionPath});
        records.push({bridge, descriptor, properties});
        // Commit the unique owner after publishing both object paths.
        for (const [property, value] of [...properties.slice(1), properties[0]])
            xprop(descriptor.windowId, ['-f', property, '8u', '-set', property, value]);
    }
    GLib.file_set_contents(ARGV[1], JSON.stringify({ready: true, owner, windows: records.map(record => record.bridge.descriptor)}));
    print('Verified Electron bridge ready for manual interaction');
    loop.run();
} finally {
    for (const record of records) {
        for (const [property, value] of record.properties) {
            try {
                if (xprop(record.descriptor.windowId, [property]).includes(` = "${value}"`))
                    xprop(record.descriptor.windowId, ['-remove', property]);
            } catch {
                // Closing an owned window destroys its XID and properties.
            }
        }
        record.bridge.destroy();
    }
    handlers.forEach(id => GLib.source_remove(id));
}
