#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Build the experimental GTK4 exporter without installing or preloading it."""
import argparse
from pathlib import Path
import shlex
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container', action='store_true', help='Build with Fedora GTK development packages in Podman')
args = parser.parse_args()
(root / 'build').mkdir(exist_ok=True)
command = ['cc', '-std=c11', '-O2', '-g', '-fPIC', '-shared', '-Wall', '-Wextra', '-Werror',
           'native-exporter/gtk4-exporter.c', '-o', 'build/libgnomenu-gtk4.so']
if args.container:
    image = 'localhost/gnomenu-exporter-build'
    subprocess.run(['podman', 'build', '--tag', image, '--file', 'native-exporter/Containerfile',
                    'native-exporter'], cwd=root, check=True)
    compile_script = shlex.join(command) + ' $(pkg-config --cflags --libs gtk4) -ldl'
    subprocess.run(['podman', 'run', '--rm', '--security-opt', 'label=disable',
                    '--volume', f'{root}:/src:rw', '--workdir', '/src', image,
                    '/bin/sh', '-c', 'exec ' + compile_script], cwd=root, check=True)
else:
    flags = subprocess.run(['pkg-config', '--cflags', '--libs', 'gtk4'], capture_output=True, text=True)
    if flags.returncode:
        parser.error('GTK4 development headers are missing; install them or use --container')
    subprocess.run([*command, *shlex.split(flags.stdout), '-ldl'], cwd=root, check=True)
print(root / 'build/libgnomenu-gtk4.so')
