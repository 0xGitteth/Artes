#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/professionalAdultB2bPublicCatalogProbe.source.test.mjs
node scripts/probeProfessionalAdultB2bPublicCatalogs.js

printf '%s\n' 'Professional adult B2B public catalog probe prepared locally.'
printf '%s\n' 'No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered.'
