// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sourceForWindow} from './windowSource.js';

export default class ElectronObserver extends Extension {
    enable() {
        const file = GLib.getenv('GNOMENU_ELECTRON_OBSERVATION');
        if (!file)
            return;
        this._reply = null;
        this._sequence = null;
        this._stashed = null;
        this._overviewDismissed = false;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const extension = Main.extensionManager.lookup(GLib.getenv('GNOMENU_UUID'))?.stateObj;
            if (!Main.layoutManager._startingUp && !this._overviewDismissed) {
                Main.overview.hide();
                this._overviewDismissed = true;
            }
            const command = GLib.getenv('GNOMENU_ELECTRON_COMMAND');
            if (command && GLib.file_test(command, GLib.FileTest.EXISTS)) {
                const [, bytes] = GLib.file_get_contents(command);
                const request = JSON.parse(imports.byteArray.toString(bytes));
                if (request.operation === 'stop-observer') {
                    this._timer = 0;
                    GLib.file_set_contents(file, JSON.stringify({reply: {id: request.id, success: true}}));
                    return GLib.SOURCE_REMOVE;
                }
                if (request.id !== this._sequence) {
                    this._sequence = request.id;
                    this._runCommand(extension, request).then(result => {
                        this._reply = {id: request.id, success: true, result};
                    }).catch(error => {
                        this._reply = {id: request.id, success: false, error: error.message};
                    });
                }
            }
            const windows = global.get_window_actors().map(actor => actor.meta_window).map(window => ({
                title: window.title, pid: window.get_pid(), clientType: window.get_client_type(),
                id: window.get_id(), description: window.get_description(),
                hasGetXwindow: typeof window.get_xwindow === 'function',
                xid: typeof window.get_xwindow === 'function' ? window.get_xwindow() : null,
                menuSource: sourceForWindow(window),
            }));
            GLib.file_set_contents(file, JSON.stringify({display: GLib.getenv('DISPLAY'),
                xauthority: GLib.getenv('XAUTHORITY'), windows, reply: this._reply,
                panel: {windowPath: extension?._source?.descriptor?.windowPath,
                    buttons: extension?._buttons?.map(button => ({label: button.get_first_child()?.text, open: button.menu.isOpen})),
                    menus: extension?._menus?.map(entry => ({label: entry.node?.label, open: entry.menu.isOpen,
                        prepared: entry.prepared, enabled: entry.node?.enabled, submenuAction: entry.node?.submenuAction})),
                    items: extension?._bindings?.map(entry => ({label: entry.actor._menuLabNode?.label,
                        enabled: entry.actor.sensitive, toggle: entry.actor._menuLabNode?.toggle}))}}));
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _runCommand(extension, request) {
        if (!extension?._buttons)
            throw new Error('Private panel extension is not ready');
        const entry = () => extension._bindings.find(binding => binding.actor._menuLabNode?.label === request.label);
        switch (request.operation) {
        case 'focus': {
            const windows = global.get_window_actors().map(actor => actor.meta_window).filter(window =>
                window.get_gtk_window_object_path() === request.windowPath);
            if (windows.length !== 1)
                throw new Error('Expected one owned window with this exact GTK path');
            Main.activateWindow(windows[0], global.get_current_time());
            return true;
        }
        case 'open':
        case 'close': {
            const menu = extension._menus.find(candidate => candidate.node?.label === request.label)?.menu;
            if (!menu)
                throw new Error('Requested native menu is absent');
            if (request.operation === 'open')
                menu.open();
            else
                menu.close();
            return true;
        }
        case 'open-close': {
            const child = extension._menus.find(candidate => candidate.node?.label === request.label)?.menu;
            const parent = extension._menus.find(candidate => candidate.node?.label === request.parent)?.menu;
            if (!child || !parent)
                throw new Error('Expected an actual parent and child menu');
            child.open();
            parent.close();
            return true;
        }
        case 'activate': {
            const binding = entry();
            if (!binding?.actor.sensitive || !binding.actor.visible)
                throw new Error('Requested panel command is not available');
            binding.actor.activate(null);
            return true;
        }
        case 'stash':
            if (!entry())
                throw new Error('No panel command to retain');
            this._stashed = {source: extension._source, node: entry().actor._menuLabNode};
            return true;
        case 'activate-stale':
            return this._stashed?.source.activate(this._stashed.node) ?? false;
        case 'capture': {
            const path = GLib.build_filenamev([GLib.getenv('GNOMENU_ELECTRON_REPORT_DIR'), 'electron-panel.png']);
            const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            try {
                await new Shell.Screenshot().screenshot(false, stream);
            } finally {
                stream.close(null);
            }
            return true;
        }
        default:
            throw new Error('Unknown private panel command');
        }
    }

    disable() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
        this._stashed = null;
    }
}
