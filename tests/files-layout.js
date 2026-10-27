// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import {organizeFilesMenus} from '../extension/actionMenus.js';

function assert(value, message) {
    if (!value)
        throw new Error(message);
}

const item = (id, action, label = id, target = null) => ({
    id, action, label, target, kind: 'item', enabled: true, toggle: null, children: [],
});
const menu = (id, children) => ({id, kind: 'submenu', label: id, action: '', target: null, children});
const lookup = () => ({exists: false, acceptsTarget: false});
const all = nodes => nodes.flatMap(node => [node, ...all(node.children)]);
const target = text => ({print: () => text});
const tree = [menu('Current Folder Menu', [
    item('paste', 'win.gnomenu.view.paste', 'Paste'),
    item('reload', 'win.gnomenu.slot.reload', 'Reload'),
    item('back', 'win.gnomenu.slot.back', 'Native Back'),
    item('forward', 'win.gnomenu.slot.forward', 'Native Forward'),
    item('unknown', 'win.gnomenu.view.extension-custom', 'Original Extension Entry'),
]), menu('Main Menu', [
    item('prefs', 'app.preferences', 'Native Preferences'), item('help', 'app.help', 'Native Help'),
    item('undo', 'win.undo', 'Undo operation'), item('new', 'app.clone-window', 'New Window'),
]), menu('View Options', [menu('Sort', [
    item('sort-a', 'win.gnomenu.view.sort', 'A–Z', target("('name', false)")),
    item('sort-z', 'win.gnomenu.view.sort', 'Z–A', target("('name', true)")),
]), item('zoom', 'win.gnomenu.view.zoom-in', 'Zoom In')]), menu('selected_file', [
    item('context-paste', 'win.gnomenu.files.7.view.paste', 'Native Paste'),
    item('context-copy', 'win.gnomenu.files.7.view.copy', 'Native Copy'),
]), menu('ancestor_folder', [item('ancestor', 'win.gnomenu.pathbar.4.properties', 'Properties')])];
for (const node of tree)
    node.layout = 'files';
const organized = organizeFilesMenus(tree, [], lookup, text => text);
assert(organized.tree.map(node => node.label).join('|') === 'File|Edit|View|Go|Help', 'Stable headings');
assert(organized.applicationMenu.some(node => node.action === 'app.preferences'), 'Settings belong to the app heading');
assert(all(organized.tree[4].children).some(node => node.action === 'app.help'), 'Help placement');
assert(all(organized.tree[0].children).find(node => node.id === 'unknown')?.label === 'Original Extension Entry',
    'Unknown imported entries must keep their native captions under File');
assert(all(organized.tree[1].children)[0].action === 'win.undo', 'Established Edit actions precede new entries');
assert(all(organized.tree[0].children).find(node => node.action === 'app.clone-window').label === 'Duplicate Window',
    'Cloning the current directory retains its established distinct caption');
print('PASS: Fixed Files categories place native settings, editing, navigation and help commands without a catch-all');
const edit = all(organized.tree[1].children);
assert(!edit.some(node => node.id === 'paste') && edit.some(node => node.id === 'context-paste'),
    'Context-scoped action must replace the duplicate general action');
assert(edit.find(node => node.id === 'context-copy').contextLabel === 'selected_file', 'Target identity survives placement');
assert(!tree[3].children[0].contextLabel && tree[0].children.length === 5, 'Input model must remain unchanged');
print('PASS: Deduplication retains captured context actions and leaves original native models unchanged');
const view = all(organized.tree[2].children);
const sort = view.find(node => node.label === 'Sort');
assert(sort.children.length === 2 && sort.children[0].target === tree[2].children[0].children[0].target,
    'Nested sorting and typed target objects must be preserved');
assert(all(organized.tree[3].children).some(node => node.label === 'ancestor_folder'),
    'Clicked ancestor remains identifiable inside Go');
assert(all(organized.tree[3].children).slice(0, 2).map(node => node.label).join('|') === 'Native Back|Native Forward',
    'Navigation controls retain native captions and precede contextual navigation entries in Go');
print('PASS: Original nested menus, ancestor identity and distinct typed targets survive regrouping');
const translated = organizeFilesMenus([], [], lookup, text => `translated:${text}`);
assert(translated.tree.map(node => node.label).join('|') ===
    'translated:File|translated:Edit|translated:View|translated:Go|translated:Help', 'Use the session translator');
const scoped = organizeFilesMenus([{...menu('tab', [item('scoped-close', 'win.gnomenu.tab.3.close-current-view')]), layout: 'files'}], [],
    node => ({exists: node.action === 'win.close-current-view', acceptsTarget: true}), text => text);
assert(all(scoped.tree).filter(node => node.action?.endsWith('close-current-view')).length === 1 &&
    all(scoped.tree).some(node => node.id === 'scoped-close'), 'Native tab context wins over fallback');
print('PASS: Localized headings stay stable and contextual tab actions take priority over window fallbacks');

const tools = menu('_Tools', [menu('Native submenu', [item('tool', 'win.plugin-tool', 'Native Tool', target("'native'"))])]);
const dynamicTree = [...tree, tools, menu('Empty context', [])];
const expanded = organizeFilesMenus(dynamicTree, [], lookup, text => text);
assert(expanded.tree.map(node => node.label).join('|') === 'File|Edit|View|Go|_Tools|Help',
    'Additional native menus appear before Help without displacing the established categories');
const imported = expanded.tree.find(node => node.label === '_Tools');
assert(imported.children[0].label === 'Native submenu' && imported.children[0].children[0].target === tools.children[0].children[0].target,
    'Additional menus retain native hierarchy and typed targets');
assert(!expanded.tree.some(node => node.label === 'Empty context'), 'Do not add an empty context menu');
assert(!organizeFilesMenus(tree, [], lookup, text => text).tree.some(node => node.label === '_Tools'),
    'Removing native context removes its heading');
assert(!tools.children[0].children[0].contextLabel, 'Additional native model remains unchanged');
print('PASS: Additional native context menus appear and disappear with their original hierarchy and typed targets');

const nativeEdit = menu('_Edit', [item('custom-edit', 'win.custom-edit', 'Native Edit Operation')]);
const extended = organizeFilesMenus([...tree, nativeEdit], [], lookup, text => text);
assert(extended.tree.length === 5 && all(extended.tree[1].children).some(node => node.id === 'custom-edit'),
    'A native standard category merges into that category even for unknown actions');
const duplicates = menu('Tools', [item('duplicate-copy', 'win.gnomenu.view.copy', 'Copy'),
    item('distinct-tool', 'win.plugin-tool', 'Native Tool')]);
const deduplicated = organizeFilesMenus([...tree, duplicates], [], lookup, text => text);
assert(all(deduplicated.tree.find(node => node.label === 'Tools').children).length === 1,
    'Captured contextual action still wins over an additional menu duplicate');
const localizedExtra = organizeFilesMenus([...tree, menu('Ferramentas', [item('local', 'win.local')])], [], lookup,
    text => `translated:${text}`);
assert(localizedExtra.tree.at(-2).label === 'Ferramentas', 'Native extra heading is not retranslated');
const appNested = organizeFilesMenus(tree, [menu('Application settings', [item('app-setting', 'app.settings')])],
    lookup, text => text);
assert(appNested.tree.length === 5 && all(appNested.applicationMenu).some(node => node.action === 'app.settings'),
    'Application-menu nesting remains under the app name rather than adding a menubar heading');
print('PASS: Native standard headings merge, contextual deduplication holds and additional captions stay in their source language');
