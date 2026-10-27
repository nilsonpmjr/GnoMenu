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
(root / 'reports').mkdir(exist_ok=True)
os.environ['GIO_USE_VFS'] = 'local'
results = {}
probe = subprocess.run([sys.executable, str(root / 'tests/probe-session-test.py')],
                       capture_output=True, text=True, check=True)
print(probe.stdout, end='', flush=True)
results['probe'] = {'success': True,
                    'passed': [line[6:] for line in probe.stdout.splitlines() if line.startswith('PASS: ')]}
layout = subprocess.run(['gjs', '-m', str(root / 'tests/files-layout.js')],
                        capture_output=True, text=True, check=True)
print(layout.stdout, end='', flush=True)
results['files_layout'] = {'success': True,
                           'passed': [line[6:] for line in layout.stdout.splitlines() if line.startswith('PASS: ')]}


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
        if transport == 'gmenu':
            diagnostic = subprocess.run([sys.executable, str(root / 'tools/probe-session.py'),
                                         '--name', information['owner']], timeout=15,
                                        env=dict(os.environ, PATH='/gnomenu-probe-no-optional-tools'),
                                        capture_output=True, text=True, check=True)
            probe_report = json.loads(diagnostic.stdout)
            assert probe_report['gnome_shell'] is None and probe_report['gnome_shell_query_error']
            observed = probe_report['applications'][0]
            assert observed['owner'] == information['owner']
            assert observed['status'] == 'gmenu-interface-observed'
        result = subprocess.run(['gjs', '-m', str(root / f'tests/{transport}-integration.js'),
                                 information['owner'], *arguments], timeout=35, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        print(result.stdout, end='', flush=True)
        results[transport] = {'success': result.returncode == 0,
                              'passed': [line[6:] for line in result.stdout.splitlines()
                                         if line.startswith('PASS: ')]}
        if result.returncode:
            sys.exit(result.returncode)
        if transport == 'gmenu':
            message = 'Read-only diagnostic finds pinned GMenu exports even when optional desktop tools are absent'
            results[transport]['passed'].append(message)
            print(f'PASS: {message}', flush=True)
    finally:
        if exporter.poll() is None:
            exporter.terminate()
        exporter.wait(timeout=5)
        if registrar:
            if registrar.poll() is None:
                registrar.terminate()
            registrar.wait(timeout=5)
(root / 'reports/integration.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
