#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Verify Electron protocol behavior with our fixture, never a user's application."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    args = parser.parse_args()
    directory = ROOT / 'reports/electron-export'
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / 'verification.json'
    output.unlink(missing_ok=True)
    cases = {}
    for backend in ['x11', 'wayland']:
        with (directory / f'{backend}-run.log').open('w') as log:
            subprocess.run([sys.executable, str(ROOT / 'tests/run-electron.py'),
                            '--runtime', str(args.runtime.resolve()), '--backend', backend],
                           cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
        result = json.loads((directory / backend / 'result.json').read_text())
        assert result['success'] and result['runtime_sha256'] == result['staged_sha256']
        assert result['fixture']['fixturePath'] == 'runtime/resources/app'
        assert result['fixture']['profilePath'] == 'profile'
        expected_type = 1 if backend == 'x11' else 0  # Meta.WindowClientType on GNOME 50.
        assert all(window['clientType'] == expected_type for window in result['meta']['windows'])
        if backend == 'x11':
            assert result['integration']['success']
            assert result['integration']['observations']['association']['success']
            result['passed'] = [line[6:] for line in (directory / backend / 'integration.log').read_text().splitlines()
                                if line.startswith('PASS: ')]
        else:
            assert result['wayland_observation_ms'] >= 3000
            assert all('xid' not in window for window in result['fixture']['windows'])
            result['passed'] = [
                'Two native Wayland fixture windows are observed without coercing opaque native handles into XIDs',
                'Registrar declarations are recorded over a bounded native Wayland observation interval',
            ]
        cases[backend] = result
        print(f"{backend}: {len(result['passed'])} checks; {len(result['registrations'])} observed registrations", flush=True)
    assert len({case['runtime_sha256'] for case in cases.values()}) == 1, 'Backend comparison requires the same runtime bytes'
    files = ['fixtures/electron-menu/main.cjs', 'fixtures/electron-menu/package.json',
             'tests/electron-observer/extension.js', 'tests/electron-observer/metadata.json',
             'tests/electron-integration.js', 'tests/electron-window-association.js',
             'extension/windowSource.js', 'extension/gmenuSource.js', 'extension/actionMenus.js',
             'tests/run-electron.py', 'tools/verify-electron.py',
             'extension/appmenuDiscovery.js', 'extension/dbusmenuSource.js', 'broker/appmenu-registrar.py']
    report = {'success': True, 'timestamp_utc': datetime.now(timezone.utc).isoformat(), 'cases': cases,
              'source_sha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files},
              'support_status': 'Controlled fixture only; no Signal/Obsidian application or Flatpak integration is established',
              'limits': ['A single-command X11 property association probe passes; automatic third-party association, full menu bridging and panel integration remain pending.',
                         'Checkbox callback state and server-advertised state are recorded independently; passing the replay does not certify checked-state synchronization.',
                         'Wayland absence is bounded to the recorded runtime, fixture and interval; it is not a claim about every Electron app.',
                         'The staged core ELF is byte-identical; vendor application ASARs and unpacked addons are excluded. Runtime execution occurs outside Flatpak.']}
    output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Electron replay: {sum(len(case["passed"]) for case in cases.values())} check groups passed. Report: {output}', flush=True)


if __name__ == '__main__':
    main()
