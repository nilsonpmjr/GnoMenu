#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Headless exporter for real Gio menu/action integration tests."""
import json
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()
app = Gio.SimpleActionGroup()
menus = []
groups = [app]
registrations = []


def action(group, name, callback=None, state=None, parameter=None, enabled=True):
    kind = GLib.VariantType.new(parameter) if parameter else None
    item = (Gio.SimpleAction.new_stateful(name, kind, state) if state is not None
            else Gio.SimpleAction.new(name, kind))
    if callback:
        item.connect('activate', callback)
    item.set_enabled(enabled)
    group.add_action(item)
    return item


action(app, 'quit', lambda *_: loop.quit())
preferences_count = action(app, 'preferences-count', state=GLib.Variant('i', 0))
action(app, 'preferences', lambda *_: preferences_count.set_state(
    GLib.Variant('i', preferences_count.get_state().unpack() + 1)))
action(app, 'settings')
action(app, 'new-window', parameter='s')  # Incompatible with the adapter's no-arg command.
action(app, 'clone-window')  # Application-scoped, but still needs a client window.
action(app, 'about', parameter='s')  # Must not be guessed without its parameter.
application_menu = Gio.Menu()
application_menu.append('Native settings label', 'app.preferences')
application_menu.append('Quit', 'app.quit')  # Deliberate translation-key collision.
menus.append(application_menu)
registrations.append(bus.export_menu_model('/lab/application/menu', application_menu))
placement = Gio.Menu()
edit = Gio.Menu()
edit.append('Native preferences in Edit', 'app.preferences')
placement.append_submenu('Native Edit', edit)
menus.extend([placement, edit])
registrations.append(bus.export_menu_model('/lab/menu/placement', placement))
for number in (1, 2):
    group = Gio.SimpleActionGroup()
    groups.append(group)
    counter = action(group, 'counter', state=GLib.Variant('i', 0))
    tabs = action(group, 'tabs', state=GLib.Variant('i', 0))
    action(group, 'new-tab', lambda _, __, tabs=tabs:
           tabs.set_state(GLib.Variant('i', tabs.get_state().unpack() + 1)))
    action(group, 'increment', lambda _, __, counter=counter:
           counter.set_state(GLib.Variant('i', counter.get_state().unpack() + 1)))
    action(group, 'checked', state=GLib.Variant('b', False))
    mode = action(group, 'mode', state=GLib.Variant('s', 'one'), parameter='s')
    mode.set_state_hint(GLib.Variant('as', ['one', 'two']))
    action(group, 'parameter-toggle', state=GLib.Variant('b', False), parameter='b')
    action(group, 'show-menubar', state=GLib.Variant('b', True))
    blocked = action(group, 'blocked', enabled=False)
    action(group, 'enable', lambda *_args, blocked=blocked: blocked.set_enabled(True))
    root = Gio.Menu()
    file_menu = Gio.Menu()
    section = Gio.Menu()
    section.append(f'Increment window {number}', 'win.increment')
    section.append('Check', 'win.checked')
    file_menu.append_section(None, section)
    file_menu.append('Disabled', 'win.blocked')
    file_menu.append('Mode one', "win.mode::one")
    file_menu.append('Mode two', "win.mode::two")
    file_menu.append('Enable disabled item', 'win.enable')
    file_menu.append('Add dynamic item', 'win.dynamic')
    action(group, 'dynamic', lambda *_args, menu=file_menu:
           menu.append('Dynamic command', 'win.increment'))
    def replace(*_args, menu=section):
        menu.remove(0)
        menu.insert(0, 'Replacement action', 'win.blocked')

    action(group, 'replace', replace)
    file_menu.append('Replace first item', 'win.replace')
    file_menu.append('Expand large menu', 'win.large')

    def expand(*_args, menu=file_menu):
        for item in range(600):
            menu.append(f'Large item {item}', 'win.increment')

    action(group, 'large', expand)
    root.append_submenu('_File', file_menu)
    menus.extend([root, file_menu, section])
    registrations.append(bus.export_action_group(f'/lab/window/{number}', group))
    registrations.append(bus.export_menu_model(f'/lab/menu/{number}', root))
    if number == 1:
        layout = Gio.Menu()
        wrapper = Gio.MenuItem.new_submenu('Main Menu', file_menu)
        wrapper.set_attribute_value('x-gnomenu-layout', GLib.Variant('s', 'files'))
        layout.append_item(wrapper)
        action(group, 'context-mode', lambda _, value, mode=mode: mode.set_state(value), parameter='s')
        tools = Gio.Menu()
        tools.append('Native context mode', 'win.context-mode::two')
        nested = Gio.Menu()
        nested.append_submenu('Native context submenu', tools)

        def toggle_context(*_args):
            if layout.get_n_items() > 1:
                layout.remove(1)
            else:
                layout.append_submenu('_Tools', nested)

        action(app, 'toggle-native-context', toggle_context)
        menus.extend([layout, tools, nested])
        registrations.append(bus.export_menu_model('/lab/menu/files_layout', layout))
registrations.append(bus.export_action_group('/lab/app', app))
registrations.append(bus.export_action_group('/org/gnome/Nautilus', app))
print(json.dumps({'owner': bus.get_unique_name()}), flush=True)
loop.run()
bus.close_sync(None)
