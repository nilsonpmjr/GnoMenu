#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Experimental AppMenu registry; not yet started by the desktop extension.

This records exporter declarations. An X11 window ID is not a Wayland surface
identity, and a registration alone is not proof of association with a MetaWindow.
"""
import json
import signal
import sys
import gi
gi.require_version('Gio', '2.0')
gi.require_version('GLibUnix', '2.0')
from gi.repository import Gio, GLib, GLibUnix

NAME = 'com.canonical.AppMenu.Registrar'
PATH = '/com/canonical/AppMenu/Registrar'
XML = '''<node><interface name="com.canonical.AppMenu.Registrar">
  <method name="RegisterWindow"><arg type="u" direction="in"/><arg type="o" direction="in"/></method>
  <method name="UnregisterWindow"><arg type="u" direction="in"/></method>
  <method name="GetMenuForWindow"><arg type="u" direction="in"/>
    <arg type="s" direction="out"/><arg type="o" direction="out"/></method>
  <method name="GetMenus"><arg type="a(uso)" direction="out"/></method>
  <signal name="WindowRegistered"><arg type="u"/><arg type="s"/><arg type="o"/></signal>
  <signal name="WindowUnregistered"><arg type="u"/></signal>
</interface></node>'''


class Registrar:
    def __init__(self, bus):
        self.bus = bus
        self.windows = {}
        self.registration = None
        self.subscription = None
        self.owns_name = False

    def start(self):
        # DO_NOT_QUEUE, without ALLOW_REPLACEMENT or REPLACE_EXISTING. Never take
        # over another registrar or wait to unexpectedly become active later.
        result = self.bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
                                    'org.freedesktop.DBus', 'RequestName',
                                    GLib.Variant('(su)', (NAME, 4)),
                                    GLib.VariantType.new('(u)'), Gio.DBusCallFlags.NONE,
                                    1500, None).unpack()[0]
        if result != 1:
            raise RuntimeError('An AppMenu registrar already owns the name; it was not replaced')
        self.owns_name = True
        self.subscription = self.bus.signal_subscribe('org.freedesktop.DBus',
            'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus',
            None, Gio.DBusSignalFlags.NONE, self.owner_changed)
        self.registration = self.bus.register_object_with_closures2(
            PATH, Gio.DBusNodeInfo.new_for_xml(XML).interfaces[0], self.method, None, None)

    def emit(self, name, value):
        self.bus.emit_signal(None, PATH, NAME, name, value)

    def remove(self, window_id):
        del self.windows[window_id]
        self.emit('WindowUnregistered', GLib.Variant('(u)', (window_id,)))

    def owner_changed(self, _bus, _sender, _path, _interface, _signal, parameters):
        name, _old_owner, new_owner = parameters.unpack()
        if name.startswith(':') and not new_owner:
            for window_id, (owner, _path) in list(self.windows.items()):
                if owner == name:
                    self.remove(window_id)

    def method(self, _bus, sender, _path, _interface, method, parameters, invocation):
        args = parameters.unpack()
        if method == 'RegisterWindow':
            window_id, menu_path = args
            previous = self.windows.get(window_id)
            if previous and previous[0] != sender:
                invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied',
                                             'Window ID is registered by another connection')
                return
            if not previous and len(self.windows) >= 4096:
                invocation.return_dbus_error('org.freedesktop.DBus.Error.LimitsExceeded',
                                             'Registry capacity reached')
                return
            self.windows[window_id] = (sender, menu_path)
            self.emit('WindowRegistered', GLib.Variant('(uso)', (window_id, sender, menu_path)))
        elif method == 'UnregisterWindow':
            previous = self.windows.get(args[0])
            if previous:
                if previous[0] != sender:
                    invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied',
                                                 'Only the registering connection may unregister')
                    return
                self.remove(args[0])
        elif method == 'GetMenuForWindow':
            invocation.return_value(GLib.Variant('(so)', self.windows.get(args[0], ('', '/'))))
            return
        elif method == 'GetMenus':
            records = [(window_id, owner, menu_path)
                       for window_id, (owner, menu_path) in sorted(self.windows.items())]
            invocation.return_value(GLib.Variant('(a(uso))', (records,)))
            return
        else:
            invocation.return_dbus_error('org.freedesktop.DBus.Error.UnknownMethod', method)
            return
        invocation.return_value(GLib.Variant('()', ()))

    def stop(self):
        if self.subscription is not None:
            self.bus.signal_unsubscribe(self.subscription)
            self.subscription = None
        if self.registration is not None:
            self.bus.unregister_object(self.registration)
            self.registration = None
        self.windows.clear()
        if self.owns_name and not self.bus.is_closed():
            self.bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'ReleaseName', GLib.Variant('(s)', (NAME,)),
                None, Gio.DBusCallFlags.NONE, 1500, None)
        self.owns_name = False


def main():
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    loop = GLib.MainLoop()
    registrar = Registrar(bus)
    handlers = []
    try:
        registrar.start()
        print(json.dumps({'owner': bus.get_unique_name(), 'service': NAME}), flush=True)

        def stop(*_args):
            loop.quit()
            return GLib.SOURCE_CONTINUE

        handlers = [GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, number, stop)
                    for number in (signal.SIGINT, signal.SIGTERM)]
        loop.run()
        return 0
    finally:
        for handler in handlers:
            GLib.source_remove(handler)
        registrar.stop()
        bus.close_sync(None)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
