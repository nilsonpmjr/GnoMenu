#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Inspect menu capabilities without activating apps or invoking actions."""
import argparse
import json
import os
import subprocess
import xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime, timezone

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', action='append', help='D-Bus name to inspect (repeatable)')
    parser.add_argument('--max-nodes', type=int, default=80)
    args = parser.parse_args()
    if args.max_nodes < 1:
        parser.error('--max-nodes must be positive')
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)

    def call(name, path, interface, method, params=None):
        return bus.call_sync(name, path, interface, method, params, None,
                             Gio.DBusCallFlags.NO_AUTO_START, 1000, None).unpack()

    def owner(name):
        try:
            return call('org.freedesktop.DBus', '/org/freedesktop/DBus',
                        'org.freedesktop.DBus', 'GetNameOwner',
                        GLib.Variant('(s)', (name,)))[0]
        except GLib.Error:
            return None

    report = {
        'timestamp_utc': datetime.now(timezone.utc).isoformat(),
        'session_type': os.environ.get('XDG_SESSION_TYPE'),
        'gnome_shell': subprocess.run(['gnome-shell', '--version'], capture_output=True,
                                      text=True, check=False).stdout.strip(),
        'registrar_owner': owner('com.canonical.AppMenu.Registrar'),
        'applications': [],
        'limits': 'Introspection finds exported interfaces only; absence is not proof '
                  'that an application has no internal menus. No actions are invoked.',
    }
    for name in args.name or ['org.gnome.Nautilus', 'org.gnome.Ptyxis']:
        current_owner = owner(name)
        app = {'name': name, 'owner': current_owner, 'interfaces': [], 'errors': []}
        report['applications'].append(app)
        if not current_owner:
            app['status'] = 'not-running'
            continue
        # Pin the unique owner so a name handover cannot switch the scanned process.
        queue = deque(['/'])
        seen = set()
        while queue and len(seen) < args.max_nodes:
            path = queue.popleft()
            if path in seen:
                continue
            seen.add(path)
            try:
                xml = call(current_owner, path, 'org.freedesktop.DBus.Introspectable',
                           'Introspect')[0]
                root = ET.fromstring(xml)
                for interface in root.findall('interface'):
                    kind = interface.get('name')
                    if kind not in {'org.gtk.Actions', 'org.gtk.Menus',
                                    'com.canonical.dbusmenu'}:
                        continue
                    found = {'path': path, 'interface': kind}
                    if kind == 'org.gtk.Actions':
                        found['actions'] = sorted(call(current_owner, path, kind, 'List')[0])
                    app['interfaces'].append(found)
                for child in root.findall('node'):
                    part = child.get('name', '')
                    child_path = part if part.startswith('/') else path.rstrip('/') + '/' + part
                    if child_path not in seen:
                        queue.append(child_path)
            except (GLib.Error, ET.ParseError) as error:
                app['errors'].append({'path': path, 'message': str(error)})
        app['nodes_visited'] = len(seen)
        app['truncated'] = bool(queue)
        app['status'] = 'partial' if app['errors'] or queue else 'scanned'
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
