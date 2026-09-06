#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsCatalogFacetResolver.source.test.mjs
node scripts/resolveAdultLabsCatalogFacetFilters.js

echo "AdultLabs public facet filter resolution prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
