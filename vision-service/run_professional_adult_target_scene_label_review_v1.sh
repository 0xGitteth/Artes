#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="${1:-balanced}"
case "$MODE" in
  balanced)
    PORT="${ARTES_TARGET_SCENE_REVIEW_PORT:-8794}"
    COUNT=78
    ;;
  scene-depth)
    PORT="${ARTES_TARGET_SCENE_REVIEW_PORT:-8795}"
    COUNT=63
    ;;
  *)
    printf 'Usage: %s [balanced|scene-depth]\n' "$0" >&2
    exit 2
    ;;
esac

node --test tests/professionalAdultTargetSceneLabelReview.source.test.mjs

printf 'Starting local %s target-scene human review on http://127.0.0.1:%s\n' "$MODE" "$PORT"
printf 'In GitHub Codespaces, open forwarded port %s in the Ports panel.\n' "$PORT"
printf 'All %s items are assistant-prefilled; suggestions remain non-authoritative until you confirm them.\n' "$COUNT"

ARTES_TARGET_SCENE_REVIEW_BATCH="$MODE" \
ARTES_TARGET_SCENE_REVIEW_PORT="$PORT" \
node scripts/serveProfessionalAdultTargetSceneLabelReview.js
