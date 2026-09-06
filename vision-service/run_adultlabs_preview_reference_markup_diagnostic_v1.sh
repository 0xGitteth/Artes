#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test tests/adultLabsPreviewReferenceMarkupDiagnostic.source.test.mjs
node scripts/inspectAdultLabsPreviewReferenceMarkup.js

printf '%s\n' 'AdultLabs preview reference markup diagnostic prepared locally.'
printf '%s\n' 'No image bytes were downloaded, no purchase was performed and no authenticated/member area was entered.'
