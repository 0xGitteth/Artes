#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/professionalAdultPublicPreviewDiscovery.source.test.mjs
node scripts/discoverProfessionalAdultPublicPreviewAssets.js

echo "Professional adult public-preview discovery prepared locally."
echo "No image bytes were downloaded."
echo "Output: .tmp/moderation-research-discovery/professional-adult-public-preview-v1/asset-candidates.json"
