#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Open the isolated Electron global-menu demo in a Mutter development window."""
import argparse
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runtime', type=Path,
    default=Path('/var/lib/flatpak/app/md.obsidian.Obsidian/current/active/files/obsidian'),
    help='Electron core ELF; defaults to the installed Obsidian core, without its application code')
parser.add_argument('--duration', type=float, help='Smoke test only: close after N seconds')
args = parser.parse_args()
command = [sys.executable, str(root / 'tests/run-electron.py'), '--interactive', '--backend', 'x11',
           '--runtime', str(args.runtime)]
if args.duration is not None:
    command += ['--duration', str(args.duration)]
raise SystemExit(subprocess.call(command, cwd=root))
