#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Launch an isolated headless GNOME Shell, fixture and integration driver."""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parent.parent
UUID = json.loads((ROOT / 'extension/metadata.json').read_text())['uuid']
DRIVER = 'gnomenu-test@nilsonpmjr.local'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--interactive', action='store_true', help='Open a nested development desktop')
    parser.add_argument('--duration', type=float, help='Close an interactive smoke session after N seconds')
    parser.add_argument('--locale', help='Test/demo only: override locale, e.g. pt_BR.UTF-8; default inherits session')
    parser.add_argument('--real-apps', action='store_true', help='Use real Nautilus and Ptyxis in the private session')
    parser.add_argument('--bundle', type=Path, help='Test this built ZIP instead of the source directory')
    args = parser.parse_args()
    if args.duration is not None and (not args.interactive or args.duration <= 0):
        parser.error('--duration requires --interactive and a positive number')
    if args.locale and not re.fullmatch(r'[a-z]{2,3}_[A-Z]{2}\.UTF-8', args.locale):
        parser.error('--locale must use the form xx_YY.UTF-8')
    viewer = None
    local_viewer = ROOT / 'build/deps/devkit/usr/libexec/mutter-devkit'
    if args.interactive:
        viewer = Path('/usr/libexec/mutter-devkit')
        if not viewer.is_file():
            viewer = local_viewer
        if not viewer.is_file():
            raise RuntimeError('mutter-devkit is missing. On Fedora/Bazzite, run python3 tools/bootstrap-devkit.py')
    report_dir = ROOT / ('reports/demo-session' if args.interactive else 'reports/dev-session')
    if args.real_apps:
        report_dir = report_dir / 'real-apps'
    if args.locale:
        report_dir = report_dir / 'locales' / args.locale
    report_dir.mkdir(parents=True, exist_ok=True)
    if os.environ.get('GNOMENU_PRIVATE_BUS') != '1':
        subprocess.run([sys.executable, str(ROOT / 'tools/build-translations.py')], check=True)
        with (report_dir / 'bus.log').open('w') as bus_log:
            return subprocess.call(['dbus-run-session', '--', 'env',
                                    'GNOMENU_PRIVATE_BUS=1', sys.executable,
                                    __file__, *sys.argv[1:]], stderr=bus_log)
    result_path = report_dir / 'shell-result.json'
    result_path.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='gnomenu-') as directory:
        workspace = Path(directory)
        data = workspace / 'data'
        applications = data / 'applications'
        applications.mkdir(parents=True)
        for app_id, name, fixture in [('org.example.GnoMenuDemo', 'GnoMenu Demo', 'gtk-demo.py'),
                                      ('org.example.GnoMenuNoMenu', 'GnoMenu sem menu', 'gtk-no-menu.py')]:
            script = str(ROOT / 'fixtures' / fixture).replace('\\', '\\\\').replace('"', '\\"')
            (applications / f'{app_id}.desktop').write_text(
                f'[Desktop Entry]\nType=Application\nName={name}\nExec=python3 "{script}"\nNoDisplay=true\n')
        extensions = data / 'gnome-shell/extensions'
        if args.bundle:
            with zipfile.ZipFile(args.bundle.resolve()) as archive:
                packed_metadata = json.loads(archive.read('metadata.json'))
                if packed_metadata['uuid'] != UUID:
                    raise RuntimeError('Bundle UUID differs from the project metadata')
                archive.extractall(extensions / UUID)
        else:
            shutil.copytree(ROOT / 'extension', extensions / UUID)
        if not args.interactive:
            shutil.copytree(ROOT / 'tests/shell-driver', extensions / DRIVER)
        env = dict(os.environ, XDG_DATA_HOME=str(data),
                   XDG_CONFIG_HOME=str(workspace / 'config'),
                   XDG_CACHE_HOME=str(workspace / 'cache'),
                   XDG_STATE_HOME=str(workspace / 'state'),
                   GSETTINGS_BACKEND='keyfile', GIO_USE_VFS='local',
                   GNOMENU_UUID=UUID,
                   GNOMENU_REPORT=str(result_path),
                   LIBGL_ALWAYS_SOFTWARE='1', NO_AT_BRIDGE='1', GTK_A11Y='none')
        if args.real_apps:
            env['GNOMENU_REAL_APPS'] = '1'
            # A private accessibility bus observes only these test applications.
            # Do not attach the observer to the user's desktop accessibility bus.
            accessibility_config = workspace / 'accessibility.conf'
            accessibility_config.write_text('''<busconfig>
              <type>accessibility</type><listen>unix:tmpdir=/tmp</listen><auth>EXTERNAL</auth>
              <servicedir>/usr/share/dbus-1/accessibility-services</servicedir>
              <policy context="default"><allow user="*"/><allow own="*"/>
                <allow send_destination="*"/><allow receive_sender="*"/></policy>
            </busconfig>''')
        if args.locale:
            env.update(LANG=args.locale, LC_ALL=args.locale)
            env.pop('LANGUAGE', None)
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'enabled-extensions',
                        json.dumps([UUID] if args.interactive else [UUID, DRIVER])], env=env, check=True)
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'disable-user-extensions',
                        'false'], env=env, check=True)
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'welcome-dialog-last-shown-version',
                        "'50.0'"], env=env, check=True)
        for key, value in [('picture-uri', "''"), ('picture-uri-dark', "''"),
                           ('primary-color', "'#20242b'"), ('color-shading-type', "'solid'")]:
            subprocess.run(['gsettings', 'set', 'org.gnome.desktop.background', key, value], env=env, check=True)
        display = f'gnomenu-{os.getpid()}'
        with (report_dir / 'shell.log').open('w') as shell_log, \
                (report_dir / 'gtk-demo.log').open('w') as app_log:
            accessibility = None
            accessibility_registry = None
            if args.real_apps:
                accessibility = subprocess.Popen(['dbus-daemon', '--nofork',
                    f'--config-file={accessibility_config}', '--print-address=1'],
                    stdout=subprocess.PIPE, stderr=app_log, text=True, env=env)
                env['AT_SPI_BUS_ADDRESS'] = accessibility.stdout.readline().strip()
                if not env['AT_SPI_BUS_ADDRESS']:
                    raise RuntimeError('Private accessibility bus failed to start')
                env['GTK_A11Y'] = 'atspi'
                env.pop('NO_AT_BRIDGE', None)
                env['GNOMENU_OBSERVER'] = str(ROOT / 'tests/observe-real-window.py')
                accessibility_registry = subprocess.Popen(['/usr/libexec/at-spi2-registryd'],
                    env=env, stdout=app_log, stderr=subprocess.STDOUT)
            backend = (['--headless', '--devkit'] if args.interactive else
                       ['--headless', '--virtual-monitor', '1280x800'])
            shell = subprocess.Popen(['gnome-shell', *backend, '--wayland', '--no-x11',
                                      '--wayland-display', display, '--mode', 'user'],
                                     env=env, stdout=shell_log, stderr=subprocess.STDOUT)
            app = None
            unsupported_app = None
            viewer_process = None
            extra_apps = []
            try:
                deadline = time.monotonic() + 30
                socket = Path(env['XDG_RUNTIME_DIR']) / display
                while not socket.exists():
                    if shell.poll() is not None:
                        raise RuntimeError('Shell exited before creating its Wayland display')
                    if time.monotonic() > deadline:
                        raise TimeoutError('Wayland display startup timeout')
                    time.sleep(0.1)
                if args.interactive:
                    viewer_env = dict(env)
                    if viewer == local_viewer:
                        viewer_env['GSETTINGS_SCHEMA_DIR'] = str(viewer.parent.parent / 'share/glib-2.0/schemas')
                        viewer_env['XDG_DATA_DIRS'] = str(viewer.parent.parent / 'share') + ':' + env.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share')
                    # The viewer is a client of the OUTER desktop, using this private bus.
                    viewer_process = subprocess.Popen([str(viewer)], env=viewer_env,
                                                      stdout=shell_log, stderr=subprocess.STDOUT)
                app_env = dict(env, WAYLAND_DISPLAY=display, GDK_BACKEND='wayland')
                if args.real_apps:
                    folders = [workspace / 'GnoMenu test folder A', workspace / 'GnoMenu test folder B']
                    for folder in folders:
                        folder.mkdir()
                    app = subprocess.Popen(['nautilus', '--new-window', folders[0].as_uri()],
                                           env=app_env, stdout=app_log, stderr=subprocess.STDOUT)
                    extra_apps.append(subprocess.Popen(['nautilus', '--new-window', folders[1].as_uri()],
                                                       env=app_env, stdout=app_log, stderr=subprocess.STDOUT))
                    # Both terminal windows run only sleep, avoiding shell startup files.
                    unsupported_app = subprocess.Popen(['ptyxis', '--', '/usr/bin/sleep', '3600'],
                                                       env=app_env, stdout=app_log, stderr=subprocess.STDOUT)
                    extra_apps.append(subprocess.Popen(['ptyxis', '--', '/usr/bin/sleep', '3600'],
                                                       env=app_env, stdout=app_log, stderr=subprocess.STDOUT))
                else:
                    app = subprocess.Popen([sys.executable, str(ROOT / 'fixtures/gtk-demo.py')],
                                           env=app_env, stdout=app_log, stderr=subprocess.STDOUT)
                    unsupported_app = subprocess.Popen([sys.executable, str(ROOT / 'fixtures/gtk-no-menu.py')],
                                                       env=app_env, stdout=app_log, stderr=subprocess.STDOUT)
                if args.interactive:
                    print('Private GNOME development session started. Close its window to exit.',
                          flush=True)
                    try:
                        return viewer_process.wait(timeout=args.duration)
                    except subprocess.TimeoutExpired:
                        return 0
                deadline = time.monotonic() + 65
                while not result_path.exists():
                    if shell.poll() is not None:
                        raise RuntimeError('Shell exited during integration checks')
                    if time.monotonic() > deadline:
                        raise TimeoutError('Shell integration timeout')
                    time.sleep(0.2)
                result = json.loads(result_path.read_text())
                log = (report_dir / 'shell.log').read_text()
                if 'Gjs-CRITICAL' in log or 'GNOME Shell-CRITICAL' in log or 'JS ERROR' in log:
                    result['success'] = False
                    result['error'] = 'Critical GJS errors were logged; inspect shell.log'
                    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 0 if result['success'] else 1
            finally:
                for process in (*extra_apps, unsupported_app, app, viewer_process, shell,
                                accessibility_registry, accessibility):
                    if process and process.poll() is None:
                        process.terminate()
                        try:
                            process.wait(timeout=8)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait(timeout=3)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        print(f'See {ROOT / "reports/dev-session/shell.log"}', file=sys.stderr)
        raise SystemExit(1)
