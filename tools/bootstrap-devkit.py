#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Extract a matching, signature-verified Fedora Mutter viewer locally."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
deps = root / 'build/deps'
deps.mkdir(parents=True, exist_ok=True)
version = subprocess.check_output(['rpm', '-q', '--qf', '%{VERSION}-%{RELEASE}.%{ARCH}',
                                   'mutter'], text=True).strip()
package = f'mutter-devkit-{version}'
subprocess.run(['dnf', '--repo=fedora', '--repo=updates', 'download', package,
                '--destdir', str(deps)], check=True)
rpm = deps / f'{package}.rpm'
subprocess.run(['rpmkeys', '--checksig', str(rpm)], check=True)
target = deps / 'devkit'
target.mkdir(exist_ok=True)
with subprocess.Popen(['rpm2cpio', str(rpm)], stdout=subprocess.PIPE) as archive:
    subprocess.run(['cpio', '-idm', '--quiet', '--no-absolute-filenames'],
                    stdin=archive.stdout, cwd=target, check=True)
    archive.stdout.close()
    if archive.wait() != 0:
        raise RuntimeError('rpm2cpio failed')
subprocess.run(['glib-compile-schemas', str(target / 'usr/share/glib-2.0/schemas')], check=True)
print(f'Viewer prepared at {target}; no packages were installed on the host.')
