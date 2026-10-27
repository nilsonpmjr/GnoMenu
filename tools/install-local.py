#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Install the tested GnoMenu bundle for this user and enable it for the next session."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio

root = Path(__file__).resolve().parent.parent
uuid = json.loads((root / 'extension/metadata.json').read_text())['uuid']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--no-build', action='store_true', help='Install the existing verified bundle without rebuilding')
args = parser.parse_args()
if not args.no_build:
    subprocess.run([sys.executable, str(root / 'tools/package.py')], check=True)
bundle = root / f'build/{uuid}.shell-extension.zip'
subprocess.run(['gnome-extensions', 'install', '--force', str(bundle)], check=True)
settings = Gio.Settings.new('org.gnome.shell')
enabled = settings.get_strv('enabled-extensions')
disabled = settings.get_strv('disabled-extensions')
legacy = 'gnomenu@nilsonpmjr.local'
if uuid == 'gnomenu@nilsonpmjr.github.io' and legacy in enabled:
    enabled = [item for item in enabled if item != legacy]
    if legacy not in disabled:
        disabled.append(legacy)
    if not settings.set_strv('disabled-extensions', disabled):
        raise RuntimeError('Could not disable the older GnoMenu development installation')
    print('The older GnoMenu development UUID is disabled; its files are retained.')
if uuid not in enabled:
    enabled.append(uuid)
if not settings.set_strv('enabled-extensions', enabled):
    raise RuntimeError('Could not enable GnoMenu in the user settings')
if uuid in disabled:
    if not settings.set_strv('disabled-extensions', [item for item in disabled if item != uuid]):
        raise RuntimeError('Could not remove the previous GnoMenu disable entry')
Gio.Settings.sync()
print('GnoMenu is installed for this user and enabled for the next GNOME session.')
print('Log out and back in to load a newly installed extension. This tool does not end your session.')
if settings.get_boolean('disable-user-extensions'):
    print('User extensions are globally disabled; that preference has been preserved.')
