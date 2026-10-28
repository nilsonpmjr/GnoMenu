#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Replay our own menu fixture in a staged Electron runtime on a private desktop."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import select
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parent.parent


def wait(predicate, message, processes=(), seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        if any(process.poll() is not None for process in processes):
            raise RuntimeError(f'Process exited while waiting for {message}')
        time.sleep(0.1)
    raise TimeoutError(message)


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True, help='An installed Electron ELF; vendor ASARs are never copied')
    parser.add_argument('--backend', choices=['x11', 'wayland'], required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve(strict=True)
    with runtime.open('rb') as stream:
        if stream.read(4) != b'\x7fELF':
            parser.error('--runtime must point to an Electron ELF, not an application launch wrapper')
    if os.environ.get('GNOMENU_ELECTRON_BUS') != '1':
        return subprocess.call(['dbus-run-session', '--', sys.executable, __file__, *sys.argv[1:]],
                               env=dict(os.environ, GNOMENU_ELECTRON_BUS='1'))
    report_dir = ROOT / 'reports/electron-export' / args.backend
    report_dir.mkdir(parents=True, exist_ok=True)
    for name in ['result.json', 'fixture-final.json', 'integration.json', 'integration.json.layouts.json',
                 'integration.json.failure.json', 'integration.json.raw-layout.txt', 'integration.log',
                 'integration.json.panel-failure.json', 'electron-panel.png', 'panel-trace.json',
                 'identity.json', 'identity-withdrawal.json', 'identity.log', 'identity-withdrawal.log']:
        (report_dir / name).unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='gnomenu-electron-') as directory:
        workspace = Path(directory)
        stage = workspace / 'runtime'
        stage.mkdir()
        shutil.copy2(runtime, stage / 'electron')
        # Stage only Electron core files. Never link/copy vendor resources/app.asar,
        # resources/obsidian.asar, unpacked Node addons or application profiles.
        for name in ['icudtl.dat', 'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
                     'snapshot_blob.bin', 'v8_context_snapshot.bin', 'locales', 'libEGL.so', 'libGLESv2.so',
                     'libffmpeg.so', 'libvk_swiftshader.so', 'libvulkan.so.1', 'vk_swiftshader_icd.json']:
            source = runtime.parent / name
            if source.exists():
                (stage / name).symlink_to(source)
        shutil.copytree(ROOT / 'fixtures/electron-menu', stage / 'resources/app')
        private_runtime = workspace / 'sockets'
        private_runtime.mkdir(mode=0o700)
        extensions = workspace / 'data/gnome-shell/extensions'
        shutil.copytree(ROOT / 'tests/electron-observer', extensions / 'gnomenu-electron-observer@nilsonpmjr.local')
        shutil.copy2(ROOT / 'extension/windowSource.js',
                     extensions / 'gnomenu-electron-observer@nilsonpmjr.local/windowSource.js')
        metadata = json.loads((ROOT / 'extension/metadata.json').read_text())
        shutil.copytree(ROOT / 'extension', extensions / metadata['uuid'])
        observation = workspace / 'shell-state.json'
        command = workspace / 'shell-command.json'
        (workspace / 'home').mkdir()
        env = dict(os.environ, HOME=str(workspace / 'home'), XDG_RUNTIME_DIR=str(private_runtime), XDG_DATA_HOME=str(workspace / 'data'),
                   XDG_CONFIG_HOME=str(workspace / 'config'), XDG_CACHE_HOME=str(workspace / 'cache'),
                   XDG_STATE_HOME=str(workspace / 'state'), GSETTINGS_BACKEND='keyfile', GIO_USE_VFS='local',
                   GNOMENU_ELECTRON_OBSERVATION=str(observation), GNOMENU_ELECTRON_WORKSPACE=str(workspace),
                   GNOMENU_ELECTRON_COMMAND=str(command), GNOMENU_UUID=metadata['uuid'],
                   GNOMENU_ELECTRON_REPORT_DIR=str(report_dir),
                   GNOMENU_ELECTRON_BACKEND=args.backend, LIBGL_ALWAYS_SOFTWARE='1', NO_AT_BRIDGE='1')
        for name in ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'LD_PRELOAD', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE']:
            env.pop(name, None)
        # Service activation must inherit the private paths too, rather than
        # the outer environment from before dbus-run-session was launched.
        from gi.repository import Gio, GLib
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        private_keys = ['HOME', 'XDG_RUNTIME_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME',
                        'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'GSETTINGS_BACKEND', 'GIO_USE_VFS']
        bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                      'UpdateActivationEnvironment', GLib.Variant('(a{ss})', ({key: env[key] for key in private_keys},)),
                      GLib.VariantType.new('()'), Gio.DBusCallFlags.NO_AUTO_START, 1500, None)
        for schema, key, value in [
            ('org.gnome.shell', 'enabled-extensions', json.dumps([metadata['uuid'], 'gnomenu-electron-observer@nilsonpmjr.local'])),
            ('org.gnome.shell', 'disable-user-extensions', 'false'),
            ('org.gnome.shell', 'welcome-dialog-last-shown-version', "'50.0'")]:
            subprocess.run(['gsettings', 'set', schema, key, value], env=env, check=True)
        processes = []
        with (report_dir / 'shell.log').open('w') as shell_log, (report_dir / 'app.log').open('w') as app_log:
            try:
                display = 'gnomenu-electron'
                shell = subprocess.Popen(['gnome-shell', '--headless', '--virtual-monitor', '1280x800', '--wayland',
                    '--wayland-display', display, '--mode', 'user'], env=env, stdout=shell_log, stderr=subprocess.STDOUT)
                processes.append(shell)
                ready = wait(lambda: read_json(observation), 'private Shell observer', [shell])
                registrar = subprocess.Popen([sys.executable, str(ROOT / 'broker/appmenu-registrar.py')], env=env,
                    stdout=subprocess.PIPE, stderr=app_log, text=True)
                processes.append(registrar)
                if not select.select([registrar.stdout], [], [], 5)[0]:
                    raise TimeoutError('private registrar startup')
                registration = json.loads(registrar.stdout.readline())
                app_env = dict(env, WAYLAND_DISPLAY=display)
                if args.backend == 'x11':
                    if not ready.get('display') or not ready.get('xauthority'):
                        raise RuntimeError('The private compositor did not publish XWayland credentials')
                    app_env.update(DISPLAY=ready['display'], XAUTHORITY=ready['xauthority'])
                app = subprocess.Popen([str(stage / 'electron'), f'--ozone-platform={args.backend}', '--disable-gpu',
                    '--disable-background-networking', '--disable-component-update', '--disable-dev-shm-usage'],
                    env=app_env, stdout=app_log, stderr=subprocess.STDOUT)
                processes.append(app)
                state = wait(lambda: (value if (value := read_json(workspace / 'electron-state.json')) and
                    len(value['windows']) == 2 and all('nativeHandleHex' in w for w in value['windows']) else None),
                    'two owned Electron fixture windows', [shell, app])
                meta = wait(lambda: (value if (value := read_json(observation)) and len(value['windows']) == 2 else None),
                    'two actual Meta windows', [shell, app])
                assert state['fixturePath'] == 'runtime/resources/app' and state['profilePath'] == 'profile'
                assert all(window['pid'] == state['pid'] and window['title'] == 'GnoMenu Electron Fixture'
                           for window in meta['windows'])
                def menus():
                    return bus.call_sync(registration['owner'], '/com/canonical/AppMenu/Registrar',
                        'com.canonical.AppMenu.Registrar', 'GetMenus', None, GLib.VariantType.new('(a(uso))'),
                        Gio.DBusCallFlags.NO_AUTO_START, 1500, None).unpack()[0]
                records = wait(menus, 'actual Electron menu registrations', [shell, app]) if args.backend == 'x11' else menus()
                integration = None
                native_properties = []
                observation_ms = 0
                if args.backend == 'x11':
                    expected = {window['xid'] for window in state['windows']}
                    def exact_menus():
                        value = menus()
                        return value if {item[0] for item in value} == expected else None
                    records = wait(exact_menus, 'two exact native registrations', [shell, app])
                    identity_path = report_dir / 'identity.json'
                    with (report_dir / 'identity.log').open('w') as identity_log:
                        subprocess.run([sys.executable, str(ROOT / 'tests/x11-identity.py'), registration['owner'],
                            str(identity_path)], env=app_env, check=True, timeout=10,
                            stdout=identity_log, stderr=subprocess.STDOUT)
                    identity = read_json(identity_path)
                    assert {entry['windowId'] for entry in identity['identities']} == expected
                    for window in state['windows']:
                        properties = subprocess.check_output(['xprop', '-id', hex(window['xid']), '_NET_WM_PID'],
                                                             env=app_env, text=True, timeout=5)
                        pid = re.search(r'_NET_WM_PID\(CARDINAL\) = (\d+)', properties)
                        assert pid and int(pid[1]) == state['pid']
                        native_properties.append({'xid': window['xid'], 'pid': int(pid[1])})
                    integration_path = report_dir / 'integration.json'
                    integration_path.unlink(missing_ok=True)
                    check = subprocess.run(['gjs', '-m', str(ROOT / 'tests/electron-integration.js'),
                        str(workspace / 'electron-state.json'), str(integration_path), str(observation), str(command),
                        str(identity_path)],
                        env=app_env, capture_output=True, text=True, timeout=35)
                    (report_dir / 'integration.log').write_text(check.stdout + check.stderr)
                    print(check.stdout, end='', flush=True)
                    if check.returncode:
                        raise RuntimeError(check.stderr)
                    integration = read_json(integration_path)
                    final_windows = read_json(workspace / 'electron-state.json')['windows']
                    closed = next(window['xid'] for window in final_windows if window['closed'])
                    remaining = next(window['xid'] for window in final_windows if not window['closed'])
                    with (report_dir / 'identity-withdrawal.log').open('w') as identity_log:
                        subprocess.run([sys.executable, str(ROOT / 'tests/x11-identity.py'), registration['owner'],
                            str(report_dir / 'identity-withdrawal.json'), '--closed-xid', str(closed),
                            '--remaining-xid', str(remaining), '--exporter-owner', records[0][1]], env=app_env,
                            check=True, timeout=10, stdout=identity_log, stderr=subprocess.STDOUT)
                else:
                    started = time.monotonic()
                    seen = set(tuple(item) for item in records)
                    while time.monotonic() - started < 3:
                        seen.update(tuple(item) for item in menus())
                        time.sleep(0.1)
                    observation_ms = round((time.monotonic() - started) * 1000)
                    records = sorted(seen)
                    assert all('xid' not in window for window in state['windows'])
                result = {'backend': args.backend, 'timestamp_utc': datetime.now(timezone.utc).isoformat(),
                    'runtime_sha256': hashlib.sha256(runtime.read_bytes()).hexdigest(),
                    'staged_sha256': hashlib.sha256((stage / 'electron').read_bytes()).hexdigest(),
                    'fixture': state, 'meta': {'windows': meta['windows']}, 'registrations': records,
                    'x11_properties': native_properties, 'wayland_observation_ms': observation_ms,
                    'registrar_owner': registration['owner'], 'success': True, 'integration': integration,
                    'limits': ['Own fixture in a staged runtime outside Flatpak; no Signal/Obsidian application support is established.',
                               'Meta descriptions and internal IDs are observations, not a stable XID production contract.']}
                assert result['runtime_sha256'] == result['staged_sha256']
                (report_dir / 'result.json').write_text(json.dumps(result, indent=2))
                print(json.dumps(result, indent=2), flush=True)
                return 0
            finally:
                # Main's shutdown handlers can run a nested GLib loop after
                # destroying panel actors. Stop our observer before termination.
                if shell.poll() is None and observation.exists():
                    try:
                        pending = command.with_suffix('.tmp')
                        pending.write_text(json.dumps({'id': 'harness-stop', 'operation': 'stop-observer'}))
                        pending.replace(command)
                        wait(lambda: ((read_json(observation) or {}).get('reply') or {}).get('id') == 'harness-stop',
                             'private observer shutdown', [shell], seconds=3)
                    except (OSError, RuntimeError, TimeoutError):
                        print('Private observer did not acknowledge shutdown', file=sys.stderr)
                final_state = workspace / 'electron-state.json'
                if final_state.exists():
                    shutil.copy2(final_state, report_dir / 'fixture-final.json')
                for process in reversed(processes):
                    if process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=5)
                # The private document portal can mount FUSE under this owned
                # runtime directory. Detach that mount before TemporaryDirectory
                # removes it; never touch the regular session's portal mount.
                document_mount = private_runtime / 'doc'
                if document_mount.is_mount():
                    subprocess.run(['fusermount3', '-u', str(document_mount)], env=env,
                                   check=True, timeout=5, stdout=app_log, stderr=app_log)


if __name__ == '__main__':
    raise SystemExit(main())
