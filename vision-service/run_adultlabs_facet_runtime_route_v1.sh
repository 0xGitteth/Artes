#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsFacetRuntimeRoute.source.test.mjs
node scripts/traceAdultLabsFacetRuntimeRoute.js

echo "AdultLabs public facet runtime-route trace prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
