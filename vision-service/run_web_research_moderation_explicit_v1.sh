#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ARTES_WEB_RESEARCH_MANIFEST="docs/moderation-web-research-explicit-v1.json"
export ARTES_WEB_RESEARCH_DATASET_SUBDIR="web-research-explicit-v1"
export ARTES_WEB_RESEARCH_FETCH_SCRIPT="scripts/fetchExplicitWebResearchModerationImages.js"
exec bash "$SCRIPT_DIR/run_web_research_moderation_poc_v1.sh"
