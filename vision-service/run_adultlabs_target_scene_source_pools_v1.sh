#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsTargetSceneSourcePools.source.test.mjs
node scripts/discoverAdultLabsTargetSceneSourcePools.js

echo "AdultLabs targeted public scene source-pool discovery prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
