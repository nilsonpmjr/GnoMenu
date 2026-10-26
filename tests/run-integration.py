#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Run inside dbus-run-session; never touches the user's application bus."""
import json
import os
import select
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
os.environ['GIO_USE_VFS'] = 'local'
results = {}


def ready(process, name):
    if not select.select([process.stdout], [], [], 5)[0]:
        raise TimeoutError(f'{name} did not become ready')
    return json.loads(process.stdout.readline())


for transport in ('gmenu', 'dbusmenu', 'registrar', 'discovery'):
    registrar = None
    environment = dict(os.environ)
    if transport == 'discovery':
        registrar = subprocess.Popen([sys.executable, str(root / 'broker/appmenu-registrar.py')],
                                     stdout=subprocess.PIPE, text=True)
        ready(registrar, 'discovery registrar')
        environment['GNOMENU_FIXTURE_REGISTER'] = '1'
    service = ('broker/appmenu-registrar.py' if transport == 'registrar'
               else 'fixtures/dbusmenu-service.py' if transport == 'discovery'
               else f'fixtures/{transport}-service.py')
    exporter = subprocess.Popen([sys.executable, str(root / service)],
                                env=environment, stdout=subprocess.PIPE, text=True)
    try:
        information = ready(exporter, transport)
        arguments = [str(registrar.pid)] if registrar else []
        result = subprocess.run(['gjs', '-m', str(root / f'tests/{transport}-integration.js'),
                                 information['owner'], *arguments], timeout=35, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        print(result.stdout, end='', flush=True)
        results[transport] = {'success': result.returncode == 0,
                              'passed': [line[6:] for line in result.stdout.splitlines()
                                         if line.startswith('PASS: ')]}
        if result.returncode:
            sys.exit(result.returncode)
    finally:
        if exporter.poll() is None:
            exporter.terminate()
        exporter.wait(timeout=5)
        if registrar:
            if registrar.poll() is None:
                registrar.terminate()
            registrar.wait(timeout=5)
(root / 'reports/integration.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
