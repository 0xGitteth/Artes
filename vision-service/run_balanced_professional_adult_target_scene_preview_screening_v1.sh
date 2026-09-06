#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/balancedProfessionalAdultTargetScenePreviews.source.test.mjs
node scripts/fetchBalancedProfessionalAdultTargetScenePreviews.js

node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const path = '.tmp/moderation-research-discovery/professional-adult-b2b-public-catalog-v1/balanced-target-scene-preview-screening.json';
const result = JSON.parse(await readFile(path, 'utf8'));
if (result.fetchedCount !== 78 || result.failedCount !== 0 || result.uniquePoolCount !== 26) {
  throw new Error(`balanced_target_scene_screening_incomplete:fetched=${result.fetchedCount},failed=${result.failedCount},pools=${result.uniquePoolCount}`);
}
NODE

python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path('.tmp/moderation-research-discovery/professional-adult-b2b-public-catalog-v1')
preview_dir = root / 'balanced-target-scene-previews'
manifest = root / 'balanced-target-scene-preview-screening.json'
out = root / 'balanced-target-scene-preview-review-batch.zip'

with ZipFile(out, 'w', compression=ZIP_DEFLATED) as zf:
    zf.write(manifest, arcname='balanced-target-scene-preview-screening.json')
    for file in sorted(preview_dir.iterdir()):
        if file.is_file():
            zf.write(file, arcname=f'previews/{file.name}')

print(f'Review ZIP: {out}')
PY

printf '%s\n' 'Balanced professional adult target-scene preview screening prepared locally.'
printf '%s\n' 'The ZIP is for human visual screening only; records remain researchOnly and are not training-ready or production-eligible.'
