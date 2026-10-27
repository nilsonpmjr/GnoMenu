#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Check diagnostic boundaries without reading the user's session or profiles."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('probe', Path(__file__).resolve().parent.parent / 'tools/probe-session.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

names = {'org.example.App', 'org.example.App.instance', 'org.example.Application', ':1.2'}
assert probe.matching_names('org.example.App.*', names) == ['org.example.App', 'org.example.App.instance']
assert probe.matching_names(':1.2', names) == [':1.2']
assert probe.matching_names('org.example.Missing', names) == []
assert 'encoded-profile' not in probe.endpoint_label('org.example.App.*', 'org.example.App.encoded-profile')
assert probe.endpoint_label('org.example.App', 'org.example.App') == 'org.example.App'
print('PASS: Namespace discovery respects component boundaries and exact unique names')

parsed = probe.permission_summary('[Context]\nsockets=wayland;fallback-x11;\nfilesystems=/private-vault;\n'
                                  '[Environment]\nTOKEN=private\n[Session Bus Policy]\n'
                                  'com.canonical.AppMenu.Registrar=talk\n')
assert parsed == {'sockets': ['wayland', 'fallback-x11'],
                  'session_bus_policy': {'com.canonical.AppMenu.Registrar': 'talk'}}
assert probe.permission_summary('') == {'sockets': [], 'session_bus_policy': {}}
print('PASS: Diagnostic permission output excludes environment values and filesystem grants')

def command(args):
    if '--show-commit' in args:
        return 'deployment\n', None
    if '--show-permissions' in args:
        return '[Session Bus Policy]\ncom.canonical.AppMenu.Registrar=talk\n', None
    if '--user' in args and args[-1] == 'org.example.App':
        return '[Session Bus Policy]\ncom.canonical.AppMenu.Registrar=none\n', None
    return '', None

result = probe.flatpak_metadata('org.example.App', {'org.example.App'}, command)
assert result['running_instance_observed'] is True and result['reported_registrar_policy'] == 'talk'
assert result['permission_layers']['user_app_override']['session_bus_policy'][probe.REGISTRAR] == 'none'
assert probe.flatpak_metadata('org.example.App', None, command)['running_instance_observed'] is None
assert probe.flatpak_metadata('org.example.App', set(), command)['running_instance_observed'] is False
assert not result['errors']
for invalid in ['--reset', '/private/path', 'org.example.App --reset']:
    try:
        probe.flatpak_metadata(invalid, set(), lambda _: (_ for _ in ()).throw(AssertionError('must not run a command')))
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid application IDs must be rejected before calling Flatpak')
print('PASS: Flatpak process presence and conflicting permission layers remain separate observations')

assert probe.interface_status([{'interface': 'org.gtk.Menus'}], False) == 'gmenu-interface-observed'
assert probe.interface_status([{'interface': 'com.canonical.dbusmenu'}], False) == 'dbusmenu-interface-unassociated'
assert probe.interface_status([{'interface': 'org.gtk.Actions'}], False) == 'actions-interface-only'
assert probe.interface_status([], False) == 'no-menu-interface-observed'
assert probe.interface_status([{'interface': 'org.gtk.Menus'}], True) == 'incomplete-scan'
print('PASS: Incomplete scans, action-only exports and unassociated DBusMenu interfaces do not imply full compatibility')
