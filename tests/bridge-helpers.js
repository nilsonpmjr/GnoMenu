// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 GnoMenu contributors

// Use the production consumer's submenu protocol, shared with the Shell panel.
export function setImportedSubmenuOpen(source, label, open) {
    const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children)]);
    const node = flatten(source.snapshot).find(item => item.kind === 'submenu' && item.label === label);
    return open ? source.prepare(node) : source.close(node);
}
