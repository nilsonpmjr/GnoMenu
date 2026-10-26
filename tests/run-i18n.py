#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Exercise real gettext and GMenu imports in separate locale-inheriting processes."""
import json
import os
from pathlib import Path
import select
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
subprocess.run([sys.executable, str(root / 'tools/build-translations.py')], check=True)
environment = dict(os.environ, GIO_USE_VFS='local')
exporter = subprocess.Popen([sys.executable, str(root / 'fixtures/gmenu-service.py')],
                            env=environment, stdout=subprocess.PIPE, text=True)
cases = [
    ('pt_BR', {'LC_ALL': 'pt_BR.UTF-8'}, 'Configurações…', 'Sobre…', 'Sair'),
    ('pt_PT', {'LC_ALL': 'pt_PT.UTF-8'}, 'Definições…', 'Sobre…', 'Sair'),
    ('es_MX', {'LC_ALL': 'es_MX.UTF-8'}, 'Preferencias…', 'Acerca de…', 'Salir'),
    ('fr_CA', {'LC_ALL': 'fr_CA.UTF-8'}, 'Préférences…', 'À propos…', 'Quitter'),
    ('de_DE', {'LC_ALL': 'de_DE.UTF-8'}, 'Einstellungen…', 'Info…', 'Beenden'),
    ('it_IT', {'LC_ALL': 'it_IT.UTF-8'}, 'Preferenze…', 'Informazioni…', 'Esci'),
    ('en_US', {'LC_ALL': 'en_US.UTF-8'}, 'Preferences…', 'About…', 'Quit'),
    ('unsupported_ja', {'LC_ALL': 'ja_JP.UTF-8'}, 'Preferences…', 'About…', 'Quit'),
    ('messages_override', {'LANG': 'de_DE.UTF-8', 'LC_MESSAGES': 'es_ES.UTF-8'},
     'Preferencias…', 'Acerca de…', 'Salir'),
    ('language_priority', {'LC_ALL': 'en_US.UTF-8', 'LANGUAGE': 'xx:fr:es'},
     'Préférences…', 'À propos…', 'Quitter'),
]
results = []
try:
    if not select.select([exporter.stdout], [], [], 5)[0]:
        raise TimeoutError('GMenu exporter did not become ready')
    owner = json.loads(exporter.stdout.readline())['owner']
    for name, locale, preferences, about, quit_text in cases:
        env = dict(environment)
        for variable in ('LANGUAGE', 'LC_ALL', 'LC_MESSAGES'):
            env.pop(variable, None)
        env.update(locale)
        expected = {'Preferences…': preferences, 'About…': about, 'Quit': quit_text}
        result = subprocess.run(['gjs', '-m', str(root / 'tests/i18n-integration.js'), owner,
                                 str(root / 'extension/locale'), json.dumps(expected)],
                                env=env, capture_output=True, text=True, timeout=12)
        if result.returncode:
            print(result.stdout, end='')
            print(result.stderr, end='', file=sys.stderr)
            raise RuntimeError(f'Locale case failed: {name}')
        details = json.loads(result.stdout)
        results.append({'case': name, 'success': True, **details})
        print(f'PASS: locale {name} translates fallback labels and preserves native menus', flush=True)
finally:
    exporter.terminate()
    exporter.wait(timeout=5)
(root / 'reports/i18n.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
