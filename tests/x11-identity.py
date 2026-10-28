#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Ownership rejection tests on the private Electron desktop only."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from unittest.mock import patch
from gi.repository import Gio, GLib

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from companion.x11_identity import X11Identity, UnverifiedIdentity


def rejected(call, reason=None):
    try:
        call()
    except UnverifiedIdentity as error:
        if reason:
            assert reason in str(error), str(error)
        return str(error)
    raise AssertionError('An unverified identity was accepted')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('registrar_owner')
    parser.add_argument('report', type=Path)
    parser.add_argument('--closed-xid', type=int)
    parser.add_argument('--remaining-xid', type=int)
    parser.add_argument('--exporter-owner')
    args = parser.parse_args()
    private_root = os.environ.get('GNOMENU_ELECTRON_WORKSPACE')
    if not private_root or os.environ.get('GNOMENU_ELECTRON_BUS') != '1' or os.environ.get('GNOMENU_ELECTRON_BACKEND') != 'x11':
        parser.error('This test requires the private Electron X11 harness')
    workspace = Path(private_root)
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    passed = []

    def record(message):
        passed.append(message)
        print(f'PASS: {message}', flush=True)

    with X11Identity() as checker:
        if args.closed_xid:
            assert args.remaining_xid and args.exporter_owner
            reason = rejected(lambda: checker.verify(bus, args.closed_xid, args.exporter_owner), 'not a live')
            remaining = checker.verify(bus, args.remaining_xid, args.exporter_owner)
            record('Closed XIDs are rejected while another window of the same live exporter remains verifiable')
            report = {'success': True, 'passed': passed, 'closedReason': reason, 'remaining': remaining}
        else:
            registrations = bus.call_sync(args.registrar_owner, '/com/canonical/AppMenu/Registrar',
                'com.canonical.AppMenu.Registrar', 'GetMenus', None, GLib.VariantType.new('(a(uso))'),
                Gio.DBusCallFlags.NO_AUTO_START, 1500, None).unpack()[0]
            assert len(registrations) == 2
            identities = [dict(checker.verify(bus, xid, owner), windowId=xid, menuPath=path)
                          for xid, owner, path in registrations]
            assert identities[0]['windowId'] != identities[1]['windowId']
            assert all(item['xresPid'] == item['busPid'] for item in identities)
            record('Registrar-declared XIDs independently match server-reported process ownership and unique D-Bus credentials')
            first = identities[0]
            assert Path(f'/proc/{first["xresPid"]}/exe').resolve() == workspace / 'runtime/electron', \
                'Only an owned staged fixture window may have its PID hint changed'
            for xid in [0, -1, True, 0x100000000, '1']:
                rejected(lambda: checker.verify(bus, xid, first['busName']), 'uint32')
            rejected(lambda: checker.verify(bus, first['windowId'], 'org.example.Alias'), 'unique')
            record('Zero, malformed or out-of-range XIDs and well-known D-Bus aliases are rejected')
            rejected(lambda: checker.verify(bus, checker.root, first['busName']), 'not a managed')
            rejected(lambda: checker.verify(bus, 0xffffffff, first['busName']), 'not a live')
            record('The root window and nonexistent window resources are rejected without terminating the X11 worker')
            rejected(lambda: checker.verify(bus, first['windowId'], bus.get_unique_name()), 'different processes')
            rejected(lambda: checker.verify(bus, first['windowId'], ':999999.999999'), 'credentials')
            record('Live windows reject a foreign D-Bus process and a missing unique owner')
            target = hex(first['windowId'])
            old = subprocess.check_output(['xprop', '-id', target, '_NET_WM_PID'], text=True, timeout=3)
            match = re.search(r'_NET_WM_PID\(CARDINAL\) = ([0-9]+)', old)
            assert match

            def hint(value):
                subprocess.run(['xprop', '-id', target, '-f', '_NET_WM_PID', '32c',
                                '-set', '_NET_WM_PID', str(value)], check=True, timeout=3, capture_output=True)

            try:
                # This is an already verified owned fixture window. Alter only
                # its advisory hint, then restore the exact original value.
                hint(os.getpid())
                assert checker.verify(bus, first['windowId'], first['busName'])['xresPid'] == first['xresPid']
                rejected(lambda: checker.verify(bus, first['windowId'], bus.get_unique_name()), 'different processes')
            finally:
                hint(match[1])
            record('Spoofing _NET_WM_PID cannot transfer menu ownership and its original hint is restored')
            for display in ['remote.example:0', '', 'wayland-0']:
                with patch.dict(os.environ, {'DISPLAY': ''}):
                    rejected(lambda: X11Identity(display), 'local X11')
            with patch('companion.x11_identity.C.CDLL', side_effect=OSError('missing test library')):
                rejected(lambda: X11Identity(':0'), 'unavailable')
            record('Non-X11 or remote displays and absent optional libraries fail closed')
            report = {'success': True, 'passed': passed, 'identities': identities,
                      'limits': ['Server/process agreement is necessary evidence, not authentication of menu contents.',
                                 'This is a non-atomic local X11 snapshot; publication must revalidate lifecycle.',
                                 'PID namespaces, Flatpak proxies and native Wayland are not validated.']}
    rejected(lambda: checker.verify(bus, 1, ':1.0'), 'closed')
    args.report.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
