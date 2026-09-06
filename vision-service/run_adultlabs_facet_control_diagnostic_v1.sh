#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsFacetControlDiagnostic.source.test.mjs
node scripts/inspectAdultLabsFacetControls.js

echo "AdultLabs public facet-control diagnostic prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
