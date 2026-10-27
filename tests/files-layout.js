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
assert(!tree[3].children[0].contextLabel && tree[0].children.length === 3, 'Input model must remain unchanged');
print('PASS: Deduplication retains captured context actions and leaves original native models unchanged');
const view = all(organized.tree[2].children);
const sort = view.find(node => node.label === 'Sort');
assert(sort.children.length === 2 && sort.children[0].target === tree[2].children[0].children[0].target,
    'Nested sorting and typed target objects must be preserved');
assert(all(organized.tree[3].children).some(node => node.label === 'ancestor_folder'),
    'Clicked ancestor remains identifiable inside Go');
print('PASS: Original nested menus, ancestor identity and distinct typed targets survive regrouping');
const translated = organizeFilesMenus([], [], lookup, text => `translated:${text}`);
assert(translated.tree.map(node => node.label).join('|') ===
    'translated:File|translated:Edit|translated:View|translated:Go|translated:Help', 'Use the session translator');
const scoped = organizeFilesMenus([menu('tab', [item('scoped-close', 'win.gnomenu.tab.3.close-current-view')])], [],
    node => ({exists: node.action === 'win.close-current-view', acceptsTarget: true}), text => text);
assert(all(scoped.tree).filter(node => node.action?.endsWith('close-current-view')).length === 1 &&
    all(scoped.tree).some(node => node.id === 'scoped-close'), 'Native tab context wins over fallback');
print('PASS: Localized headings stay stable and contextual tab actions take priority over window fallbacks');
