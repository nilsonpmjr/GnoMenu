#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Build a deterministic runtime-only extension ZIP, including its license."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
build = root / 'build'
build.mkdir(exist_ok=True)
subprocess.run([sys.executable, str(root / 'tools/build-translations.py')], check=True)
metadata = json.loads((root / 'extension/metadata.json').read_text())
bundle = build / f'{metadata["uuid"]}.shell-extension.zip'
runtime = ('metadata.json', 'extension.js', 'gmenuSource.js', 'windowSource.js',
           'actionMenus.js', 'stylesheet.css')
sources = {name: (root / 'extension' / name).read_bytes() for name in runtime}
sources['COPYING'] = (root / 'COPYING').read_bytes()
for catalog in sorted((root / 'po').glob('*.po')):
    name = f'locale/{catalog.stem}/LC_MESSAGES/gnomenu.mo'
    sources[name] = (root / 'extension' / name).read_bytes()
epoch = max(315532800, int(os.environ.get('SOURCE_DATE_EPOCH', '315532800')))
timestamp = datetime.fromtimestamp(epoch, timezone.utc).timetuple()[:6]
with zipfile.ZipFile(bundle, 'w') as archive:
    for name, data in sorted(sources.items()):
        entry = zipfile.ZipInfo(name, date_time=timestamp)
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(bundle) as archive:
    if set(archive.namelist()) != set(sources):
        raise RuntimeError(f'Unexpected bundle contents: {archive.namelist()}')
    for name, data in sources.items():
        if archive.read(name) != data:
            raise RuntimeError(f'Packaged file differs from source: {name}')
digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
bundle.with_suffix(bundle.suffix + '.sha256').write_text(f'{digest}  {bundle.name}\n')
print(bundle)
print(f'SHA256 {digest}')
