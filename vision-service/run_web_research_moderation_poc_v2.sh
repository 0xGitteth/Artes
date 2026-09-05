#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export ARTES_WEB_RESEARCH_MANIFEST="docs/moderation-web-research-batch-v2.json"
export ARTES_WEB_RESEARCH_DATASET_SUBDIR="web-research-v2"
exec bash "$SCRIPT_DIR/run_web_research_moderation_poc_v1.sh"
