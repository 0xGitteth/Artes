#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test \
  tests/professionalAdultPublicPreviewDiscovery.source.test.mjs \
  tests/professionalAdultPromoLeadProbe.source.test.mjs

node scripts/probeProfessionalAdultPromoGalleryLeads.js

printf '%s\n' 'Professional adult promo lead probe prepared locally.'
printf '%s\n' 'No image bytes were downloaded and no authenticated/member areas were entered.'
