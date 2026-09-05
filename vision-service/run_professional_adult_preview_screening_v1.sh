#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/professionalAdultPreviewScreening.source.test.mjs
node scripts/fetchProfessionalAdultPublicPreviewScreening.js

python3 - <<'PY'
from pathlib import Path
import zipfile

root = Path('.tmp/moderation-research-discovery/professional-adult-public-preview-v1')
preview_dir = root / 'previews'
metadata = root / 'preview-sources.json'
discovery = root / 'asset-candidates.json'
out = root / 'professional-adult-preview-screening-v1.zip'

if not preview_dir.is_dir():
    raise SystemExit('professional adult preview directory missing')
if not metadata.is_file() or not discovery.is_file():
    raise SystemExit('professional adult preview metadata missing')

with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    zf.write(metadata, 'preview-sources.json')
    zf.write(discovery, 'asset-candidates.json')
    for path in sorted(preview_dir.iterdir()):
        if path.is_file():
            zf.write(path, f'previews/{path.name}')

print(f'Professional adult preview ZIP: {out}')
PY
