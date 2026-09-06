#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsAttributeFilterDiscovery.source.test.mjs
node scripts/discoverAdultLabsAttributeFilters.js

echo "AdultLabs product-attribute filter discovery prepared locally."
echo "No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered."
