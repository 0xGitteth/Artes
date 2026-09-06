#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/balancedProfessionalAdultTargetSceneLabelReview.source.test.mjs

printf '%s\n' 'Starting local balanced target-scene human review on http://127.0.0.1:8794'
printf '%s\n' 'In GitHub Codespaces, open the forwarded port 8794 in the Ports panel.'
printf '%s\n' 'All 78 items are assistant-prefilled; suggestions remain non-authoritative until you confirm them.'

node scripts/serveBalancedProfessionalAdultTargetSceneLabelReview.js
