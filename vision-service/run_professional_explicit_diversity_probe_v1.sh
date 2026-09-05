#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/professionalExplicitDiversityProbe.source.test.mjs
node scripts/probeProfessionalExplicitDiversityGalleryLeads.js

echo "Professional explicit source-diversity probe prepared locally."
echo "No image bytes were downloaded and no authenticated/member areas were entered."
