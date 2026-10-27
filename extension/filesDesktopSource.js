// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {actionMenus} from './actionMenus.js';
import {GMenuSource} from './gmenuSource.js';

// The same explicit Files adapter, without pretending a window exists. Only
// application actions and the two desktop launchers can run in this source.
export class FilesDesktopSource {
    constructor(connection, launchers, changed, translate = text => text, busName = 'org.gnome.Nautilus') {
        this.descriptor = {applicationId: 'org.gnome.Nautilus', busName: null,
            appPath: '/org/gnome/Nautilus', windowPath: null, menuPath: null};
        this.partial = true;
        this.truncated = false;
        this.closed = false;
        this.snapshot = [];
        this.applicationMenu = [];
        this._inner = null;
        this._launchers = launchers;
        this._changed = changed;
        this._gettext = translate;
        this._items = new Map();
        this._dispatch = new Map();
        this._issued = new WeakMap();
        this._epoch = 0;
        this._idle = 0;
        this._watch = Gio.bus_watch_name_on_connection(connection, busName,
            Gio.BusNameWatcherFlags.NONE, (_bus, _name, owner) => {
                ++this._epoch;
                this._inner?.destroy();
                this.descriptor.busName = owner;
                const inner = new GMenuSource(connection, {...this.descriptor}, () => {
                    if (!this.closed && this._inner === inner)
                        this._queue();
                }, translate);
                this._inner = inner;
                this._queue();
            }, () => {
                ++this._epoch;
                this._inner?.destroy();
                this._inner = null;
                this.descriptor.busName = null;
                this._queue();
            });
        this._queue();
    }

    _queue() {
        if (this.closed || this._idle)
            return;
        this._idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idle = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh() {
        const _ = this._gettext;
        const origins = new Map();
        const collect = nodes => {
            for (const node of nodes) {
                if (node.action)
                    origins.set(node.action, node);
                collect(node.children);
            }
        };
        if (this._inner && !this._inner.closed) {
            collect(this._inner.applicationMenu);
            collect(this._inner.snapshot);
        }
        const launcher = action => action === 'app.new-window' ? this._launchers.openWindow :
            action === 'win.go-home' ? this._launchers.openHome : null;
        const resolve = ({action}) => ({exists: true, acceptsTarget: true,
            enabled: Boolean(launcher(action) ||
                (!action.startsWith('win.') && action !== 'app.clone-window' && origins.get(action)?.enabled)),
            toggle: origins.get(action)?.toggle ?? null});
        this.snapshot = actionMenus('org.gnome.Nautilus', resolve, _);
        this.applicationMenu = [
            ['app.preferences', _('Preferences…')], ['app.about', _('About…')], ['app.quit', _('Quit')],
        ].map(([action, label]) => ({id: `desktop/${action}`, kind: 'item', label, action,
            target: null, children: [], enabled: resolve({action}).enabled, toggle: null}));
        this._items.clear();
        this._dispatch.clear();
        const index = nodes => {
            for (const node of nodes) {
                this._items.set(node.id, node);
                this._issued.set(node, this._epoch);
                if (node.action) {
                    const callback = launcher(node.action);
                    this._dispatch.set(node.id, callback ? {callback} :
                        {source: this._inner, node: origins.get(node.action)});
                }
                index(node.children);
            }
        };
        index(this.snapshot);
        index(this.applicationMenu);
        this._changed();
    }

    activate(node) {
        if (this.closed || !node || this._issued.get(node) !== this._epoch)
            return false;
        const current = this._items.get(node.id);
        if (!current?.enabled || current.action !== node.action)
            return false;
        const dispatch = this._dispatch.get(node.id);
        if (dispatch?.callback) {
            dispatch.callback();
            return true;
        }
        return Boolean(dispatch?.source?.activate(dispatch.node));
    }

    setCaptured() {
        // No client window is owned or hidden by the desktop source.
    }

    destroy() {
        if (this.closed)
            return;
        this.closed = true;
        ++this._epoch;
        Gio.bus_unwatch_name(this._watch);
        if (this._idle)
            GLib.source_remove(this._idle);
        this._watch = this._idle = 0;
        this._inner?.destroy();
        this._inner = null;
        this.snapshot = [];
        this.applicationMenu = [];
        this._items.clear();
        this._dispatch.clear();
        this._issued = null;
        this._changed = this._gettext = this._launchers = null;
    }
}
