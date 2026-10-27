#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Read visible tab-bar entries from a real window on the PRIVATE test a11y bus."""
import json
import os
import sys
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi, GLib

if not os.environ.get('AT_SPI_BUS_ADDRESS') or os.environ.get('GNOMENU_REAL_APPS') != '1':
    raise SystemExit('This observer requires the private real-app test harness')
pid = int(sys.argv[1])
title = sys.argv[2]
Atspi.set_timeout(1500, 1500)
desktop = Atspi.get_desktop(0)
frames = []
found = None
for index in range(desktop.get_child_count()):
    app = desktop.get_child_at_index(index)
    if app is None or app.get_process_id() != pid:
        continue
    for child_index in range(app.get_child_count()):
        window = app.get_child_at_index(child_index)
        if window is None:
            continue
        frames.append(window.get_name())
        if window.get_name() == title:
            found = window
if found is None:
    print(json.dumps({'found': False, 'frames': frames, 'visibleTabEntries': 0}))
    raise SystemExit(0)
lists = []
tabs = []
names = set()
dialogs = []
entries = []
tab_details = []
visited = 0


def walk(node, depth=0):
    global visited
    if node is None:
        return
    visited += 1
    if visited > 2500 or depth > 40:
        return
    try:
        role = node.get_role()
        if os.environ.get('GNOMENU_OBSERVE_FILES') == '1' and node.get_state_set().contains(Atspi.StateType.SHOWING):
            name = node.get_name()
            if name:
                names.add(name)
            if role == Atspi.Role.DIALOG:
                dialogs.append(name)
            if node.get_state_set().contains(Atspi.StateType.EDITABLE):
                text = node.get_text_iface()
                if text is not None:
                    entries.append({'name': name, 'text': Atspi.Text.get_text(text, 0,
                                    Atspi.Text.get_character_count(text))})
        children = [child for i in range(node.get_child_count())
                    if (child := node.get_child_at_index(i)) is not None]
        if role == Atspi.Role.PAGE_TAB:
            tabs.append(node.get_name())
            if os.environ.get('GNOMENU_OBSERVE_FILES') == '1' and node.get_state_set().contains(Atspi.StateType.SHOWING):
                rectangle = node.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
                tab_details.append({'name': node.get_name(),
                                    'selected': node.get_state_set().contains(Atspi.StateType.SELECTED),
                                    'x': rectangle.x, 'y': rectangle.y,
                                    'width': rectangle.width, 'height': rectangle.height})
        if role == Atspi.Role.PAGE_TAB_LIST:
            count = sum(child.get_role() == Atspi.Role.PAGE_TAB for child in children)
            lists.append(count)
        for child in children:
            walk(child, depth + 1)
    except GLib.Error:
        pass


walk(found)
print(json.dumps({'found': True, 'frames': frames, 'visibleTabEntries': max([len(tabs), *lists]),
                  'tabLists': lists, 'tabs': tabs, 'names': sorted(names), 'dialogs': dialogs,
                  'tabDetails': tab_details, 'entries': entries}, ensure_ascii=False))
