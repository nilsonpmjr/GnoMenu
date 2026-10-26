// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
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
        const passed = [];
        const run = GLib.getenv('GNOMENU_REAL_APPS') === '1' ? this._runRealApps(passed) : this._run(passed);
        run.then(() => {
            GLib.file_set_contents(reportPath, JSON.stringify({success: true, passed}, null, 2));
        }).catch(error => {
            console.error(error);
            GLib.file_set_contents(reportPath,
                JSON.stringify({success: false, passed, error: `${error.message}\n${error.stack}`}, null, 2));
        });
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
        assert(extension._source.partial && !extension._source.descriptor.menuPath,
            'Real Nautilus must be discovered through its exported actions');
        assert(binding('app.preferences')?.actor.sensitive, 'Nautilus preferences must be exposed');
        const tracker = Shell.WindowTracker.get_default();
        assert(extension._buttons[0].get_first_child().text === tracker.get_window_app(nautilus[0]).get_name(),
            'Real app identity must be shown before its menus');
        assert(extension._buttons[1].get_first_child().text === extension.gettext('File'),
            'Partial menu headings must follow the session language');
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
            extension._source?.partial && extension._bindings.length === 0,
        'unsupported app clears the previous menu');
        assert(extension._buttons.length === 1 &&
            extension._buttons[0].get_first_child().text === 'GnoMenu sem menu',
        'Unsupported application must show honest status, not old menu headings');
        const status = extension._buttons[0].menu._getMenuItems()[0];
        assert(status.label.text === extension.gettext('No menu available'),
            'Unavailable status must use the session language');
        passed.push('Application without a menu clears the old source and displays unavailable status');
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
    }

    disable() {
    }
}
