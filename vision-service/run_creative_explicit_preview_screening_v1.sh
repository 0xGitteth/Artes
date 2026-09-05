#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/fetchCreativeExplicitPreviewScreening.js

python3 - <<'PY'
from pathlib import Path
import zipfile

root = Path('.tmp/moderation-research-discovery/creative-explicit-v1')
preview_dir = root / 'previews'
metadata = root / 'preview-sources.json'
shortlist = root / 'flickr-metadata-shortlist.json'
out = root / 'creative-explicit-preview-screening-v1.zip'

if not preview_dir.is_dir():
    raise SystemExit('preview directory missing')
if not metadata.is_file() or not shortlist.is_file():
    raise SystemExit('preview metadata missing')

with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.write(metadata, 'preview-sources.json')
    zf.write(shortlist, 'flickr-metadata-shortlist.json')
    for path in sorted(preview_dir.iterdir()):
        if path.is_file():
            zf.write(path, f'previews/{path.name}')

print(f'Preview screening ZIP: {out}')
PY
