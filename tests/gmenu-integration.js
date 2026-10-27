// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {GMenuSource} from '../extension/gmenuSource.js';
import {sourceForWindow} from '../extension/windowSource.js';
import {FilesDesktopSource} from '../extension/filesDesktopSource.js';

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
    const placement = new GMenuSource(bus, {busName: owner, menuPath: '/lab/menu/placement',
        appPath: '/lab/app'}, () => {});
    sources.push(placement);
    await waitFor(() => find(placement, 'Native preferences in Edit')?.enabled,
        'original menu placement loads');
    assert(placement.snapshot[0].label === 'Native Edit' &&
        placement.snapshot[0].children[0].label === 'Native preferences in Edit',
    'Original headings and nested labels must keep their positions');
    assert(!placement.applicationMenu.some(item => item.action === 'app.preferences'),
        'An existing native command must not be duplicated into a generated application menu');
    print('PASS: native command placement is preserved without duplicating it under the app name');
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
    const generic = new GMenuSource(bus, {busName: owner, appPath: '/lab/app',
        windowPath: '/lab/window/1', applicationId: 'org.example.Unprofiled'}, () => {});
    sources.push(generic);
    await waitFor(() => generic.applicationMenu.some(item => item.action === 'app.preferences'),
        'unprofiled application actions finish loading');
    assert(generic.snapshot.length === 0,
        'An action inventory without menu placement must not invent a menubar');
    assert(!flatten(actionsOnly.snapshot).some(item =>
        item.id.startsWith('actions/extra/') || item.id === 'actions/menu/additional'),
    'Partial adapters must not append an invented catch-all menu');
    print('PASS: action inventories without menu placement do not create invented menus');
    first.setCaptured(true);
    await waitFor(() => !group1.get_action_state('show-menubar').unpack(), 'local menubar hides after capture');
    assert(group2.get_action_state('show-menubar').unpack(), 'Other window keeps its local menubar');
    group1.change_action_state('show-menubar', new GLib.Variant('b', true));
    await waitFor(() => !group1.get_action_state('show-menubar').unpack(), 'capture keeps the local menubar hidden');
    first.setCaptured(false);
    await waitFor(() => group1.get_action_state('show-menubar').unpack(), 'local menubar restores');
    group1.change_action_state('show-menubar', new GLib.Variant('b', false));
    await waitFor(() => !group1.get_action_state('show-menubar').unpack(), 'initial hidden preference');
    first.setCaptured(true);
    first.setCaptured(false);
    assert(!group1.get_action_state('show-menubar').unpack(), 'Originally hidden menubar stays hidden');
    group1.change_action_state('show-menubar', new GLib.Variant('b', true));
    await waitFor(() => group1.get_action_state('show-menubar').unpack(), 'restore initial preference');
    print('PASS: captured native menus hide locally and restore the original window preference');
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
    const capture = new GMenuSource(bus, {busName: owner, menuPath: '/lab/menu/2',
        appPath: '/lab/app', windowPath: '/lab/window/2'}, () => {});
    sources.push(capture);
    await waitFor(() => capture.snapshot.length && capture._groups.get('win')?.has_action('show-menubar'),
        'temporary captured source');
    capture.setCaptured(true);
    await waitFor(() => !group2.get_action_state('show-menubar').unpack(), 'temporary source hides menu');
    capture.destroy();
    await waitFor(() => group2.get_action_state('show-menubar').unpack(), 'destruction restores local menu');
    print('PASS: disposing a captured source restores its local menubar');
    let openedWindows = 0;
    let openedHomes = 0;
    const desktop = new FilesDesktopSource(bus, {
        openWindow: () => openedWindows++, openHome: () => openedHomes++,
    }, () => {}, text => text, owner);
    sources.push(desktop);
    const desktopItem = action => flatten([...desktop.snapshot, ...desktop.applicationMenu])
        .find(node => node.action === action);
    await waitFor(() => desktopItem('app.preferences')?.enabled && desktop.snapshot.length === 5,
        'windowless Files desktop source and live application commands');
    assert(desktopItem('app.new-window').enabled && desktopItem('win.go-home').enabled,
        'Desktop launchers must remain enabled without a client window');
    assert(!desktopItem('win.new-tab').enabled && !desktop.activate(desktopItem('win.new-tab')),
        'A desktop menu must not invent a target for window commands');
    assert(!desktopItem('app.clone-window').enabled,
        'An application-scoped duplicate-window action still requires a window');
    desktop.activate(desktopItem('app.new-window'));
    desktop.activate(desktopItem('win.go-home'));
    assert(openedWindows === 1 && openedHomes === 1, 'Desktop commands must reach their launchers');
    assert(desktop.activate(desktopItem('app.preferences')), 'Windowless preferences must reach its actual exporter');
    await waitFor(() => appGroup.get_action_state('preferences-count').unpack() === 2,
        'desktop preferences uses the real exported application action');
    print('PASS: windowless Files keeps structured menus, working launchers and only actual application actions');
    const oldDesktopPreferences = desktopItem('app.preferences');
    const app = Gio.DBusActionGroup.get(bus, owner, '/lab/app');
    app.list_actions();
    await waitFor(() => app.has_action('quit'), 'quit action');
    app.activate_action('quit', null);
    await waitFor(() => second.closed, 'service disappearance invalidates source');
    assert(second.snapshot.length === 0, 'Lost service must clear menu');
    print('PASS: owner disappearance clears the source');
    await waitFor(() => !desktopItem('app.preferences').enabled && desktop.descriptor.busName === null,
        'desktop releases the lost application owner');
    assert(!desktop.closed && desktop.snapshot.length === 5 && desktopItem('app.new-window').enabled,
        'Structured desktop menus must survive Files stopping');
    assert(!desktop.activate(oldDesktopPreferences), 'Old owner commands must not reach a replacement exporter');
    const staleDesktopLauncher = desktopItem('app.new-window');
    desktop.destroy();
    assert(desktop.closed && !desktop.activate(staleDesktopLauncher),
        'A disposed desktop source must reject its old launchers');
    print('PASS: Files desktop menus survive owner loss and release all actions on disposal');
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
