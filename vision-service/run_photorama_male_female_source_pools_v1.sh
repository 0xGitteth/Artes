#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/photoramaMaleFemaleSourcePools.source.test.mjs
node scripts/discoverPhotoramaMaleFemaleSourcePools.js

echo "Photorama public male-female source-pool discovery prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
