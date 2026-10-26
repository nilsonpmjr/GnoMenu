// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
// Explicit adapters for actions observed in Nautilus 50 and Ptyxis 50. Only
// actions actually exported with a matching parameter type become menu items.
// These are partial menus assembled by GnoMenu, not imported native layouts.
export function actionMenus(applicationId, resolve, translate) {
    const _ = translate;
    let sections;
    switch (applicationId) {
    case 'org.gnome.Nautilus':
        sections = [
            ['file', _('File'), [
                ['app.new-window', _('New Window')], ['win.new-tab', _('New Tab')],
                ['win.restore-tab', _('Reopen Closed Tab')],
                ['win.close-current-view', _('Close Tab')],
            ]],
            ['edit', _('Edit'), [['win.undo', _('Undo')], ['win.redo', _('Redo')]]],
            ['view', _('View'), [
                ['win.toggle-sidebar', _('Show Sidebar')],
                ['app.show-file-transfers', _('File Transfers')],
            ]],
            ['go', _('Go'), [['win.go-home', _('Home')]]],
            ['help', _('Help'), [
                ['app.help', _('Help')], ['app.shortcuts', _('Keyboard Shortcuts')],
            ]],
        ];
        break;
    case 'org.gnome.Ptyxis':
        sections = [
            ['file', _('File'), [
                ['app.new-window', _('New Window')], ['app.new-tab', _('New Tab')],
            ]],
            ['view', _('View'), [['win.tab.read-only', _('Read-Only Terminal')]]],
        ];
        break;
    default:
        return [];
    }
    return sections.flatMap(([id, title, entries]) => {
        const children = entries.flatMap(([action, caption]) => {
            const resolved = resolve({action, target: null});
            if (!resolved.exists || !resolved.acceptsTarget)
                return [];
            return [{id: `actions/${action}`, kind: 'item', label: caption, action,
                target: null, enabled: resolved.enabled, toggle: resolved.toggle, children: []}];
        });
        return children.length ? [{id: `actions/menu/${id}`, kind: 'submenu',
            label: title, enabled: true, action: '', target: null, toggle: null, children}] : [];
    });
}
