#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Audit the shipped ZIP; --release also requires public submission metadata."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile
import gettext

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--release', action='store_true', help='Fail if public repository/UUID metadata is missing')
args = parser.parse_args()
metadata = json.loads((root / 'extension/metadata.json').read_text())
bundle = root / f'build/{metadata["uuid"]}.shell-extension.zip'
required = {'metadata.json', 'extension.js', 'gmenuSource.js', 'windowSource.js',
            'actionMenus.js', 'stylesheet.css', 'COPYING'}
catalogs = {f'locale/{path.stem}/LC_MESSAGES/gnomenu.mo' for path in (root / 'po').glob('*.po')}
errors = []
blockers = []
if not re.fullmatch(r'[A-Za-z0-9._-]+@[A-Za-z0-9._-]+', metadata['uuid']):
    errors.append('Invalid extension UUID syntax')
if metadata['uuid'].split('@')[-1].endswith('.local'):
    blockers.append('The UUID still uses a development .local namespace; select a namespace you control')
url = metadata.get('url', '')
if not re.fullmatch(r'https://(?:github\.com|gitlab\.com)/[^/\s]+/[^/\s]+', url):
    blockers.append('Add the public project repository URL to metadata.json')
if 'version' in metadata:
    errors.append('Remove the EGO-controlled version field; use version-name for the project version')
if not re.fullmatch(r'(?![. ]+$)[A-Za-z0-9 .]{1,16}', metadata.get('version-name', '')):
    errors.append('Invalid or missing version-name')
if metadata.get('shell-version') != ['50']:
    errors.append('Only GNOME 50 has been validated; do not advertise additional versions yet')
if metadata.get('session-modes'):
    errors.append('Only the default user session is supported; omit session-modes')
with zipfile.ZipFile(bundle) as archive:
    names = set(archive.namelist())
    if names != required | catalogs:
        errors.append(f'Unexpected package contents: {sorted(names ^ (required | catalogs))}')
    if json.loads(archive.read('metadata.json')) != metadata:
        errors.append('Packaged metadata differs from the source metadata')
    if archive.read('COPYING') != (root / 'COPYING').read_bytes():
        errors.append('Missing or incorrect license text')
    for name in sorted(names):
        if name.endswith('.mo'):
            gettext.GNUTranslations(io.BytesIO(archive.read(name)))
        if not name.endswith('.js'):
            continue
        source = archive.read(name).decode('utf-8')
        if 'SPDX-License-Identifier: GPL-3.0-or-later' not in source.splitlines()[0]:
            errors.append(f'{name}: missing license identifier')
        if re.search(r'gi://(?:Gtk|Gdk|Adw)(?:[\x27\"?])', source):
            errors.append(f'{name}: GTK-family imports do not belong in the Shell process')
        if re.search(r'\b(?:eval|run_dispose)\s*\(|new\s+Function\s*\(|Gio\.Subprocess|GLib\.spawn', source):
            errors.append(f'{name}: process execution, dynamic code or forced disposal requires review')
        for relative in re.findall(r"from\s+['\"](\./[^'\"]+)['\"]", source):
            if relative[2:] not in names:
                errors.append(f'{name}: missing module {relative}')
report = {
    'automated_package_checks_passed': not errors,
    'submission_metadata_ready': not blockers,
    'package_sha256': hashlib.sha256(bundle.read_bytes()).hexdigest(),
    'errors': errors, 'release_blockers': blockers, 'files': sorted(names),
    'human_review': 'The maintainer must inspect and understand the code before submitting it.',
    'gnome_review_status': 'Not submitted; this audit does not grant GNOME approval.',
}
(root / 'reports').mkdir(exist_ok=True)
(root / 'reports/release-readiness.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
raise SystemExit(1 if errors or (args.release and blockers) else 0)
