#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsSceneDepthPreviews.source.test.mjs
node scripts/fetchAdultLabsSceneDepthPreviews.js

node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const path = '.tmp/moderation-research-discovery/professional-adult-b2b-public-catalog-v1/adultlabs-scene-depth-preview-screening.json';
const result = JSON.parse(await readFile(path, 'utf8'));
if (result.fetchedCount !== 63 || result.failedCount !== 0 || result.uniquePoolCount !== 21) {
  throw new Error(`adultlabs_scene_depth_screening_incomplete:fetched=${result.fetchedCount},failed=${result.failedCount},pools=${result.uniquePoolCount}`);
}
NODE

python3 - <<'PY'
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path('.tmp/moderation-research-discovery/professional-adult-b2b-public-catalog-v1')
preview_dir = root / 'adultlabs-scene-depth-previews'
manifest = root / 'adultlabs-scene-depth-preview-screening.json'
out = root / 'adultlabs-scene-depth-preview-review-batch.zip'

with ZipFile(out, 'w', compression=ZIP_DEFLATED) as zf:
    zf.write(manifest, arcname='adultlabs-scene-depth-preview-screening.json')
    for file in sorted(preview_dir.iterdir()):
        if file.is_file():
            zf.write(file, arcname=f'previews/{file.name}')

print(f'Review ZIP: {out}')
PY

printf '%s\n' 'AdultLabs scene-depth preview screening prepared locally.'
printf '%s\n' 'The ZIP is for assistant/human visual screening only; records remain researchOnly and are not training-ready or production-eligible.'
