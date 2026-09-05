#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/publicFhgPreviewScreening.source.test.mjs
node scripts/fetchPublicFhgPreviewScreening.js

python3 - <<'PY'
from pathlib import Path
import zipfile

root = Path('.tmp/moderation-research-discovery/public-fhg-v1')
preview_dir = root / 'previews'
metadata = root / 'preview-sources.json'
discovery = root / 'gallery-assets.json'
out = root / 'public-fhg-preview-screening-v1.zip'

if not preview_dir.is_dir():
    raise SystemExit('public FHG preview directory missing')
if not metadata.is_file() or not discovery.is_file():
    raise SystemExit('public FHG preview metadata missing')

with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.write(metadata, 'preview-sources.json')
    zf.write(discovery, 'gallery-assets.json')
    for path in sorted(preview_dir.iterdir()):
        if path.is_file():
            zf.write(path, f'previews/{path.name}')

print(f'Public FHG preview ZIP: {out}')
PY
