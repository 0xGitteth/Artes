#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/balancedProfessionalAdultPreviewRefs.source.test.mjs
node scripts/discoverBalancedProfessionalAdultPreviewRefs.js

printf '%s\n' 'Balanced professional adult target-scene preview reference discovery prepared locally.'
printf '%s\n' 'No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered.'
