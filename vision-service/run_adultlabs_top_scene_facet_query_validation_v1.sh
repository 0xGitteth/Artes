#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsTopSceneFacetQueryValidation.source.test.mjs
node scripts/validateAdultLabsTopSceneFacetQueries.js

echo "AdultLabs public top-scene facet query validation prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
