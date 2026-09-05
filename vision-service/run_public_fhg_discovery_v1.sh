#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/publicFhgDiscovery.source.test.mjs
node scripts/discoverPublicFhgGalleryAssets.js

printf '\nPublic FHG discovery prepared locally.\n'
printf 'Output: .tmp/moderation-research-discovery/public-fhg-v1/gallery-assets.json\n'
printf 'No image bytes were downloaded. FHG/source intent is not a detector label.\n'
