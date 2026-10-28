// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import GLib from 'gi://GLib';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}
async function until(predicate, message) {
    const deadline = GLib.get_monotonic_time() + 8000000;
    while (GLib.get_monotonic_time() < deadline) {
        if (predicate())
            return;
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
    }
    throw new Error(`Timed out: ${message}`);
}

export async function verifyElectronPanel(records, observationPath, commandPath, state) {
    const observe = () => {
        const [, bytes] = GLib.file_get_contents(observationPath);
        return JSON.parse(imports.byteArray.toString(bytes));
    };
    let sequence = 0;
    const command = async (operation, args = {}) => {
        const id = ++sequence;
        GLib.file_set_contents(commandPath, JSON.stringify({id, operation, ...args}));
        await until(() => observe().reply?.id === id, `private panel ${operation}`);
        const reply = observe().reply;
        assert(reply.success, `Panel ${operation}: ${reply.error}`);
        return reply.result;
    };
    const panel = () => observe().panel;
    const open = label => panel().menus?.some(menu => menu.label === label && menu.open);
    const item = label => panel().items?.find(entry => entry.label === label);
    const focus = async index => {
        await command('focus', {windowPath: records[index].descriptor.windowPath});
        await until(() => panel().windowPath === records[index].descriptor.windowPath &&
            item('Increment this window')?.enabled, 'panel selects the exact fixture window');
    };
    try {
        await focus(0);
        assert(panel().buttons.slice(1).map(button => button.label).join(',') === 'File,View', 'Panel retains original native headings');
        await command('open', {label: 'File'});
        await until(() => open('File') && item('Disabled command') && !item('Disabled command').enabled, 'native availability in open panel menu');
        await command('stash', {label: 'Increment this window'});
        await focus(1);
        await until(() => panel().menus.every(menu => !menu.open), 'focus switch does not transfer an open menu');
        const beforeStale = state().windows.map(window => window.counter);
        assert(await command('activate-stale') === false, 'Old panel source rejects retained commands after focus switch');
        assert(state().windows.every((window, index) => window.counter === beforeStale[index]), 'Focus switch cannot redirect a retained command');
        print('PASS: Actual Shell panel follows exact fixture focus, retains native headings and closes old-window menus without redirecting stale commands');
        await command('open', {label: 'File'});
        await until(() => open('File') && item('Tools')?.enabled, 'nested heading becomes actionable in the current generation');
        await command('open', {label: 'Tools'});
        await until(() => open('File') && open('Tools') && item('Nested increment')?.enabled,
            'actual nested panel opening prepares lazy native contents and survives publication');
        const beforeNested = state().windows.map(window => window.counter);
        await command('activate', {label: 'Nested increment'});
        await until(() => state().windows[1].counter === beforeNested[1] + 1, 'nested panel actor reaches the native handler');
        assert(state().windows[0].counter === beforeNested[0], 'Nested panel command stays on its original window');
        print('PASS: Actual nested Shell menus prepare lazy Electron contents, retain their open hierarchy across updates and invoke the correct native window');
        await command('open', {label: 'File'});
        await until(() => open('File'), 'File is open before external native layout replacement');
        const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children)]);
        const nativeChange = flatten(records[1].source.snapshot).find(node => node.label === 'Add dynamic command');
        assert(records[1].source.activate(nativeChange), 'Independent consumer can trigger native layout replacement while panel is open');
        await until(() => state().windows[1].dynamic && open('File') && item('Dynamic command')?.enabled,
            'actual panel reopens the current native heading and imports its new lazy action generation');
        await command('capture');
        const beforeDynamic = state().windows.map(window => window.counter);
        await command('activate', {label: 'Dynamic command'});
        await until(() => state().windows[1].counter === beforeDynamic[1] + 1, 'new dynamic panel actor reaches the native handler');
        assert(state().windows[0].counter === beforeDynamic[0], 'Dynamic panel command stays scoped');
        print('PASS: An open actual Shell menu survives external native model replacement and its new dynamic command reaches only the selected window');
        await command('open', {label: 'File'});
        await focus(0);
        await until(() => panel().menus.every(menu => !menu.open), 'returning to another window leaves its menus closed');
        await command('open', {label: 'File'});
        await until(() => open('File') && item('Tools')?.enabled, 'first-window lazy submenu is available');
        assert(!item('Nested increment'), 'First-window nested contents have not been prepared by the other window');
        await command('open-close', {label: 'Tools', parent: 'File'});
        await until(() => item('Nested increment')?.enabled && panel().menus.every(menu => !menu.open),
            'late native submenu publication respects explicit user closure');
        await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
        assert(panel().menus.every(menu => !menu.open), 'Explicit closure remains authoritative beyond the restoration interval');
        print('PASS: Closing an actual panel menu during native lazy preparation prevents late updates from reopening it');
        return {success: true, scope: 'Private production Shell renderer, fixture-provided X11 identities, actor API input',
            finalPanel: panel(), screenshot: 'electron-panel.png'};
    } catch (error) {
        GLib.file_set_contents(`${ARGV[1]}.panel-failure.json`, JSON.stringify(observe(), null, 2));
        throw error;
    }
}
