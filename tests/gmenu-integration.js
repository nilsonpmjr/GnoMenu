// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {GMenuSource} from '../extension/gmenuSource.js';
import {sourceForWindow} from '../extension/windowSource.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function waitFor(predicate, message, timeout = 4000) {
    const start = GLib.get_monotonic_time();
    return new Promise((resolve, reject) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            try {
                if (predicate()) {
                    resolve();
                    return GLib.SOURCE_REMOVE;
                }
                if ((GLib.get_monotonic_time() - start) / 1000 > timeout)
                    throw new Error(`Timed out: ${message}`);
            } catch (error) {
                reject(error);
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    });
}

function flatten(items) {
    return items.flatMap(item => [item, ...flatten(item.children)]);
}

const owner = ARGV[0];
const bus = Gio.DBus.session;
const sources = [];
const loop = new GLib.MainLoop(null, false);
let failure = false;

async function run() {
    assert(sourceForWindow(null) === null, 'No window means no source');
    const fakeWindow = {
        get_gtk_unique_bus_name: () => owner,
        get_gtk_menubar_object_path: () => '/lab/menu/1',
        get_gtk_app_menu_object_path: () => null,
        get_gtk_application_object_path: () => '/lab/app',
        get_gtk_window_object_path: () => '/lab/window/1',
    };
    assert(sourceForWindow(fakeWindow).windowPath === '/lab/window/1',
        'Window identity must be preserved');
    assert(sourceForWindow({...fakeWindow, get_gtk_menubar_object_path: () => null}) !== null,
        'Exported actions must remain discoverable without any menu model');
    assert(sourceForWindow({...fakeWindow, get_gtk_unique_bus_name: () => 'org.example.App'}) === null,
        'Discovery rejects an unpinned well-known name');
    for (const number of [1, 2]) {
        sources.push(new GMenuSource(bus, {
            busName: owner, menuPath: `/lab/menu/${number}`,
            appPath: '/lab/app', windowPath: `/lab/window/${number}`,
            appMenuPath: number === 1 ? '/lab/application/menu' : null,
        }, () => {}));
    }
    const [first, second] = sources;
    const find = (source, label) => flatten(source.snapshot).find(item => item.label === label);
    await waitFor(() => find(first, 'Check')?.enabled && find(second, 'Check')?.enabled,
        'recursive models and action groups load asynchronously');
    print('PASS: recursive exported menus load for two independent windows');
    await waitFor(() => first.applicationMenu.some(item => item.label === 'Native settings label') &&
        second.applicationMenu.some(item => item.action === 'app.preferences'), 'application menu sources');
    const native = first.applicationMenu.filter(item => item.action === 'app.preferences');
    assert(native.length === 1 && native[0].label === 'Native settings label',
        'Exported application menu must take precedence over fallback labels');
    assert(!first.applicationMenu.some(item => item.action === 'app.settings'),
        'Equivalent settings fallback must not be duplicated');
    assert(!second.applicationMenu.some(item => item.action === 'app.about'),
        'Parameterized app action must not be guessed');
    const appGroup = first._groups.get('app');
    await waitFor(() => appGroup.has_action('preferences-count'), 'preferences counter');
    first.activate(native[0]);
    await waitFor(() => appGroup.get_action_state('preferences-count').unpack() === 1,
        'application settings dispatch');
    print('PASS: native application menu, settings fallback and app-scoped dispatch');
    const appOnly = new GMenuSource(bus, {busName: owner, menuPath: null,
        appMenuPath: '/lab/application/menu', appPath: '/lab/app', windowPath: null}, () => {});
    sources.push(appOnly);
    await waitFor(() => appOnly.applicationMenu.some(node => node.label === 'Native settings label'),
        'application menu without a menubar');
    assert(appOnly.snapshot.length === 0, 'Application menu must not be duplicated as a menubar');
    print('PASS: an application-menu-only source retains its separate identity');
    assert(find(first, '_File').children.some(item => item.kind === 'section'),
        'Section hierarchy is retained');
    assert(!first.activate(find(first, 'Disabled')), 'Disabled action must be rejected');
    assert(!first.activate({...find(first, 'Mode one'), target: new GLib.Variant('i', 3)}),
        'Wrong parameter type must be rejected');
    print('PASS: disabled actions and incompatible targets are rejected');
    const group1 = Gio.DBusActionGroup.get(bus, owner, '/lab/window/1');
    const group2 = Gio.DBusActionGroup.get(bus, owner, '/lab/window/2');
    group1.list_actions();
    group2.list_actions();
    await waitFor(() => group1.has_action('counter') && group2.has_action('counter'), 'counters');
    assert(first.activate(find(first, 'Increment window 1')), 'Increment must dispatch');
    await waitFor(() => group1.get_action_state('counter').unpack() === 1, 'first window action');
    assert(group2.get_action_state('counter').unpack() === 0, 'Second window must not receive action');
    assert(second.activate(find(second, 'Increment window 2')), 'Second window must dispatch');
    await waitFor(() => group2.get_action_state('counter').unpack() === 1, 'second window action');
    print('PASS: actions reach only their bound window');
    const actionsOnly = new GMenuSource(bus, {busName: owner, menuPath: null,
        appPath: '/lab/app', windowPath: '/lab/window/1', applicationId: 'org.gnome.Nautilus'}, () => {});
    sources.push(actionsOnly);
    await waitFor(() => find(actionsOnly, 'New Tab')?.enabled, 'actions-only adapter');
    assert(actionsOnly.partial && actionsOnly.applicationMenu.some(item => item.action === 'app.preferences'),
        'Actions-only source must retain app preferences and declare partial support');
    assert(!flatten(actionsOnly.snapshot).some(item => item.action === 'app.new-window'),
        'Known command with incompatible parameter type must be excluded');
    assert(actionsOnly.activate(find(actionsOnly, 'New Tab')), 'Adapter must invoke the real exported command');
    await waitFor(() => group1.get_action_state('tabs').unpack() === 1, 'adapted window action');
    assert(group2.get_action_state('tabs').unpack() === 0, 'Adapted action must stay window-scoped');
    print('PASS: actions-only profiles expose only compatible exports and keep window scope');
    const drawnIncrement = find(first, 'Increment window 1');
    first.activate(find(first, 'Check'));
    await waitFor(() => find(first, 'Check').toggle.checked, 'boolean state update');
    assert(!find(second, 'Check').toggle.checked, 'Check state must be window-scoped');
    first.activate(find(first, 'Mode two'));
    await waitFor(() => find(first, 'Mode two').toggle.checked, 'radio target state update');
    assert(!find(first, 'Mode one').toggle.checked, 'Old radio target must clear');
    first.activate(find(first, 'Enable disabled item'));
    await waitFor(() => find(first, 'Disabled').enabled, 'enabled state update');
    print('PASS: boolean, radio and enabled state changes propagate');
    assert(first.activate(drawnIncrement), 'Unchanged visible action must remain usable after state refresh');
    await waitFor(() => group1.get_action_state('counter').unpack() === 2, 'click from a previous drawing');
    assert(!first.activate(find(second, 'Increment window 2')), 'Foreign source nodes must be rejected');
    print('PASS: state refresh retains valid clicks while rejecting nodes from other windows');
    first.activate(find(first, 'Add dynamic item'));
    await waitFor(() => find(first, 'Dynamic command'), 'dynamic menu item');
    assert(!find(second, 'Dynamic command'), 'Dynamic structure must be window-scoped');
    print('PASS: live structural menu changes propagate');
    first.activate(find(first, 'Replace first item'));
    await waitFor(() => find(first, 'Replacement action'), 'item replacement');
    assert(!first.activate(drawnIncrement), 'Reused positions must not execute their previous command');
    print('PASS: replaced menu positions reject obsolete action identities');
    first.activate(find(first, 'Expand large menu'));
    await waitFor(() => first.truncated, 'bounded traversal of oversized menu');
    assert(flatten([...first.snapshot, ...first.applicationMenu]).length <= 512,
        'Combined app and window menu traversal must stay bounded');
    print('PASS: oversized remote menus are bounded and marked as truncated');
    const stale = find(first, 'Dynamic command');
    first.destroy();
    assert(!first.activate(stale), 'Disposed source must reject old clicks');
    assert(first.snapshot.length === 0, 'Disposed source clears its snapshot');
    first.destroy();
    print('PASS: source disposal is idempotent and stale activation is rejected');
    const app = Gio.DBusActionGroup.get(bus, owner, '/lab/app');
    app.list_actions();
    await waitFor(() => app.has_action('quit'), 'quit action');
    app.activate_action('quit', null);
    await waitFor(() => second.closed, 'service disappearance invalidates source');
    assert(second.snapshot.length === 0, 'Lost service must clear menu');
    print('PASS: owner disappearance clears the source');
}

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
