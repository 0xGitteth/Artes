#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/authorizedFlickrResearch.source.test.mjs
node scripts/flickrAuthorizedResearchOAuth.js status
node scripts/probeAuthorizedFlickrRestrictedResearch.js

printf '%s\n' 'Authorized Flickr restricted research probe completed.'
printf '%s\n' 'No image bytes were downloaded.'
printf '%s\n' 'Output: .tmp/moderation-research-discovery/authorized-flickr-v1/restricted-visibility-probe.json'
