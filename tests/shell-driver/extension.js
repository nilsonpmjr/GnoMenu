// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = GLib.getenv('GNOMENU_UUID');

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function waitFor(predicate, message, timeout = 12000) {
    const start = GLib.get_monotonic_time();
    return new Promise((resolve, reject) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            try {
                const value = predicate();
                if (value) {
                    resolve(value);
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

export default class ShellTestDriver extends Extension {
    enable() {
        // The driver is never enabled outside the private test harness.
        const reportPath = GLib.getenv('GNOMENU_REPORT');
        if (!reportPath)
            return;
        // The manager may rebase this driver while the tested extension is
        // disabled. Keep the existing run; do not launch a second test run.
        if (this._started)
            return;
        this._started = true;
        const passed = [];
        const run = GLib.getenv('GNOMENU_TEST_NATIVE_EXPORTER') === '1' ? this._runNativeExporter(passed) :
            GLib.getenv('GNOMENU_REAL_APPS') === '1' ? this._runRealApps(passed) : this._run(passed);
        run.then(() => {
            GLib.file_set_contents(reportPath, JSON.stringify({success: true, passed}, null, 2));
        }).catch(error => {
            console.error(error);
            GLib.file_set_contents(reportPath,
                JSON.stringify({success: false, passed, error: `${error.message}\n${error.stack}`}, null, 2));
        });
    }

    async _runNativeExporter(passed) {
        const extension = await waitFor(() => Main.extensionManager.lookup(UUID)?.stateObj, 'extension loads');
        await waitFor(() => !Main.layoutManager._startingUp, 'Shell starts');
        Main.overview.hide();
        await waitFor(() => !Main.overview.visible && !Main.overview.animationInProgress, 'overview hides');
        const windows = await waitFor(() => {
            const found = global.get_window_actors().map(actor => actor.meta_window)
                .filter(window => window.get_gtk_application_id() === 'org.gnome.Nautilus');
            return found.length === 2 ? found.sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence()) : null;
        }, 'two real Files windows');
        const binding = action => extension._bindings.find(entry => entry.actor._menuLabNode?.action === action);
        const select = async window => {
            Main.activateWindow(window, global.get_current_time());
            await waitFor(() => global.display.focus_window === window &&
                extension._source?.descriptor.windowPath === window.get_gtk_window_object_path() &&
                extension._source.descriptor.menuPath && binding('win.gnomenu.view.show-hidden-files')?.actor.sensitive,
            'real native menu and widget action proxies are imported', 16000);
        };
        const observe = async window => {
            const process = Gio.Subprocess.new(['python3', GLib.getenv('GNOMENU_OBSERVER'),
                String(window.get_pid()), window.title], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            return new Promise((resolve, reject) => process.communicate_utf8_async(null, null, (child, result) => {
                try {
                    const [, stdout, stderr] = child.communicate_utf8_finish(result);
                    if (!child.get_successful())
                        throw new Error(stderr);
                    resolve(JSON.parse(stdout));
                } catch (error) {
                    reject(error);
                }
            }));
        };
        const waitHidden = async (window, visible) => {
            const deadline = GLib.get_monotonic_time() + 8000000;
            while (GLib.get_monotonic_time() < deadline) {
                const state = await observe(window);
                if (state.found && state.names?.some(name => name.includes('.gnomenu-hidden-test')) === visible)
                    return state;
            }
            throw new Error(`Actual hidden-file visibility did not become ${visible}`);
        };
        await select(windows[0]);
        await waitFor(() => binding('win.gnomenu.slot.reload')?.actor.sensitive && extension._buttons.length === 4,
            'native current-folder model and its slot actions are imported');
        assert(!extension._source.partial,
            'Bridge must import the three actual menu models, without synthetic categories');
        assert(binding('win.gnomenu.view.zoom-in') && binding('win.gnomenu.view.sort') &&
            binding('win.gnomenu.view.show-hidden-files'), 'Native custom zoom, typed sort and hidden-file commands must exist');
        const firstGroup = extension._source._groups.get('win');
        await waitFor(() => firstGroup.has_action('show-menubar') &&
            !firstGroup.get_action_state('show-menubar').unpack(), 'captured native controls hide');
        passed.push('Real Main, View Options and Current Folder models import with native captions, widget actions and typed targets');
        await waitHidden(windows[0], false);
        binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
        await waitFor(() => binding('win.gnomenu.view.show-hidden-files').actor._menuLabNode.toggle.checked,
            'native hidden-file state updates');
        const visible = await waitHidden(windows[0], true);
        await select(windows[1]);
        await waitFor(() => firstGroup.get_action_state('show-menubar').unpack(), 'previous window controls restore');
        await waitFor(() => binding('win.gnomenu.view.show-hidden-files').actor._menuLabNode.toggle.checked,
            'Nautilus propagates its native shared hidden-file preference');
        await waitHidden(windows[1], true);
        const secondGroup = extension._source._groups.get('win');
        const secondSortBefore = secondGroup.get_action_state('gnomenu.view.sort');
        passed.push('Imported widget command reveals real hidden files and preserves Nautilus shared-preference behavior');
        await select(windows[0]);
        binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
        await waitHidden(windows[0], false);
        const originalSort = firstGroup.get_action_state('gnomenu.view.sort');
        const sort = extension._bindings.find(entry => entry.actor._menuLabNode?.action === 'win.gnomenu.view.sort' &&
            entry.actor._menuLabNode.enabled && !entry.actor._menuLabNode.target.equal(originalSort)).actor;
        assert(sort._menuLabNode.target.get_type_string() === '(sb)', 'Sort targets must retain the original tuple type');
        sort.activate(null);
        await waitFor(() => firstGroup.get_action_state('gnomenu.view.sort').equal(sort._menuLabNode.target),
            'native sort tuple is accepted by the actual widget group');
        await select(windows[1]);
        assert(secondGroup.get_action_state('gnomenu.view.sort').equal(secondSortBefore),
            'Sort command must not change the other directory window');
        await select(windows[0]);
        firstGroup.activate_action('gnomenu.view.sort', originalSort);
        await waitFor(() => firstGroup.get_action_state('gnomenu.view.sort').equal(originalSort), 'restore original sort');
        passed.push('Original tuple sort targets reach the correct Files window and native state can be restored');
        const waitTabs = async expected => {
            const deadline = GLib.get_monotonic_time() + 8000000;
            while (GLib.get_monotonic_time() < deadline) {
                const state = await observe(windows[0]);
                // Nautilus removes the tab bar when only one page remains.
                if (state.found && (expected === 1 ? state.visibleTabEntries <= 1 : state.visibleTabEntries === expected))
                    return;
            }
            throw new Error(`Files did not expose ${expected} actual tabs`);
        };
        for (let cycle = 0; cycle < 3; cycle++) {
            binding('win.new-tab').actor.activate(null);
            await waitTabs(2);
            await waitFor(() => binding('win.gnomenu.view.show-hidden-files')?.actor.sensitive,
                'new tab supplies its current widget actions');
            binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
            await waitHidden(windows[0], true);
            firstGroup.activate_action('close-current-view', null);
            await waitTabs(1);
            await waitFor(() => binding('win.gnomenu.view.show-hidden-files')?.actor._menuLabNode.toggle.checked,
                'remaining tab supplies the shared native preference');
            binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
            await waitHidden(windows[0], false);
        }
        passed.push('Repeated native tab creation and destruction keep commands bound to the live view');
        const rectangle = windows[0].get_frame_rect();
        for (const width of [520, 1100, rectangle.width]) {
            windows[0].move_resize_frame(false, rectangle.x, rectangle.y, width, rectangle.height);
            await waitFor(() => Math.abs(windows[0].get_frame_rect().width - width) < 20,
                'Files resize completes');
            binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
            await waitHidden(windows[0], true);
            binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
            await waitHidden(windows[0], false);
            assert(extension._buttons.length === 4, 'Responsive layout must not duplicate imported menus');
        }
        passed.push('Narrow and wide Files layouts retain working imported commands without duplicate menus');
        const keyboard = global.stage.context.get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const pointer = global.stage.context.get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const viewMode = async (symbol, action) => {
            await select(windows[0]);
            const frame = windows[0].get_frame_rect();
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), frame.x + frame.width / 2,
                frame.y + frame.height * 0.75);
            pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            pointer.notify_button(GLib.get_monotonic_time() + 1000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            await waitFor(() => global.display.focus_window === windows[0], 'Files receives keyboard focus');
            const time = GLib.get_monotonic_time();
            keyboard.notify_keyval(time, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time + 1000, symbol, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time + 2000, symbol, Clutter.KeyState.RELEASED);
            keyboard.notify_keyval(time + 3000, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
            await waitFor(() => binding(action)?.actor.sensitive, 'native view mode updates menu entries');
            binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
            await waitHidden(windows[0], true);
            binding('win.gnomenu.view.show-hidden-files').actor.activate(null);
            await waitHidden(windows[0], false);
        };
        await viewMode(Clutter.KEY_1, 'win.gnomenu.view.visible-columns');
        assert(!binding('win.gnomenu.view.visible-captions'), 'List view must hide native grid-only commands');
        await viewMode(Clutter.KEY_2, 'win.gnomenu.view.visible-captions');
        assert(!binding('win.gnomenu.view.visible-columns'), 'Grid view must hide native list-only commands');
        passed.push('Real keyboard view-mode changes replace native menu entries and preserve live widget commands');
        const fixtureDirectory = window => Gio.File.new_for_path(GLib.build_filenamev([
            GLib.getenv('GNOMENU_TEST_WORKSPACE'),
            window.title.includes('GnoMenu test folder A') ? 'GnoMenu test folder A' : 'GnoMenu test folder B',
        ]));
        const bookmarks = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.getenv('XDG_CONFIG_HOME'), 'gtk-3.0', 'bookmarks',
        ]));
        const bookmarkText = () => bookmarks.query_exists(null) ?
            new globalThis.TextDecoder().decode(bookmarks.load_contents(null)[1]) : '';
        const currentDirectory = fixtureDirectory(windows[0]);
        binding('win.gnomenu.slot.bookmark-current-directory').actor.activate(null);
        await waitFor(() => bookmarkText().includes(currentDirectory.get_uri()) &&
            binding('win.gnomenu.slot.unbookmark-current-directory')?.actor.sensitive &&
            !binding('win.gnomenu.slot.bookmark-current-directory'),
        'native bookmark file and menu change together');
        await select(windows[1]);
        await waitFor(() => binding('win.gnomenu.slot.bookmark-current-directory')?.actor.sensitive,
            'second directory retains its own bookmark action');
        assert(!bookmarkText().includes(fixtureDirectory(windows[1]).get_uri()),
            'Bookmark command must affect only its original directory');
        await select(windows[0]);
        await waitFor(() => binding('win.gnomenu.slot.unbookmark-current-directory')?.actor.sensitive,
            'original directory retains its native remove-bookmark command');
        binding('win.gnomenu.slot.unbookmark-current-directory').actor.activate(null);
        await waitFor(() => !bookmarkText().includes(currentDirectory.get_uri()) &&
            binding('win.gnomenu.slot.bookmark-current-directory')?.actor.sensitive,
        'native bookmark can be removed and original menu restored');
        passed.push('Current Folder bookmark commands change the private native bookmark file for the correct directory');
        binding('win.gnomenu.view.new-folder').actor.activate(null);
        const deadline = GLib.get_monotonic_time() + 8000000;
        let dialogShown = false;
        while (GLib.get_monotonic_time() < deadline) {
            if ((await observe(windows[0])).dialogs?.length) {
                dialogShown = true;
                break;
            }
        }
        assert(dialogShown, 'Imported New Folder command must open the actual native dialog');
        const createdName = 'gnomenu-created-folder';
        for (const character of createdName) {
            const time = GLib.get_monotonic_time();
            keyboard.notify_keyval(time, character.codePointAt(0), Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time + 1000, character.codePointAt(0), Clutter.KeyState.RELEASED);
        }
        await waitFor(() => true, 'deliver private keyboard input');
        keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Return, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(GLib.get_monotonic_time() + 1000, Clutter.KEY_Return, Clutter.KeyState.RELEASED);
        await waitFor(() => currentDirectory.get_child(createdName).query_exists(null),
            'native dialog creates a real folder in the selected directory');
        assert(!fixtureDirectory(windows[1]).get_child(createdName).query_exists(null),
            'New Folder command must not create a directory in the other window');
        passed.push('Imported New Folder opens the native dialog and creates a real folder in the correct window');
        await select(windows[0]);
        await waitFor(() => firstGroup.get_action_state('show-menubar')?.unpack() === false &&
            binding('win.gnomenu.slot.reload')?.actor.sensitive,
        'captured models and local ownership recover after the native dialog closes');
        const directory = GLib.path_get_dirname(GLib.getenv('GNOMENU_REPORT'));
        GLib.file_set_contents(GLib.build_filenamev([directory, 'native-model.json']), JSON.stringify({
            headings: extension._buttons.map(button => button.get_first_child().text),
            menuPath: extension._source.descriptor.menuPath,
            busOwner: extension._source.descriptor.busName,
            windowPaths: windows.map(window => window.get_gtk_window_object_path()),
            actions: extension._bindings.map(entry => ({label: entry.actor.label?.text,
                action: entry.actor._menuLabNode.action, target: entry.actor._menuLabNode.target?.print(true) ?? null})),
            visibleFileEvidence: visible,
        }, null, 2));
        const capture = async name => {
            const stream = Gio.File.new_for_path(GLib.build_filenamev([directory, name]))
                .replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            try {
                await new Shell.Screenshot().screenshot(false, stream);
            } finally {
                stream.close(null);
            }
        };
        const menuFor = action => extension._buttons.find(button => button.menu.actor.contains(binding(action).actor)).menu;
        menuFor('win.gnomenu.view.show-hidden-files').open(0);
        await capture('native-menu.png');
        menuFor('win.gnomenu.view.show-hidden-files').close(0);
        menuFor('app.preferences').open(0);
        await capture('native-main-menu.png');
        menuFor('app.preferences').close(0);
        menuFor('win.gnomenu.slot.reload').open(0);
        await capture('native-current-folder.png');
        menuFor('win.gnomenu.slot.reload').close(0);
        await Main.extensionManager.disableExtension(UUID);
        await waitFor(() => firstGroup.get_action_state('show-menubar')?.unpack() && extension._buttons.length === 0,
            'disable restores the original controls');
        await capture('native-controls-restored.png');
        passed.push('Switching windows and disabling the extension restore the original native menu controls');
    }

    async _runRealApps(passed) {
        const extension = await waitFor(() => Main.extensionManager.lookup(UUID)?.stateObj,
            'GnoMenu is loaded');
        await waitFor(() => !Main.layoutManager._startingUp, 'Shell startup');
        Main.overview.hide();
        await waitFor(() => !Main.overview.visible && !Main.overview.animationInProgress,
            'overview finishes hiding');
        const windowsFor = id => global.get_window_actors().map(actor => actor.meta_window)
            .filter(window => window.get_gtk_application_id() === id)
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        const nautilus = await waitFor(() => windowsFor('org.gnome.Nautilus').length === 2 &&
            windowsFor('org.gnome.Nautilus'), 'two real Nautilus windows');
        const terminals = await waitFor(() => windowsFor('org.gnome.Ptyxis').length === 2 &&
            windowsFor('org.gnome.Ptyxis'), 'two real Ptyxis windows');
        const binding = action => extension._bindings.find(entry => entry.actor._menuLabNode?.action === action);
        const inventory = name => {
            const actions = [];
            for (const [prefix, group] of extension._source._groups) {
                for (const action of group.list_actions().sort()) {
                    actions.push({action: `${prefix}.${action}`,
                        parameter: group.get_action_parameter_type(action)?.dup_string() ?? null,
                        state: group.get_action_state(action)?.print(true) ?? null,
                        hint: group.get_action_state_hint(action)?.print(true) ?? null,
                        enabled: group.get_action_enabled(action)});
                }
            }
            GLib.file_set_contents(GLib.build_filenamev([
                GLib.path_get_dirname(GLib.getenv('GNOMENU_REPORT')), `${name}-actions.json`]),
            JSON.stringify(actions, null, 2));
        };
        const select = async (window, action) => {
            Main.activateWindow(window, global.get_current_time());
            await waitFor(() => global.display.focus_window === window &&
                extension._source?.descriptor.windowPath === window.get_gtk_window_object_path() &&
                binding(action)?.actor._menuLabNode.enabled, 'real-window source and exported action');
        };
        const screenshot = async name => {
            const path = GLib.build_filenamev([GLib.path_get_dirname(GLib.getenv('GNOMENU_REPORT')), name]);
            const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            try {
                await new Shell.Screenshot().screenshot(false, stream);
            } finally {
                stream.close(null);
            }
        };
        const observe = async window => {
            const process = Gio.Subprocess.new(['python3', GLib.getenv('GNOMENU_OBSERVER'),
                String(window.get_pid()), window.title],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            return new Promise((resolve, reject) => process.communicate_utf8_async(null, null,
                (child, result) => {
                    try {
                        const [, stdout, stderr] = child.communicate_utf8_finish(result);
                        if (!child.get_successful())
                            throw new Error(stderr);
                        resolve(JSON.parse(stdout));
                    } catch (error) {
                        reject(error);
                    }
                }));
        };
        const waitObserved = async (window, predicate) => {
            const deadline = GLib.get_monotonic_time() + 8000000;
            let result;
            while (GLib.get_monotonic_time() < deadline) {
                result = await observe(window);
                if (result.found && predicate(result))
                    return result;
            }
            throw new Error(`Real accessibility observation failed: ${JSON.stringify(result)}`);
        };
        await select(nautilus[0], 'win.new-tab');
        inventory('nautilus');
        assert(extension._source.partial && !extension._source.descriptor.menuPath,
            'Real Nautilus must be discovered through its exported actions');
        assert(binding('app.preferences')?.actor.sensitive, 'Nautilus preferences must be exposed');
        const tracker = Shell.WindowTracker.get_default();
        assert(extension._buttons[0].get_first_child().text === tracker.get_window_app(nautilus[0]).get_name(),
            'Real app identity must be shown before its menus');
        assert(extension._buttons[1].get_first_child().text === extension.gettext('File'),
            'Partial menu headings must follow the session language');
        const expectedHeadings = [tracker.get_window_app(nautilus[0]).get_name(),
            ...['File', 'Edit', 'View', 'Go', 'Help'].map(title => extension.gettext(title))];
        assert(JSON.stringify(extension._buttons.map(button => button.get_first_child().text)) ===
            JSON.stringify(expectedHeadings), 'Files must not gain an invented catch-all heading');
        assert(!binding('app.kill') && !binding('win.current-location-menu'),
            'Internal action names without menu placement must not leak into the global menu');
        assert(extension._buttons[0].menu._getMenuItems().some(item => item.label?.text === extension.gettext('Partial menu')),
            'Synthesized menu must be identified as partial');
        passed.push('Real Nautilus is discovered without a menu model and displays its localized partial menu');
        const firstSource = extension._source;
        const firstBefore = await waitObserved(nautilus[0], () => true);
        const secondBefore = await waitObserved(nautilus[1], () => true);
        binding('win.new-tab').actor.activate(null);
        const firstAfter = await waitObserved(nautilus[0], state =>
            state.visibleTabEntries >= Math.max(2, firstBefore.visibleTabEntries + 1));
        await screenshot('nautilus-after-new-tab.png');
        await select(nautilus[1], 'win.new-tab');
        const secondAfter = await waitObserved(nautilus[1], () => true);
        assert(secondAfter.visibleTabEntries === secondBefore.visibleTabEntries,
            'Other Nautilus window must keep its single tab');
        assert(firstSource.closed, 'Switching real windows must dispose the old source');
        await select(nautilus[0], 'win.close-current-view');
        binding('win.close-current-view').actor.activate(null);
        const restored = await waitObserved(nautilus[0], state =>
            state.visibleTabEntries === firstBefore.visibleTabEntries);
        GLib.file_set_contents(GLib.build_filenamev([
            GLib.path_get_dirname(GLib.getenv('GNOMENU_REPORT')), 'nautilus-tabs.json']),
        JSON.stringify({firstBefore, firstAfter, secondBefore, secondAfter, restored}, null, 2));
        extension._buttons[1].menu.open(0);
        await screenshot('nautilus-menu.png');
        extension._buttons[1].menu.close(0);
        passed.push('Global New Tab and Close Tab affect only the selected real Nautilus window');
        await select(terminals[0], 'win.tab.read-only');
        inventory('ptyxis');
        assert(binding('app.preferences')?.actor.sensitive && binding('app.new-window')?.actor.sensitive &&
            binding('app.new-tab')?.actor.sensitive, 'Real Ptyxis exported commands must be present');
        const terminalSource = extension._source;
        const terminalGroup = terminalSource._groups.get('win');
        assert(!terminalGroup.get_action_state('tab.read-only').unpack(), 'Test terminal starts writable');
        binding('win.tab.read-only').actor.activate(null);
        await waitFor(() => terminalGroup.get_action_state('tab.read-only').unpack() &&
            binding('win.tab.read-only').actor._menuLabNode.toggle.checked,
        'Read-only state updates in the terminal and global menu');
        await select(terminals[1], 'win.tab.read-only');
        assert(!extension._source._groups.get('win').get_action_state('tab.read-only').unpack(),
            'Other terminal window must remain writable');
        passed.push('Real Ptyxis displays preferences, window/tab commands and window-scoped read-only state');
        await select(terminals[0], 'win.tab.read-only');
        binding('win.tab.read-only').actor.activate(null);
        await waitFor(() => !extension._source._groups.get('win').get_action_state('tab.read-only').unpack(),
            'Restore writable test terminal');
        extension._buttons[2].menu.open(0);
        await screenshot('ptyxis-menu.png');
        extension._buttons[2].menu.close(0);
        passed.push('Ptyxis action state stays isolated between two real windows and can be restored');
        await select(nautilus[1], 'win.new-tab');
        const desktopTarget = nautilus[1];
        const unsupported = await waitFor(() => windowsFor('org.example.GnoMenuNoMenu')[0],
            'unsupported application in the real-app session');
        Main.activateWindow(unsupported, global.get_current_time());
        await waitFor(() => global.display.focus_window === unsupported && !extension._desktopMode &&
            extension._window === unsupported && !extension._source && extension._bindings.length === 0 &&
            extension._buttons[0]?.get_first_child().text === tracker.get_window_app(unsupported).get_name(),
        'unsupported application keeps its own identity while Files is running');
        assert(!binding('win.new-tab'), 'Unsupported application must not inherit Files commands');
        passed.push('An unsupported focused application keeps its own title without inheriting Files commands');
        const beforeDesktop = await observe(desktopTarget);
        for (const window of [...nautilus, ...terminals, unsupported])
            window.minimize();
        await waitFor(() => !global.display.focus_window && extension._desktopMode &&
            extension._source?.descriptor.windowPath === desktopTarget.get_gtk_window_object_path(),
        'desktop retains the last exact Files window');
        assert(extension._buttons[0].get_first_child().text === tracker.get_window_app(desktopTarget).get_name(),
            'Desktop must display Files identity');
        binding('win.new-tab').actor.activate(null);
        await select(desktopTarget, 'win.close-current-view');
        await waitObserved(desktopTarget, state =>
            state.visibleTabEntries === Math.max(2, beforeDesktop.visibleTabEntries + 1));
        binding('win.close-current-view').actor.activate(null);
        await waitObserved(desktopTarget, state => state.visibleTabEntries === beforeDesktop.visibleTabEntries);
        passed.push('Desktop retains Files identity and New Tab reaches the remembered Files window');
        for (const window of nautilus)
            window.delete(global.get_current_time());
        await waitFor(() => windowsFor('org.gnome.Nautilus').length === 0 &&
            !global.display.focus_window && extension._desktopMode &&
            extension._source === extension._desktopSource && extension._buttons.length === 6,
        'closing every Files window retains its desktop menu headings');
        assert(JSON.stringify(extension._buttons.map(button => button.get_first_child().text)) ===
            JSON.stringify(expectedHeadings), 'Windowless desktop must keep the same Files headings');
        assert(binding('app.new-window')?.actor.sensitive && binding('win.go-home')?.actor.sensitive,
            'Windowless Files must expose its launchers in File and Go');
        assert(!binding('win.new-tab')?.actor.sensitive && !binding('win.close-current-view')?.actor.sensitive &&
            !binding('win.undo')?.actor.sensitive && !binding('app.clone-window')?.actor.sensitive,
        'Window-only commands must stay disabled without a Files window');
        await waitFor(() => Main.wm._destroying.size === 0, 'Files closing animations finish');
        extension._buttons[1].menu.open(0);
        await screenshot('files-desktop-no-window.png');
        extension._buttons[1].menu.close(0);
        passed.push('Desktop keeps all Files categories after the last window closes, with window actions disabled');
        const current = extension._source;
        await Main.extensionManager.disableExtension(UUID);
        await waitFor(() => current.closed && extension._buttons.length === 0, 'real app cleanup');
        passed.push('Extension cleans up its real-app sources and panel buttons on disable');
    }

    async _run(passed) {
        const extension = await waitFor(() => Main.extensionManager.lookup(UUID)?.stateObj,
            'extension is loaded');
        await waitFor(() => !Main.layoutManager._startingUp, 'Shell startup');
        Main.overview.hide();
        await waitFor(() => !Main.overview.visible && !Main.overview.animationInProgress,
            'overview hide animation completes');
        const windows = await waitFor(() => {
            const found = global.get_window_actors().map(actor => actor.meta_window)
                .filter(window => window.get_gtk_application_id() === 'org.example.GnoMenuDemo');
            return found.length === 2 ? found : null;
        }, 'two GTK demo windows');
        windows.sort((a, b) => a.title.localeCompare(b.title));
        const select = async window => {
            Main.activateWindow(window, global.get_current_time());
            await waitFor(() => global.display.focus_window === window &&
                extension._source?.descriptor.windowPath === window.get_gtk_window_object_path() &&
                extension._bindings.some(binding => binding.actor._menuLabNode?.action === 'win.increment'),
            'window focus and matching menu source');
        };
        const binding = action => extension._bindings.find(candidate =>
            candidate.actor._menuLabNode?.action === action);
        await select(windows[0]);
        assert(extension._buttons.length === 3, 'App name must precede the two exported headings');
        assert(extension._buttons[0].get_first_child().text === 'GnoMenu Demo',
            'First heading must use desktop app identity, not the window title');
        assert(extension._buttons[1].get_first_child().text === 'Arquivo', 'Mnemonic must be stripped');
        assert(!binding('win.blocked').actor.sensitive, 'Disabled item must be insensitive');
        assert(binding('win.checked').actor.accessible_role === Atk.Role.CHECK_MENU_ITEM &&
            binding('win.mode').actor.accessible_role === Atk.Role.RADIO_MENU_ITEM &&
            binding('win.increment').actor.accessible_role === Atk.Role.MENU_ITEM,
        'Commands must expose checkbox, radio and ordinary menu-item roles');
        passed.push('Wayland window metadata selects exported menu and renders panel headings');
        await waitFor(() => binding('app.preferences')?.actor.sensitive, 'exported settings action');
        const expectedPreferences = extension.gettext('Preferences…');
        assert(binding('app.preferences').actor.label.text === expectedPreferences,
            'Fallback app action must use the extension translation domain');
        assert(extension._buttons[1].get_first_child().text === 'Arquivo',
            'Application-exported menu title must remain unchanged');
        const language = GLib.get_language_names();
        if (GLib.getenv('LC_ALL') === 'pt_BR.UTF-8')
            assert(expectedPreferences === 'Configurações…', 'Portuguese must be inherited from LC_MESSAGES');
        else if (GLib.getenv('LC_ALL')?.startsWith('en_US'))
            assert(expectedPreferences === 'Preferences…', 'English session must use English fallback');
        GLib.file_set_contents(GLib.build_filenamev([
            GLib.path_get_dirname(GLib.getenv('GNOMENU_REPORT')), 'locale.json']),
        JSON.stringify({languages: language, preferences: expectedPreferences,
            exportedHeading: extension._buttons[1].get_first_child().text}, null, 2));
        passed.push('Session language translates GnoMenu labels while preserving exported application labels');
        const appGroup = extension._source._groups.get('app');
        binding('app.preferences').actor.activate(null);
        await waitFor(() => appGroup.get_action_state('preferences-count')?.unpack() === 1,
            'application preferences action');
        const preferences = await waitFor(() => global.get_window_actors().map(actor => actor.meta_window)
            .find(window => window.title === 'Configurações do GnoMenu Demo'), 'real preferences window');
        // Closing a just-created actor before Shell's asynchronous map animation
        // finishes can exercise a Shell disposal race instead of the menu action.
        await waitFor(() => {
            const actor = preferences.get_compositor_private();
            return actor && actor.mapped && actor.opacity === 255 && actor.scale_y === 1 &&
                !Main.wm._mapping.has(actor);
        }, 'preferences map animation completes');
        preferences.delete(global.get_current_time());
        await select(windows[0]);
        passed.push('App name comes first and its settings command opens the actual application dialog');
        const first = extension._source;
        const firstGroup = first._groups.get('win');
        await waitFor(() => firstGroup.has_action('counter'), 'first counter');
        await waitFor(() => !firstGroup.get_action_state('show-menubar').unpack(),
            'native menubar hides in the captured GTK window');
        passed.push('Imported native menu hides the fixture menubar through its exported window control');
        // Inject input only into this harness's private compositor. Exercise
        // Shell event dispatch rather than emitting actor activation signals.
        const keyboard = global.stage.context.get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const key = symbol => {
            const time = GLib.get_monotonic_time();
            keyboard.notify_keyval(time, symbol, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(time + 1000, symbol, Clutter.KeyState.RELEASED);
        };
        const viewButton = extension._buttons[2];
        viewButton.grab_key_focus();
        key(Clutter.KEY_Down);
        await waitFor(() => viewButton.menu.isOpen, 'Down opens the focused menu');
        await waitFor(() => global.stage.key_focus === binding('win.checked').actor,
            'first menu command receives keyboard focus');
        key(Clutter.KEY_Down);
        await waitFor(() => global.stage.key_focus === binding('win.mode').actor,
            'Down moves to the next command');
        key(Clutter.KEY_Up);
        await waitFor(() => global.stage.key_focus === binding('win.checked').actor,
            'Up returns to the checkbox');
        key(Clutter.KEY_Return);
        await waitFor(() => firstGroup.get_action_state('checked').unpack() && !viewButton.menu.isOpen,
            'Return toggles the application action and closes its popup');
        assert(binding('win.checked').actor.get_accessible().ref_state_set().contains_state(Atk.StateType.CHECKED),
            'Checkbox activation must expose its checked accessibility state');
        viewButton.grab_key_focus();
        key(Clutter.KEY_Down);
        await waitFor(() => viewButton.menu.isOpen, 'keyboard reopens menu');
        key(Clutter.KEY_Escape);
        await waitFor(() => !viewButton.menu.isOpen, 'Escape closes menu');
        assert(extension._source === first, 'Keyboard interaction must retain its target window');
        firstGroup.change_action_state('checked', new GLib.Variant('b', false));
        await waitFor(() => !binding('win.checked').actor._menuLabNode.toggle.checked,
            'restore checkbox after keyboard check');
        assert(!binding('win.checked').actor.get_accessible().ref_state_set().contains_state(Atk.StateType.CHECKED),
            'Checkbox reset must clear its checked accessibility state');
        await select(windows[0]);
        passed.push('Virtual keyboard opens, navigates, activates and dismisses menus in the private compositor');
        const pointer = global.stage.context.get_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const click = async actor => {
            const [x, y] = actor.get_transformed_position();
            const [width, height] = actor.get_transformed_size();
            pointer.notify_absolute_motion(GLib.get_monotonic_time(), x + width / 2, y + height / 2);
            await waitFor(() => actor.hover, 'virtual pointer enters target');
            pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            pointer.notify_button(GLib.get_monotonic_time() + 1000, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        };
        await click(viewButton);
        await waitFor(() => viewButton.menu.isOpen && viewButton.menu.actor.opacity === 255 &&
            viewButton.menu.actor.scale_y === 1 && viewButton.menu.actor.translation_y === 0,
        'pointer opens View menu and its animation finishes');
        await click(binding('win.checked').actor);
        await waitFor(() => firstGroup.get_action_state('checked').unpack() && !viewButton.menu.isOpen,
            'pointer activates the exact application checkbox');
        assert(extension._source === first, 'Pointer interaction must retain its target window');
        firstGroup.change_action_state('checked', new GLib.Variant('b', false));
        await waitFor(() => !binding('win.checked').actor._menuLabNode.toggle.checked,
            'restore checkbox after pointer check');
        passed.push('Virtual pointer opens the panel menu and executes its application command');
        const reportDirectory = GLib.path_get_dirname(GLib.getenv('GNOMENU_REPORT'));
        const capture = async name => {
            const stream = Gio.File.new_for_path(GLib.build_filenamev([reportDirectory, name]))
                .replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            try {
                await new Shell.Screenshot().screenshot(false, stream);
            } finally {
                stream.close(null);
            }
        };
        const geometry = button => {
            const [actorX, buttonY] = button.get_transformed_position();
            const [actorWidth, buttonHeight] = button.get_transformed_size();
            const scale = actorWidth / button.width;
            // BoxPointer uses the themed source content box, excluding its
            // transparent borders/padding rather than the outer actor bounds.
            const theme = button.get_theme_node();
            const content = theme.get_content_box(new Clutter.ActorBox({
                x1: 0, y1: 0, x2: button.width, y2: button.height,
            }));
            const buttonX = actorX + content.x1 * scale;
            const buttonWidth = content.get_width() * scale;
            const [menuX, menuY] = button.menu.actor.get_transformed_position();
            const [menuWidth] = button.menu.actor.get_transformed_size();
            return {actorX, buttonX, buttonY, buttonWidth, buttonHeight, menuX, menuY, menuWidth};
        };
        const alignment = [];
        for (const [index, button] of extension._buttons.entries()) {
            button.menu.open(0);
            await waitFor(() => button.menu.actor.mapped, 'dropdown is mapped');
            await capture(`alignment-${index}.png`);
            const measured = geometry(button);
            GLib.file_set_contents(GLib.build_filenamev([reportDirectory, 'alignment.json']),
                JSON.stringify([...alignment, {title: button.get_first_child().text, ...measured}], null, 2));
            assert(Math.abs(measured.menuX - measured.buttonX) <= 2,
                `Dropdown must align with title: ${JSON.stringify(measured)}`);
            assert(measured.menuY >= measured.buttonY + measured.buttonHeight,
                'Dropdown must appear below the panel');
            alignment.push({title: button.get_first_child().text, ...measured});
            button.menu.close(0);
        }
        passed.push('All dropdowns align their left edge with the corresponding title');
        const rtlButton = extension._buttons[2];
        rtlButton.text_direction = Clutter.TextDirection.RTL;
        rtlButton.menu.open(0);
        await waitFor(() => {
            const g = geometry(rtlButton);
            return rtlButton.menu.actor.mapped &&
                Math.abs(g.menuX + g.menuWidth - g.buttonX - g.buttonWidth) <= 2;
        }, 'RTL dropdown aligns right edges');
        alignment.push({direction: 'rtl', ...geometry(rtlButton)});
        rtlButton.menu.close(0);
        rtlButton.text_direction = Clutter.TextDirection.LTR;
        passed.push('RTL dropdowns align their right edge with the title');
        const parent = rtlButton.container.get_parent();
        const position = parent.get_children().indexOf(rtlButton.container);
        parent.remove_child(rtlButton.container);
        Main.panel._rightBox.add_child(rtlButton.container);
        rtlButton.menu.open(0);
        await waitFor(() => {
            const g = geometry(rtlButton);
            const workarea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
            return g.buttonX > workarea.x + workarea.width / 2 &&
                g.menuX >= workarea.x - 2 && g.menuX + g.menuWidth <= workarea.x + workarea.width + 2;
        }, 'dropdown stays on-screen near monitor edge');
        alignment.push({clamped: true, ...geometry(rtlButton)});
        rtlButton.menu.close(0);
        Main.panel._rightBox.remove_child(rtlButton.container);
        parent.insert_child_at_index(rtlButton.container, position);
        GLib.file_set_contents(GLib.build_filenamev([reportDirectory, 'alignment.json']),
            JSON.stringify(alignment, null, 2));
        passed.push('Dropdowns remain within the monitor work area near its edge');
        extension._buttons[0].menu.open();
        await waitFor(() => extension._buttons[0].menu.isOpen, 'panel popup opens');
        assert(extension._source === first, 'Popup must retain its target source');
        // Screenshot only the private virtual monitor, never the user's desktop.
        await capture('panel-preview.png');
        binding('win.increment').actor.activate(null);
        await waitFor(() => firstGroup.get_action_state('counter').unpack() === 1,
            'panel click executes first-window command');
        passed.push('Panel popup activation reaches the first GTK window');
        await select(windows[1]);
        const second = extension._source;
        assert(first.closed, 'Switching focus must dispose the old source');
        await waitFor(() => firstGroup.get_action_state('show-menubar').unpack(),
            'previous window restores its local menubar');
        const secondGroup = second._groups.get('win');
        await waitFor(() => secondGroup.has_action('counter'), 'second counter');
        assert(secondGroup.get_action_state('counter').unpack() === 0, 'Second window starts untouched');
        binding('win.increment').actor.activate(null);
        await waitFor(() => secondGroup.get_action_state('counter').unpack() === 1, 'second panel command');
        assert(firstGroup.get_action_state('counter').unpack() === 1, 'First window must remain unchanged');
        passed.push('Focus switches source and commands stay isolated between GTK windows');
        binding('win.checked').actor.activate(null);
        await waitFor(() => binding('win.checked').actor._menuLabNode.toggle.checked, 'live checkbox');
        binding('win.enable').actor.activate(null);
        await waitFor(() => binding('win.blocked').actor.sensitive, 'live sensitivity');
        binding('app.dynamic').actor.activate(null);
        await waitFor(() => extension._bindings.some(candidate =>
            candidate.actor.label?.text === 'Incrementar (dinâmico)'), 'dynamic panel menu rebuild');
        passed.push('Checkbox, sensitivity and dynamic structure update in Shell actors');
        windows[1].delete(global.get_current_time());
        await waitFor(() => second.closed, 'closed window invalidates source');
        await select(windows[0]);
        passed.push('Closing the active window discards its menu and the remaining window works');
        const unsupported = await waitFor(() => global.get_window_actors()
            .map(actor => actor.meta_window).find(window =>
                window.get_gtk_application_id() === 'org.example.GnoMenuNoMenu'),
        'application without an exported menu');
        Main.activateWindow(unsupported, global.get_current_time());
        await waitFor(() => global.display.focus_window === unsupported &&
            !extension._desktopMode && extension._window === unsupported &&
            !extension._source && extension._bindings.length === 0 &&
            extension._buttons[0]?.get_first_child().text === 'GnoMenu sem menu',
        'unsupported app retains its own title');
        assert(extension._buttons.length === 1 &&
            extension._buttons[0].menu._getMenuItems()[0].label.text === extension.gettext('No menu available'),
        'Unsupported app must show its own unavailable status without Files launchers');
        passed.push('Application without captured commands retains its title and localized unavailable status');
        await select(windows[0]);
        const current = extension._source;
        await Main.extensionManager.disableExtension(UUID);
        await waitFor(() => current.closed && extension._buttons.length === 0,
            'extension disable cleanup');
        assert(!Object.keys(Main.panel.statusArea).some(key => key.startsWith(`${UUID}-`)),
            'Panel registration must be cleaned');
        passed.push('Disabling extension removes panel actors, sources and registrations');
        await Main.extensionManager.enableExtension(UUID);
        await waitFor(() => Main.extensionManager.lookup(UUID)?.stateObj?._bindings.length > 0,
            'extension re-enable');
        passed.push('Extension can be enabled again without restarting Shell');
        for (let cycle = 0; cycle < 3; cycle++) {
            const active = Main.extensionManager.lookup(UUID).stateObj;
            const source = active._source;
            await Main.extensionManager.disableExtension(UUID);
            await waitFor(() => source.closed && active._buttons.length === 0 &&
                !Object.keys(Main.panel.statusArea).some(name => name.startsWith(`${UUID}-`)),
            'repeated disable cleans up its source and panel registrations');
            await Main.extensionManager.enableExtension(UUID);
            await waitFor(() => active._bindings.length > 0, 'repeated enable restores the source');
            assert(Object.keys(Main.panel.statusArea).filter(name => name.startsWith(`${UUID}-`)).length ===
                active._buttons.length, 'Repeated enable must not duplicate panel registrations');
        }
        passed.push('Three additional disable/enable cycles restore menus without duplicate panel registrations');
    }

    disable() {
    }
}
