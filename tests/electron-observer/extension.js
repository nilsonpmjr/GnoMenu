// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class ElectronObserver extends Extension {
    enable() {
        const file = GLib.getenv('GNOMENU_ELECTRON_OBSERVATION');
        if (!file)
            return;
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const windows = global.get_window_actors().map(actor => actor.meta_window).map(window => ({
                title: window.title, pid: window.get_pid(), clientType: window.get_client_type(),
                id: window.get_id(), description: window.get_description(),
                hasGetXwindow: typeof window.get_xwindow === 'function',
                xid: typeof window.get_xwindow === 'function' ? window.get_xwindow() : null,
            }));
            GLib.file_set_contents(file, JSON.stringify({display: GLib.getenv('DISPLAY'),
                xauthority: GLib.getenv('XAUTHORITY'), windows}));
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
    }
}
