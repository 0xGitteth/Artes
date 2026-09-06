#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/professionalAdultB2bSetDiscovery.source.test.mjs
node scripts/discoverProfessionalAdultB2bSetCandidates.js

printf '%s\n' 'Professional adult B2B set-level discovery prepared locally.'
printf '%s\n' 'No image bytes were downloaded. Review setCount, sourcePoolCount, facetCounts and facetShortages before fetching previews.'
