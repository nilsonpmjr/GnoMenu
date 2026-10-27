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
    'extension_sources_sha256': {name: hashlib.sha256((root / 'extension' / name).read_bytes()).hexdigest()
                                 for name in ['metadata.json', 'extension.js', 'gmenuSource.js', 'actionMenus.js']},
    'driver_sha256': hashlib.sha256((root / 'tests/shell-driver/extension.js').read_bytes()).hexdigest(),
    'nautilus_sha256': hashlib.sha256(Path('/usr/bin/nautilus').read_bytes()).hexdigest(),
    'versions': subprocess.check_output(['rpm', '-q', 'nautilus', 'gtk4', 'gnome-shell'], text=True).splitlines(),
    'cases': cases,
    'limits': [
        'Actual toolbar, tab, clicked breadcrumb, file-selection and background context models of Nautilus 50.4 are captured.',
        'The marked Nautilus presentation keeps app-name/File/Edit/View/Go/Help and distributes imported commands while retaining their captured targets.',
        'Generic widget-class actions, long-running stress, trash/deletion, arbitrary extension menus and Flatpak loading are not validated.',
        'Tab cycles, narrow/wide resizing and grid/list changes cover the declared Nautilus version only.',
        'The optional library is loaded into test Nautilus processes only; it is outside the extension ZIP.',
        'Show Hidden Files preserves the native shared preference; sort targets are checked on two separate windows.',
        'Folder creation and bookmark operations are checked against the private test filesystem, not the regular desktop.',
        'Tab checks cover native movement and inactive-tab close after right-click; detach, restore and close-other-tabs remain unverified.',
        'Tab pointer input uses the declared private narrow layout; GTK Wayland AT-SPI tab screen origins/selected flags are unreliable in this build.',
        'Breadcrumb checks cover background-tab opening and replacement of a clicked target in the private 1100px layout; New Window, Properties and click-to-retirement races remain unverified.',
        'File-context checks cover background Select All, opening one/two selected folders and retiring stale selection aliases in a fixed private list layout.',
        'Native Copy/Paste, Cut/Paste and single-folder Rename are verified with exact marker contents in private temporary directories; other clipboard formats, file types and batch rename remain unverified.',
        'Actual Back/Forward history popups retain native captions and uint32 targets; navigation, popup replacement and active-tab changes retire their scoped aliases. Other private widget menus and broad history/loading races remain unverified.',
        'Selection snapshots use the documented source contract of Nautilus 50.4 GObject properties and are limited to 128 selected objects; other versions and large selections need separate validation.',
    ],
}
output = root / 'reports/native-exporter.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
groups = sum(len(case['passed']) for case in cases.values())
print(f'Native exporter: {groups} check groups passed. Report: {output}')
