#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Open the global-menu prototype in an isolated GNOME development window."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
raise SystemExit(subprocess.call([sys.executable, str(root / 'tests/run-shell.py'),
                                 '--interactive', *sys.argv[1:]]))
