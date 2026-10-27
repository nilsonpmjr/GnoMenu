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

// Presentation policy for our Nautilus exporter. Keep its captured action
// objects and typed targets; only place them in the established Files headings.
export function organizeFilesMenus(tree, applicationMenu, resolve, translate) {
    const _ = translate;
    const labels = {file: _('File'), edit: _('Edit'), view: _('View'), go: _('Go'), help: _('Help')};
    const groups = Object.fromEntries(Object.keys(labels).map(key => [key, []]));
    const app = [];
    const canonical = action => action
        .replace(/^win\.gnomenu\.files\.\d+\./, '')
        .replace(/^win\.gnomenu\.tab\.\d+\./, 'win.')
        .replace(/^win\.gnomenu\.pathbar\.\d+\./, 'pathbar.')
        .replace(/^win\.gnomenu\./, '');
    const categories = new Map([
        ...['app.preferences', 'app.settings', 'app.about', 'app.quit'].map(action => [action, 'app']),
        ...['win.undo', 'win.redo', 'view.cut', 'view.copy', 'view.paste', 'view.paste-into',
            'view.create-link', 'view.select-all', 'view.invert-selection', 'view.select-pattern',
            'view.copy-current-location'].map(action => [action, 'edit']),
        ...['view.sort', 'view.zoom-in', 'view.zoom-out', 'view.show-hidden-files', 'view.visible-columns',
            'view.visible-captions', 'win.toggle-sidebar', 'app.show-file-transfers'].map(action => [action, 'view']),
        ...['win.go-home', 'win.tab-move-left', 'win.tab-move-right', 'win.tab-move-new-window',
            'slot.reload', 'slot.stop', 'slot.bookmark-current-directory', 'slot.unbookmark-current-directory',
            'slot.star-current-directory', 'slot.unstar-current-directory', 'view.current-directory-console']
            .map(action => [action, 'go']),
        ...['app.help', 'app.shortcuts'].map(action => [action, 'help']),
    ]);
    const bucket = node => {
        const action = canonical(node.action);
        return action.startsWith('pathbar.') ? 'go' : categories.get(action) ?? 'file';
    };
    const key = node => `${canonical(node.action)}:${node.target?.print(true) ?? ''}`;
    const priority = node => {
        if (node.id.startsWith('actions/'))
            return 0;
        if (node.action.startsWith('win.gnomenu.files.'))
            return bucket(node) === 'app' ? 20 : 100;
        if (node.action.startsWith('win.gnomenu.tab.'))
            return 90;
        return 50;
    };
    const fallback = actionMenus('org.gnome.Nautilus', resolve, translate);
    const winners = new Map();
    const choose = nodes => {
        for (const node of nodes) {
            if (node.kind === 'item' && node.action) {
                const previous = winners.get(key(node));
                if (!previous || priority(node) > priority(previous))
                    winners.set(key(node), node);
            }
            choose(node.children);
        }
    };
    choose([...tree, ...applicationMenu, ...fallback]);
    const emitted = new Set();
    const contextual = node => /^win\.gnomenu\.(files|tab|pathbar)\./.test(node.action) || node.children.some(contextual);
    const split = (nodes, top = false, contextLabel = '') => {
        const result = Object.fromEntries([...Object.keys(labels), 'app'].map(name => [name, []]));
        for (const node of nodes) {
            if (node.kind === 'section' || node.kind === 'submenu') {
                const children = split(node.children, false, top && contextual(node) ? node.label : contextLabel);
                for (const [name, entries] of Object.entries(children)) {
                    if (!entries.length)
                        continue;
                    // Keep the clicked ancestor's real name within Go; other
                    // source headings are replaced by File/Edit/View/Go/Help.
                    const ancestor = top && node.children.some(child =>
                        child.action && canonical(child.action).startsWith('pathbar.'));
                    if (top && !ancestor)
                        result[name].push(...entries);
                    else
                        result[name].push({...node, id: `files/${name}/${node.id}`, children: entries});
                }
            } else if (!node.action || (winners.get(key(node)) === node && !emitted.has(key(node)))) {
                const entry = {...node};
                // Nautilus calls both opening Home and cloning the current
                // folder "New Window". Keep the established distinction.
                if (canonical(node.action) === 'app.clone-window')
                    entry.label = _('Duplicate Window');
                if (contextLabel)
                    entry.contextLabel = contextLabel;
                result[bucket(node)].push(entry);
                if (node.action)
                    emitted.add(key(node));
            }
        }
        return result;
    };
    for (const nodes of [tree, applicationMenu, fallback]) {
        const fragments = split(nodes, true);
        for (const name of Object.keys(labels))
            groups[name].push(...fragments[name]);
        app.push(...fragments.app);
    }
    const anchors = {
        file: ['app.new-window', 'app.clone-window', 'win.new-tab', 'win.restore-tab',
            'win.close-current-view', 'win.close-other-tabs'],
        edit: ['win.undo', 'win.redo'],
        view: ['win.toggle-sidebar', 'app.show-file-transfers'],
        go: ['win.go-home', 'win.tab-move-left', 'win.tab-move-right', 'win.tab-move-new-window'],
        help: ['app.help', 'app.shortcuts'],
    };
    for (const [name, entries] of Object.entries(groups)) {
        const rank = node => {
            const position = anchors[name].indexOf(canonical(node.action));
            return Math.min(position < 0 ? 100 : position, ...node.children.map(rank));
        };
        entries.sort((a, b) => rank(a) - rank(b));
    }
    return {
        tree: Object.entries(labels).map(([name, label]) => ({
            id: `files/menu/${name}`, kind: 'submenu', label, children: groups[name],
            action: '', target: null, enabled: true, toggle: null,
        })),
        applicationMenu: app,
    };
}
