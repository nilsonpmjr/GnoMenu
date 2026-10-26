#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 GnoMenu contributors
"""Set the real public project URL and permanent identity before first submission."""
import argparse
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('repository', help='Public GitHub repository URL')
parser.add_argument('--uuid', required=True, help='Permanent extension UUID in a namespace you control')
parser.add_argument('--name', help='Public display name; omit to retain the current name')
args = parser.parse_args()
url = args.repository.rstrip('/').removesuffix('.git')
if not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', url):
    parser.error('Use an HTTPS GitHub repository URL without query parameters')
if not re.fullmatch(r'[A-Za-z0-9._-]+@[A-Za-z0-9._-]+', args.uuid) or args.uuid.endswith('.local'):
    parser.error('Choose a permanent UUID, not the development .local namespace')
if args.name and (not args.name.strip() or '\n' in args.name):
    parser.error('Use a nonempty single-line display name')
path = root / 'extension/metadata.json'
metadata = json.loads(path.read_text())
metadata['url'] = url
metadata['uuid'] = args.uuid
if args.name:
    metadata['name'] = args.name.strip()
path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + '\n')
(root / 'docs/PROJECT.md').write_text(
    f'# Project links\n\nRepository: {url}\n\nIssues: {url}/issues\n\n'
    f'Extension UUID: `{args.uuid}`\n\nDisplay name: {metadata["name"]}\n')
print('Project metadata updated. Rebuild and test before submitting.')
print('A changed UUID is a separate extension: disable the development installation before installing it.')
