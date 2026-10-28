// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors
import GLib from 'gi://GLib';

// Exercise the standard GMenu submenu-action contract. Panel preparation is a
// separate integration step; do not call the bridge's native adapter directly.
export function setImportedSubmenuOpen(source, label, open) {
    const search = model => {
        for (let i = 0; i < model.get_n_items(); i++) {
            const child = model.get_item_link(i, 'submenu');
            if (model.get_item_attribute_value(i, 'label', null)?.unpack() === label) {
                const action = model.get_item_attribute_value(i, 'submenu-action', null)?.unpack();
                if (action)
                    return action;
            }
            const section = model.get_item_link(i, 'section');
            const found = child ? search(child) : section ? search(section) : null;
            if (found)
                return found;
        }
        return null;
    };
    const action = search(source._model);
    const group = source._groups.get('win');
    if (!action?.startsWith('win.') || !group?.get_action_enabled(action.slice(4)))
        return false;
    if (open && group.get_action_state(action.slice(4))?.unpack() === true)
        return true;
    group.change_action_state(action.slice(4), new GLib.Variant('b', open));
    return true;
}
