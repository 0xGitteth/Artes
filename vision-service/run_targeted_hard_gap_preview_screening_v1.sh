#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/fetchTargetedHardGapPreviewScreening.js

python3 - <<'PY'
from pathlib import Path
import zipfile

root = Path('.tmp/moderation-research-discovery/hard-gap-targeted-v1')
preview_dir = root / 'previews'
metadata = root / 'preview-sources.json'
discovery = root / 'flickr-targeted-candidates.json'
out = root / 'targeted-hard-gap-preview-screening-v1.zip'

if not preview_dir.is_dir():
    raise SystemExit('targeted preview directory missing')
if not metadata.is_file() or not discovery.is_file():
    raise SystemExit('targeted preview metadata missing')

with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.write(metadata, 'preview-sources.json')
    zf.write(discovery, 'flickr-targeted-candidates.json')
    for path in sorted(preview_dir.iterdir()):
        if path.is_file():
            zf.write(path, f'previews/{path.name}')

print(f'Targeted hard-gap preview ZIP: {out}')
PY
