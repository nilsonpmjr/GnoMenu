# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Read-only X11 ownership guard for an isolated, single-threaded companion worker.

This validates an explicitly declared XID; it never selects windows by PID/title
and never writes properties. It does not authenticate a menu's contents.
"""
import ctypes as C
import os
import re


class UnverifiedIdentity(RuntimeError):
    pass


class ClientSpec(C.Structure):
    _fields_ = [('client', C.c_ulong), ('mask', C.c_uint)]


class ClientValue(C.Structure):
    _fields_ = [('spec', ClientSpec), ('length', C.c_long), ('value', C.c_void_p)]


class XError(C.Structure):
    _fields_ = [('type', C.c_int), ('display', C.c_void_p), ('resourceid', C.c_ulong),
                ('serial', C.c_ulong), ('error_code', C.c_ubyte),
                ('request_code', C.c_ubyte), ('minor_code', C.c_ubyte)]


class X11Identity:
    def __init__(self, display=None):
        display = display or os.environ.get('DISPLAY', '')
        if not re.fullmatch(r':[0-9]+(?:\.[0-9]+)?', display):
            raise UnverifiedIdentity('A local X11 display is required')
        try:
            self.x = C.CDLL('libX11.so.6')
            self.res = C.CDLL('libXRes.so.1')
        except OSError as error:
            raise UnverifiedIdentity('X11/XRes libraries are unavailable') from error
        pointer = C.c_void_p
        ulong_p = C.POINTER(C.c_ulong)
        signatures = [
            (self.x, 'XOpenDisplay', [C.c_char_p], pointer),
            (self.x, 'XCloseDisplay', [pointer], C.c_int),
            (self.x, 'XDefaultRootWindow', [pointer], C.c_ulong),
            (self.x, 'XSync', [pointer, C.c_int], C.c_int),
            (self.x, 'XFree', [pointer], C.c_int),
            (self.x, 'XSetErrorHandler', [pointer], pointer),
            (self.x, 'XQueryTree', [pointer, C.c_ulong, ulong_p, ulong_p,
                                  C.POINTER(ulong_p), C.POINTER(C.c_uint)], C.c_int),
            (self.x, 'XInternAtom', [pointer, C.c_char_p, C.c_int], C.c_ulong),
            (self.x, 'XGetWindowProperty', [pointer, C.c_ulong, C.c_ulong, C.c_long,
                                          C.c_long, C.c_int, C.c_ulong, ulong_p,
                                          C.POINTER(C.c_int), ulong_p, ulong_p,
                                          C.POINTER(pointer)], C.c_int),
            (self.res, 'XResQueryVersion', [pointer, C.POINTER(C.c_int), C.POINTER(C.c_int)], C.c_int),
            (self.res, 'XResQueryClientIds', [pointer, C.c_long, C.POINTER(ClientSpec),
                                            C.POINTER(C.c_long), C.POINTER(C.POINTER(ClientValue))], C.c_int),
            (self.res, 'XResGetClientPid', [C.POINTER(ClientValue)], C.c_int),
            (self.res, 'XResClientIdsDestroy', [C.c_long, C.POINTER(ClientValue)], None),
        ]
        for library, name, args, result in signatures:
            try:
                function = getattr(library, name)
            except AttributeError as error:
                raise UnverifiedIdentity('The installed libraries lack the required XRes 1.2 API') from error
            function.argtypes, function.restype = args, result
        self.display = self.x.XOpenDisplay(display.encode())
        if not self.display:
            raise UnverifiedIdentity('Cannot open the requested X11 display')
        self.errors = []
        self._handler = C.CFUNCTYPE(C.c_int, pointer, C.POINTER(XError))(
            lambda _display, error: self.errors.append(error.contents.error_code) or 0)
        self._previous = self.x.XSetErrorHandler(C.cast(self._handler, pointer))
        try:
            major, minor = C.c_int(), C.c_int()
            available = self.res.XResQueryVersion(self.display, C.byref(major), C.byref(minor))
            self.x.XSync(self.display, 0)
            if not available or self.errors or (major.value, minor.value) < (1, 2):
                raise UnverifiedIdentity('XRes 1.2 is required')
            self.version = [major.value, minor.value]
            self.root = self.x.XDefaultRootWindow(self.display)
        except Exception:
            self.close()
            raise

    def close(self):
        if self.display:
            self.x.XCloseDisplay(self.display)
            self.x.XSetErrorHandler(self._previous)
            self.display = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def _live_window(self, xid):
        self.errors.clear()
        root, parent = C.c_ulong(), C.c_ulong()
        children, count = C.POINTER(C.c_ulong)(), C.c_uint()
        try:
            found = self.x.XQueryTree(self.display, xid, C.byref(root), C.byref(parent),
                                     C.byref(children), C.byref(count))
            self.x.XSync(self.display, 0)
            if not found or self.errors:
                raise UnverifiedIdentity('The declared XID is not a live X11 window')
        finally:
            if children:
                self.x.XFree(children)

    def _managed_windows(self):
        self.errors.clear()
        atom = self.x.XInternAtom(self.display, b'_NET_CLIENT_LIST', 1)
        if not atom:
            raise UnverifiedIdentity('The compositor does not publish managed client windows')
        kind, count, remaining = C.c_ulong(), C.c_ulong(), C.c_ulong()
        format_ = C.c_int()
        data = C.c_void_p()
        try:
            status = self.x.XGetWindowProperty(self.display, self.root, atom, 0, 4096, 0, 33,
                C.byref(kind), C.byref(format_), C.byref(count), C.byref(remaining), C.byref(data))
            self.x.XSync(self.display, 0)
            if status != 0 or self.errors or kind.value != 33 or format_.value != 32 or remaining.value or count.value > 4096:
                raise UnverifiedIdentity('The managed client list is unavailable or exceeds its bound')
            if count.value and not data:
                raise UnverifiedIdentity('The managed client list has no data')
            values = C.cast(data, C.POINTER(C.c_ulong))
            return {int(values[index]) for index in range(count.value)}
        finally:
            if data:
                self.x.XFree(data)

    def _pid(self, xid):
        self.errors.clear()
        spec, count, values = ClientSpec(xid, 2), C.c_long(), C.POINTER(ClientValue)()
        try:
            status = self.res.XResQueryClientIds(self.display, 1, C.byref(spec), C.byref(count), C.byref(values))
            self.x.XSync(self.display, 0)
            # Unlike XResQueryVersion, this function returns Success (zero).
            if status != 0 or self.errors or count.value != 1 or not values:
                raise UnverifiedIdentity('The X server did not supply one local client PID')
            pid = self.res.XResGetClientPid(C.byref(values[0]))
            if pid <= 0:
                raise UnverifiedIdentity('The X client PID is unavailable')
            return pid
        finally:
            if values:
                self.res.XResClientIdsDestroy(count, values)

    def verify(self, bus, xid, owner):
        if not self.display:
            raise UnverifiedIdentity('The X11 identity worker is closed')
        if type(xid) is not int or not 0 < xid <= 0xffffffff:
            raise UnverifiedIdentity('A nonzero uint32 XID is required')
        if not isinstance(owner, str) or not re.fullmatch(r':[0-9]+\.[0-9]+', owner):
            raise UnverifiedIdentity('A unique D-Bus owner is required')
        from gi.repository import Gio, GLib

        def owner_pid():
            try:
                return bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
                    'org.freedesktop.DBus', 'GetConnectionUnixProcessID', GLib.Variant('(s)', (owner,)),
                    GLib.VariantType.new('(u)'), Gio.DBusCallFlags.NO_AUTO_START, 1500, None).unpack()[0]
            except GLib.Error as error:
                raise UnverifiedIdentity('D-Bus owner credentials are unavailable') from error

        before = owner_pid()
        self._live_window(xid)
        if xid not in self._managed_windows():
            raise UnverifiedIdentity('The declared window is not a managed client')
        pid = self._pid(xid)
        if pid != before:
            raise UnverifiedIdentity('The menu owner and X11 window belong to different processes')
        self._live_window(xid)
        if self._pid(xid) != pid or owner_pid() != before:
            raise UnverifiedIdentity('Window or exporter identity changed during verification')
        return {'verified': True, 'xid': xid, 'busName': owner, 'xresPid': pid,
                'busPid': before, 'xresVersion': self.version}
