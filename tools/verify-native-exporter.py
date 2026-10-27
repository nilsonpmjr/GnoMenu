#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Verify the optional exporter with two real Files windows in two private sessions."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--library', type=Path, default=root / 'build/libgnomenu-gtk4.so')
args = parser.parse_args()
library = args.library.resolve()
if not library.is_file():
    parser.error('Build the library first with tools/build-native-exporter.py')
cases = {}
directory = root / 'reports/dev-session/real-apps/native-exporter'
for name, locale in [('inherited', None), ('pt_BR', 'pt_BR.UTF-8')]:
    command = [sys.executable, 'tests/run-shell.py', '--real-apps', '--native-exporter', str(library)]
    if locale:
        command += ['--locale', locale]
    subprocess.run(command, cwd=root, check=True)
    report = directory / ('locales/' + locale if locale else '') / 'shell-result.json'
    cases[name] = json.loads(report.read_text())
    assert cases[name]['success']
report = {
    'success': True,
    'timestamp_utc': datetime.now(timezone.utc).isoformat(),
    'library_sha256': hashlib.sha256(library.read_bytes()).hexdigest(),
    'source_sha256': hashlib.sha256((root / 'native-exporter/gtk4-exporter.c').read_bytes()).hexdigest(),
    'nautilus_sha256': hashlib.sha256(Path('/usr/bin/nautilus').read_bytes()).hexdigest(),
    'versions': subprocess.check_output(['rpm', '-q', 'nautilus', 'gtk4', 'gnome-shell'], text=True).splitlines(),
    'cases': cases,
    'limits': [
        'Actual Main Menu, View Options, Current Folder Menu and tab context models of Nautilus 50.4 are captured.',
        'Selection, breadcrumb and background right-click menus, generic widget-class actions, long-running stress and Flatpak loading are not validated.',
        'Tab cycles, narrow/wide resizing and grid/list changes cover the declared Nautilus version only.',
        'The optional library is loaded into test Nautilus processes only; it is outside the extension ZIP.',
        'Show Hidden Files preserves the native shared preference; sort targets are checked on two separate windows.',
        'Folder creation and bookmark operations are checked against the private test filesystem, not the regular desktop.',
        'Tab checks cover native movement and inactive-tab close after right-click; detach, restore and close-other-tabs remain unverified.',
        'Tab pointer input uses the declared private narrow layout; GTK Wayland AT-SPI tab screen origins/selected flags are unreliable in this build.',
    ],
}
output = root / 'reports/native-exporter.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
groups = sum(len(case['passed']) for case in cases.values())
print(f'Native exporter: {groups} check groups passed. Report: {output}')
