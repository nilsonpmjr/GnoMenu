// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import GLib from 'gi://GLib';
// Explicit adapters for actions observed in Nautilus 50 and Ptyxis 50. Only
// actions actually exported with a matching parameter type become menu items.
// These are partial menus assembled by GnoMenu, not imported native layouts.
export function actionMenus(applicationId, resolve, translate, groups = new Map(), represented = new Set()) {
    const _ = translate;
    let sections;
    switch (applicationId) {
    case 'org.gnome.Nautilus':
        sections = [
            ['file', _('File'), [
                ['app.new-window', _('New Window')], ['win.new-tab', _('New Tab')],
                ['app.clone-window', _('Duplicate Window')],
                ['win.restore-tab', _('Reopen Closed Tab')],
                ['win.close-current-view', _('Close Tab')],
                ['win.close-other-tabs', _('Close Other Tabs')],
            ]],
            ['edit', _('Edit'), [['win.undo', _('Undo')], ['win.redo', _('Redo')]]],
            ['view', _('View'), [
                ['win.toggle-sidebar', _('Show Sidebar')],
                ['app.show-file-transfers', _('File Transfers')],
            ]],
            ['go', _('Go'), [['win.go-home', _('Home')],
                ['win.tab-move-left', _('Move Tab Left')], ['win.tab-move-right', _('Move Tab Right')],
                ['win.tab-move-new-window', _('Move Tab to New Window')]]],
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
        sections = [];
    }
    const result = sections.flatMap(([id, title, entries]) => {
        const children = entries.flatMap(([action, caption]) => {
            const resolved = resolve({action, target: null});
            if (!resolved.exists || !resolved.acceptsTarget)
                return [];
            represented.add(action);
            return [{id: `actions/${action}`, kind: 'item', label: caption, action,
                target: null, enabled: resolved.enabled, toggle: resolved.toggle, children: []}];
        });
        return children.length ? [{id: `actions/menu/${id}`, kind: 'submenu',
            label: title, enabled: true, action: '', target: null, toggle: null, children}] : [];
    });
    const extra = [];
    for (const [prefix, group] of groups) {
        for (const name of group.list_actions().sort()) {
            const action = `${prefix}.${name}`;
            if (represented.has(action) || ['show-menubar', 'show-menu-bar', 'menubar-visible'].includes(name))
                continue;
            if ((action === 'app.settings' && represented.has('app.preferences')) ||
                (action === 'app.preferences' && represented.has('app.settings')))
                continue;
            const type = group.get_action_parameter_type(name);
            const state = group.get_action_state(name);
            // Non-boolean state-only exports can be counters or status values.
            if (!type && state && state.get_type_string() !== 'b')
                continue;
            const targets = [];
            if (!type) {
                targets.push(null);
            } else if (type.dup_string() === 'b') {
                // Boolean parameters have exactly two values by their type.
                targets.push(new GLib.Variant('b', false), new GLib.Variant('b', true));
            } else {
                const hint = group.get_action_state_hint(name);
                // Only use an explicit finite list of accepted values. A numeric
                // range or the current value alone does not describe the choices.
                if (hint?.get_type_string() !== `a${type.dup_string()}` || hint.n_children() > 32)
                    continue;
                for (let index = 0; index < hint.n_children(); index++)
                    targets.push(hint.get_child_value(index));
            }
            const title = name.replace(/[._-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
            for (const target of targets) {
                const resolved = resolve({action, target});
                if (!resolved.acceptsTarget)
                    continue;
                const suffix = target?.get_type_string() === 'b' ? (target.unpack() ? _('On') : _('Off')) :
                    target ? target.print(false) : '';
                const caption = action === 'app.kill' ? _('Force Quit') :
                    action === 'app.search-settings' ? _('Search Settings…') :
                        action === 'app.make-default' ? _('Set as Default Terminal') : title;
                extra.push({id: `actions/extra/${action}/${suffix}`, kind: 'item',
                    label: suffix ? `${caption}: ${suffix}` : caption, action, target,
                    enabled: resolved.enabled, toggle: resolved.toggle, children: []});
                if (extra.length >= 256)
                    break;
            }
            if (extra.length >= 256)
                break;
        }
        if (extra.length >= 256)
            break;
    }
    if (extra.length)
        result.push({id: 'actions/menu/additional', kind: 'submenu', label: _('Additional Commands'),
            enabled: true, action: '', target: null, toggle: null, children: extra});
    return result;
}
