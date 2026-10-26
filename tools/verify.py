#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Run the GnoMenu checks and publish a report only after all stages succeed."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
python = sys.executable
metadata = json.loads((root / 'extension/metadata.json').read_text())
bundle = root / f'build/{metadata["uuid"]}.shell-extension.zip'
for command in ([python, "tools/package.py"],
                ["npm", "run", "lint"],
                ["dbus-run-session", "--", python, "tests/run-integration.py"],
                ["dbus-run-session", "--", python, "tests/run-i18n.py"],
                [python, "tests/run-shell.py", "--bundle", str(bundle)],
                [python, "tests/run-shell.py", "--bundle", str(bundle), "--locale", "pt_BR.UTF-8"],
                [python, "tests/run-shell.py", "--bundle", str(bundle), "--real-apps"],
                [python, "tests/run-shell.py", "--bundle", str(bundle), "--real-apps", "--locale", "pt_BR.UTF-8"]):
    subprocess.run(command, cwd=root, check=True)
reports = root / 'reports'
integration = json.loads((reports / 'integration.json').read_text())
shell = json.loads((reports / 'dev-session/shell-result.json').read_text())
portuguese = json.loads((reports / 'dev-session/locales/pt_BR.UTF-8/shell-result.json').read_text())
i18n = json.loads((reports / 'i18n.json').read_text())
real_apps = json.loads((reports / 'dev-session/real-apps/shell-result.json').read_text())
real_apps_pt = json.loads((reports / 'dev-session/real-apps/locales/pt_BR.UTF-8/shell-result.json').read_text())
log = (reports / 'dev-session/shell.log').read_text()
assert shell['success'] and portuguese['success'] and all(result['success'] for result in integration.values())
assert all(result['success'] for result in i18n)
assert real_apps['success'] and real_apps_pt['success']
report = {
    'product': 'GnoMenu',
    'timestamp_utc': datetime.now(timezone.utc).isoformat(),
    'gnome_shell': subprocess.check_output(['gnome-shell', '--version'], text=True).strip(),
    'transport_integration': integration,
    'shell_integration': shell,
    'shell_portuguese': portuguese,
    'localization': i18n,
    'real_apps': {'inherited': real_apps, 'pt_BR': real_apps_pt,
                 'versions': subprocess.check_output(['rpm', '-q', 'nautilus', 'ptyxis'], text=True).splitlines()},
    'shell_log_check': {'gjs_critical_errors': log.count('Gjs-CRITICAL'), 'js_errors': log.count('JS ERROR')},
    'dropdown_alignment': json.loads((reports / 'dev-session/alignment.json').read_text()),
    'bundle_sha256': hashlib.sha256(bundle.read_bytes()).hexdigest(),
    'limits': [
        'Shell actor activation is programmatic; physical input, full keyboard navigation and accessibility are not verified.',
        'DBusMenu adapter is tested independently; automatic source-to-window discovery and panel integration are pending.',
        'AppMenu registrar was exercised only on an isolated bus; it is not installed or started by the extension.',
        'Registry-to-source discovery uses explicitly supplied window IDs; it is not yet connected to Mutter window discovery.',
        'Nautilus 50.4 and Ptyxis 50.1 have partial action-based support; complete native menus and other priority applications remain unverified.',
    ],
}
(reports / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
(reports / 'panel-preview.png').write_bytes((reports / 'dev-session/panel-preview.png').read_bytes())
for name in ['alignment.json', 'alignment-0.png', 'alignment-1.png', 'alignment-2.png']:
    (reports / name).write_bytes((reports / 'dev-session' / name).read_bytes())
(reports / 'panel-preview-pt_BR.png').write_bytes(
    (reports / 'dev-session/locales/pt_BR.UTF-8/panel-preview.png').read_bytes())
groups = sum(len(result['passed']) for result in integration.values()) + len(shell['passed']) + len(portuguese['passed']) + len(i18n)
for name in ['nautilus-menu.png', 'ptyxis-menu.png', 'nautilus-after-new-tab.png', 'nautilus-tabs.json']:
    (reports / name).write_bytes((reports / 'dev-session/real-apps' / name).read_bytes())
groups += len(real_apps['passed']) + len(real_apps_pt['passed'])
print(f'GnoMenu: {groups} check groups passed. Report: {reports / "verification.json"}')
