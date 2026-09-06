#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsFacetClientState.source.test.mjs
node scripts/resolveAdultLabsFacetClientState.js

echo "AdultLabs public facet client-state resolution prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
