#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/videoBunchMaleFemaleSourcePools.source.test.mjs
node scripts/discoverVideoBunchMaleFemaleSourcePools.js

printf '%s\n' 'VideoBunch public male-female source-pool discovery prepared locally.'
printf '%s\n' 'No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered.'
