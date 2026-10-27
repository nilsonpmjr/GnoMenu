#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Extract GnoMenu messages or compile gettext catalogs for local use/packaging."""
import argparse
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--update-template', action='store_true', help='Regenerate po/gnomenu.pot')
args = parser.parse_args()
if args.update_template:
    subprocess.run(['xgettext', '--language=JavaScript', '--from-code=UTF-8',
                    '--keyword=_', '--package-name=GnoMenu', '--package-version=0.1',
                    '--copyright-holder=GnoMenu contributors', '--no-wrap',
                    '--output=po/gnomenu.pot', 'extension/extension.js',
                    'extension/gmenuSource.js', 'extension/actionMenus.js',
                    'extension/filesDesktopSource.js'], cwd=root, check=True)
catalogs = sorted((root / 'po').glob('*.po'))
if not catalogs:
    raise RuntimeError('No gettext catalogs found')
for catalog in catalogs:
    output = root / 'extension/locale' / catalog.stem / 'LC_MESSAGES/gnomenu.mo'
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['msgfmt', '--check', '--check-format', '-o', str(output), str(catalog)], check=True)
print(f'GnoMenu: {len(catalogs)} translation catalogs compiled.')
