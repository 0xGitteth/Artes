#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsSceneDepthPreviewRefs.source.test.mjs
node scripts/discoverAdultLabsSceneDepthPreviewRefs.js

printf '%s\n' 'AdultLabs scene-depth preview references prepared locally.'
printf '%s\n' 'This step selects dispersed public screenshot references only; no image bytes, authentication or purchase are used.'
