#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Inspect menu capabilities without activating apps or invoking actions."""
import argparse
import configparser
import hashlib
import json
import os
import re
import subprocess
import xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime, timezone

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

REGISTRAR = 'com.canonical.AppMenu.Registrar'


def permission_summary(text):
    """Keep transport metadata, never filesystem grants or environment values."""
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    parser.read_string(text)
    return {
        'sockets': [value for value in parser.get('Context', 'sockets', fallback='').split(';') if value],
        'session_bus_policy': dict(parser.items('Session Bus Policy')) if parser.has_section('Session Bus Policy') else {},
    }


def matching_names(selector, names):
    """Namespace matching is endpoint discovery, never window association."""
    if selector.endswith('.*'):
        base = selector[:-2]
        return sorted(name for name in names if name == base or name.startswith(base + '.'))
    return [selector] if selector in names else []


def endpoint_label(selector, name):
    # Some instance names encode the user's profile path. Keep those opaque.
    if selector.endswith('.*') and name != selector[:-2]:
        return selector[:-2] + '.<instance:' + hashlib.sha256(name.encode()).hexdigest()[:12] + '>'
    return name


def capture(command):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
        return (result.stdout, None) if result.returncode == 0 else (None, result.stderr.strip())
    except (OSError, subprocess.TimeoutExpired) as error:
        return None, str(error)


def flatpak_metadata(app_id, running, command=capture):
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){2,}', app_id):
        raise ValueError('Expected a Flatpak application ID, not a command option or path')
    result = {'app_id': app_id, 'running_instance_observed': app_id in running if running is not None else None,
              'permission_layers': {}, 'errors': []}
    # Keep each layer separate: a declared grant is not proof of runtime access.
    layers = {
        'reported': ['flatpak', 'info', '--show-permissions', app_id],
        'system_global_override': ['flatpak', 'override', '--system', '--show'],
        'system_app_override': ['flatpak', 'override', '--system', '--show', app_id],
        'user_global_override': ['flatpak', 'override', '--user', '--show'],
        'user_app_override': ['flatpak', 'override', '--user', '--show', app_id],
    }
    for label, arguments in layers.items():
        output, error = command(arguments)
        if output is not None:
            try:
                result['permission_layers'][label] = permission_summary(output)
            except configparser.Error as failure:
                error = str(failure)
        if error:
            result['errors'].append({'scope': label, 'message': error})
    commit, error = command(['flatpak', 'info', '--show-commit', app_id])
    result['deployment_commit'] = commit.strip() if commit is not None else None
    if error:
        result['errors'].append({'scope': 'deployment', 'message': error})
    result['reported_registrar_policy'] = result['permission_layers'].get('reported', {}).get('session_bus_policy', {}).get(REGISTRAR)
    return result


def interface_status(interfaces, incomplete):
    if incomplete:
        return 'incomplete-scan'
    kinds = {entry['interface'] for entry in interfaces}
    if 'org.gtk.Menus' in kinds:
        return 'gmenu-interface-observed'
    if 'com.canonical.dbusmenu' in kinds:
        return 'dbusmenu-interface-unassociated'
    if 'org.gtk.Actions' in kinds:
        return 'actions-interface-only'
    return 'no-menu-interface-observed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', action='append', help='Exact D-Bus name or namespace.* to inspect (repeatable)')
    parser.add_argument('--flatpak', action='append', default=[], metavar='APP_ID',
                        help='Inspect Flatpak transport permissions, process presence and owned namespace endpoints')
    parser.add_argument('--max-nodes', type=int, default=80)
    args = parser.parse_args()
    if args.max_nodes < 1:
        parser.error('--max-nodes must be positive')
    for app_id in args.flatpak:
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*){2,}', app_id):
            parser.error('--flatpak requires an application ID such as org.signal.Signal')
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

    shell_version, shell_error = capture(['gnome-shell', '--version'])
    report = {
        'timestamp_utc': datetime.now(timezone.utc).isoformat(),
        'session_type': os.environ.get('XDG_SESSION_TYPE'),
        'gnome_shell': shell_version.strip() if shell_version is not None else None,
        'gnome_shell_query_error': shell_error,
        'registrar_owner': owner('com.canonical.AppMenu.Registrar'),
        'applications': [], 'flatpaks': [],
        'limits': 'Introspection finds exported interfaces only; absence is not proof '
                  'that an application has no internal menus. Missing owned names do not prove '
                  'that an application is stopped. Flatpak process presence is independent of D-Bus '
                  'ownership; permission layers are declarations, not a runtime access test. '
                  'DBusMenu may be a tray menu and is not associated with a window. No actions are invoked.',
    }
    names = set(call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames')[0])
    selectors = list(args.name or ([] if args.flatpak else ['org.gnome.Nautilus', 'org.gnome.Ptyxis']))
    if args.flatpak:
        output, error = capture(['flatpak', 'ps', '--columns=application'])
        running = set(output.splitlines()) if output is not None else None
        report['flatpak_process_query_error'] = error
        for app_id in dict.fromkeys(args.flatpak):
            record = flatpak_metadata(app_id, running)
            record['owned_namespace_endpoints'] = [endpoint_label(app_id + '.*', name)
                                                   for name in matching_names(app_id + '.*', names)]
            report['flatpaks'].append(record)
            selectors.append(app_id + '.*')
    selected = {}
    for selector in dict.fromkeys(selectors):
        matches = matching_names(selector, names)
        if matches:
            for name in matches:
                selected.setdefault(name, (selector, endpoint_label(selector, name)))
        else:
            report['applications'].append({'name': selector, 'owner': None, 'interfaces': [],
                                           'errors': [], 'status': 'no-owned-bus-name'})
    for name, (selector, display) in selected.items():
        current_owner = owner(name)
        app = {'name': display, 'selector': selector, 'owner': current_owner, 'interfaces': [], 'errors': []}
        report['applications'].append(app)
        if not current_owner:
            app['status'] = 'name-owner-lost'
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
                if len(xml) > 2 * 1024 * 1024:
                    raise ValueError('Introspection XML exceeds the probe limit')
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
            except (GLib.Error, ET.ParseError, ValueError) as error:
                app['errors'].append({'path': path, 'message': str(error)})
        app['nodes_visited'] = len(seen)
        app['truncated'] = bool(queue)
        app['status'] = interface_status(app['interfaces'], bool(app['errors'] or queue))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
