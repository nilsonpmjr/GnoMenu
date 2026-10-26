// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {bindtextdomain} from 'gettext';
import {GMenuSource} from '../extension/gmenuSource.js';

const [owner, localeDirectory, expectedJSON] = ARGV;
const expected = JSON.parse(expectedJSON);
bindtextdomain('gnomenu', localeDirectory);
const _ = message => GLib.dgettext('gnomenu', message);
const assert = (condition, message) => {
    if (!condition)
        throw new Error(message);
};

function waitFor(predicate) {
    const deadline = GLib.get_monotonic_time() + 4000000;
    return new Promise((resolve, reject) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            if (predicate()) {
                resolve();
                return GLib.SOURCE_REMOVE;
            }
            if (GLib.get_monotonic_time() > deadline) {
                reject(new Error('Translated GMenu sources did not become ready'));
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    });
}

const loop = new GLib.MainLoop(null, false);
const sources = [];
let failed = false;
async function run() {
    for (const [message, translation] of Object.entries(expected))
        assert(_(message) === translation, `${message}: expected ${translation}, got ${_(message)}`);
    const descriptor = {busName: owner, menuPath: '/lab/menu/1',
        appPath: '/lab/app', windowPath: '/lab/window/1'};
    const fallback = new GMenuSource(Gio.DBus.session, descriptor, () => {}, _);
    const native = new GMenuSource(Gio.DBus.session,
        {...descriptor, appMenuPath: '/lab/application/menu'}, () => {}, _);
    sources.push(fallback, native);
    await waitFor(() => fallback.applicationMenu.some(item => item.action === 'app.preferences') &&
        native.applicationMenu.some(item => item.label === 'Native settings label') && native.snapshot.length);
    assert(fallback.applicationMenu.find(item => item.action === 'app.preferences').label === expected['Preferences…'],
        'Fallback labels must use the inherited gettext locale');
    assert(native.applicationMenu.some(item => item.label === 'Quit'),
        'Native labels matching translation keys must be preserved verbatim');
    assert(!native.applicationMenu.some(item => item.id === 'app-action/quit'),
        'Translation must not duplicate native application commands');
    assert(native.snapshot[0].label === '_File', 'Exported headings must remain unchanged');
    print(JSON.stringify({languages: GLib.get_language_names(), translated: expected,
        nativeQuit: 'Quit', nativeHeading: '_File'}));
}

run().catch(error => {
    printerr(`${error.message}\n${error.stack}`);
    failed = true;
}).finally(() => {
    for (const source of sources)
        source.destroy();
    loop.quit();
});
loop.run();
if (failed)
    imports.system.exit(1);
