#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/weShootAdultMaleFemaleSourcePools.source.test.mjs
node scripts/discoverWeShootAdultMaleFemaleSourcePools.js

printf '%s\n' 'WeShootAdult public male-female source-pool discovery prepared locally.'
printf '%s\n' 'No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered.'
