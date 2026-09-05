#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

node --test tests/targetedHardGapDiscovery.source.test.mjs
node scripts/discoverTargetedHardGapFlickrCandidates.js

echo "Targeted hard-gap discovery prepared locally."
echo "Output: .tmp/moderation-research-discovery/hard-gap-targeted-v1/flickr-targeted-candidates.json"
echo "No image bytes were downloaded. Discovery hints are not detector labels."
