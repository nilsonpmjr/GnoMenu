#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Independent DBusMenu exporter with deterministic controls for transport tests."""
import json
import os
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

XML = '''<node>
<interface name="com.canonical.dbusmenu">
  <method name="GetLayout"><arg type="i" direction="in"/><arg type="i" direction="in"/>
    <arg type="as" direction="in"/><arg type="u" direction="out"/>
    <arg type="(ia{sv}av)" direction="out"/></method>
  <method name="Event"><arg type="i" direction="in"/><arg type="s" direction="in"/>
    <arg type="v" direction="in"/><arg type="u" direction="in"/></method>
  <method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
  <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
  <signal name="ItemsPropertiesUpdated"><arg type="a(ia{sv})"/><arg type="a(ias)"/></signal>
</interface>
<interface name="org.example.GnoMenu.Test">
  <method name="GetStats"><arg type="a{sv}" direction="out"/></method>
  <method name="SetProperty"><arg type="i" direction="in"/><arg type="s" direction="in"/>
    <arg type="v" direction="in"/></method>
  <method name="RemoveProperty"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
  <method name="DelayNextLayout"><arg type="u" direction="in"/></method>
  <method name="Oversize"/>
  <method name="RegisterWindows"/>
  <method name="UnregisterWindow"><arg type="u" direction="in"/></method>
  <method name="Quit"/>
</interface></node>'''


class Menu:
    def __init__(self, bus, path):
        self.bus = bus
        self.path = path
        self.revision = 1
        self.delay = 0
        self.requests = 0
        self.clicked = []
        self.opened = []
        self.closed = []
        self.timestamp = 0
        self.nodes = {}
        self.node(0, '', [1])
        self.node(1, '_File', [2, 3, 4, 5, 6, 7, 8], **{'children-display': 'submenu'})
        self.node(2, 'Increment')
        self.node(3, 'Check', **{'toggle-type': 'checkmark', 'toggle-state': 0})
        self.node(4, 'Radio', **{'toggle-type': 'radio', 'toggle-state': 1})
        self.node(5, 'Disabled', enabled=False)
        self.node(6, 'Hidden', visible=False)
        self.node(7, '', type='separator')
        self.node(8, 'Lazy submenu', **{'children-display': 'submenu'})
        self.registrations = [bus.register_object_with_closures2(path, interface, self.method, None, None)
                              for interface in Gio.DBusNodeInfo.new_for_xml(XML).interfaces]

    def node(self, item_id, label, children=None, **properties):
        props = {'label': GLib.Variant('s', label)}
        for name, value in properties.items():
            kind = 'b' if isinstance(value, bool) else 'i' if isinstance(value, int) else 's'
            props[name] = GLib.Variant(kind, value)
        self.nodes[item_id] = [props, list(children or [])]

    def layout(self, item_id, depth, properties):
        props, children = self.nodes[item_id]
        values = {key: value for key, value in props.items() if not properties or key in properties}
        descendants = [GLib.Variant('(ia{sv}av)', self.layout(child, depth - 1, properties))
                       for child in children] if depth != 0 else []
        return item_id, values, descendants

    def layout_changed(self):
        self.revision += 1
        self.bus.emit_signal(None, self.path, 'com.canonical.dbusmenu', 'LayoutUpdated',
                             GLib.Variant('(ui)', (self.revision, 0)))

    def changed(self, item_id, values=None, removed=None):
        self.bus.emit_signal(None, self.path, 'com.canonical.dbusmenu', 'ItemsPropertiesUpdated',
                             GLib.Variant('(a(ia{sv})a(ias))',
                                          ([(item_id, values)] if values else [],
                                           [(item_id, removed)] if removed else [])))

    def method(self, _bus, _sender, _path, _interface, method, parameters, invocation):
        args = parameters.unpack()
        if method == 'GetLayout':
            self.requests += 1
            reply = GLib.Variant('(u(ia{sv}av))',
                                 (self.revision, self.layout(args[0], args[1], args[2])))
            delay, self.delay = self.delay, 0
            if delay:
                def later():
                    invocation.return_value(reply)
                    return GLib.SOURCE_REMOVE
                GLib.timeout_add(delay, later)
                return
            invocation.return_value(reply)
            return
        if method == 'AboutToShow':
            updated = args[0] == 8 and 9 not in self.nodes
            if updated:
                self.node(9, 'Lazy command')
                self.nodes[8][1].append(9)
                self.layout_changed()
            invocation.return_value(GLib.Variant('(b)', (updated,)))
            return
        if method == 'Event':
            item_id, event, _data, timestamp = args
            self.timestamp = timestamp
            if event == 'clicked':
                self.clicked.append(item_id)
                if item_id == 3:
                    self.nodes[3][0]['toggle-state'] = GLib.Variant('i',
                        1 - self.nodes[3][0]['toggle-state'].unpack())
                    self.changed(3, {'toggle-state': self.nodes[3][0]['toggle-state']})
            elif event == 'opened':
                self.opened.append(item_id)
            elif event == 'closed':
                self.closed.append(item_id)
        elif method == 'GetStats':
            invocation.return_value(GLib.Variant('(a{sv})', ({
                'clicked': GLib.Variant('ai', self.clicked),
                'opened': GLib.Variant('ai', self.opened),
                'closed': GLib.Variant('ai', self.closed),
                'timestamp': GLib.Variant('u', self.timestamp),
                'requests': GLib.Variant('u', self.requests),
            },)))
            return
        elif method == 'SetProperty':
            item_id, key, _value = args
            value = parameters.get_child_value(2).get_variant()
            self.nodes[item_id][0][key] = value
            self.changed(item_id, {key: value})
        elif method == 'RemoveProperty':
            item_id, key = args
            self.nodes[item_id][0].pop(key, None)
            self.changed(item_id, removed=[key])
        elif method == 'DelayNextLayout':
            self.delay = args[0]
        elif method == 'Oversize':
            for item_id in range(100, 700):
                self.node(item_id, f'Large {item_id}')
                self.nodes[1][1].append(item_id)
            self.layout_changed()
        elif method == 'Quit':
            GLib.idle_add(lambda: loop.quit() or GLib.SOURCE_REMOVE)
        elif method == 'RegisterWindows':
            register_windows()
        elif method == 'UnregisterWindow':
            registrar_call('UnregisterWindow', GLib.Variant('(u)', args))
        else:
            if method != 'Event':
                invocation.return_dbus_error('org.example.UnknownMethod', method)
                return
        invocation.return_value(GLib.Variant('()', ()))


bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
loop = GLib.MainLoop()
menus = [Menu(bus, f'/menu/{number}') for number in (1, 2)]


def registrar_call(method, parameters):
    bus.call_sync('com.canonical.AppMenu.Registrar', '/com/canonical/AppMenu/Registrar',
                  'com.canonical.AppMenu.Registrar', method, parameters,
                  GLib.VariantType.new('()'), Gio.DBusCallFlags.NO_AUTO_START, 1500, None)


def register_windows():
    for number in (1, 2):
        registrar_call('RegisterWindow', GLib.Variant('(uo)', (100 + number, f'/menu/{number}')))


if os.environ.get('GNOMENU_FIXTURE_REGISTER') == '1':
    register_windows()
print(json.dumps({'owner': bus.get_unique_name()}), flush=True)
loop.run()
bus.close_sync(None)
