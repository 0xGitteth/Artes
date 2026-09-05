#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"
MODEL_CACHE="$SCRIPT_DIR/.model-cache/huggingface"
ENDPOINT="http://127.0.0.1:8787"
OUTPUT_SUBDIR="${ARTES_WEB_RESEARCH_DATASET_SUBDIR:-web-research-v1}"
MANIFEST_RELATIVE="${ARTES_WEB_RESEARCH_MANIFEST:-docs/moderation-web-research-batch-v1.json}"
LOG_FILE="$REPO_ROOT/.tmp/vision-${OUTPUT_SUBDIR}.log"
IMAGE_DIR="$REPO_ROOT/.tmp/moderation-test-images/$OUTPUT_SUBDIR"
OUTPUT_DIR="$REPO_ROOT/.tmp/moderation-test-set/$OUTPUT_SUBDIR"
STARTUP_WAIT_SECONDS="${ARTES_VISION_STARTUP_WAIT_SECONDS:-120}"
POC_TIMEOUT_MS="${ARTES_CUSTOM_VISION_TIMEOUT_MS:-300000}"
SKIP_FETCH="${ARTES_WEB_RESEARCH_SKIP_FETCH:-0}"

if ! [[ "$OUTPUT_SUBDIR" =~ ^[a-z0-9][a-z0-9._-]{2,79}$ ]]; then
  echo "Ongeldige ARTES_WEB_RESEARCH_DATASET_SUBDIR." >&2
  exit 2
fi
if [[ "$MANIFEST_RELATIVE" = /* || "$MANIFEST_RELATIVE" == *".."* ]]; then
  echo "ARTES_WEB_RESEARCH_MANIFEST moet een repo-relatief manifestpad zijn." >&2
  exit 2
fi
if [[ ! -f "$REPO_ROOT/$MANIFEST_RELATIVE" ]]; then
  echo "Web-research manifest ontbreekt: $MANIFEST_RELATIVE" >&2
  exit 2
fi
if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Vision POC venv ontbreekt. Run eerst: bash vision-service/setup_cpu_poc.sh" >&2
  exit 2
fi
if ! [[ "$STARTUP_WAIT_SECONDS" =~ ^[0-9]+$ ]] || [[ "$STARTUP_WAIT_SECONDS" -lt 1 ]] || [[ "$STARTUP_WAIT_SECONDS" -gt 600 ]]; then
  echo "ARTES_VISION_STARTUP_WAIT_SECONDS moet een geheel getal tussen 1 en 600 zijn." >&2
  exit 2
fi

mkdir -p "$REPO_ROOT/.tmp" "$MODEL_CACHE"
export HF_HOME="$MODEL_CACHE"
export ARTES_WEB_RESEARCH_DATASET_SUBDIR="$OUTPUT_SUBDIR"
export ARTES_WEB_RESEARCH_MANIFEST="$MANIFEST_RELATIVE"
cd "$REPO_ROOT"

if [[ "$SKIP_FETCH" == "1" ]]; then
  if [[ ! -d "$IMAGE_DIR" || ! -f "$IMAGE_DIR/sources.json" ]]; then
    echo "Kan web-research fetch niet overslaan: afbeeldingen of sources.json ontbreken." >&2
    exit 2
  fi
  echo "Reusing already fetched web research images from .tmp/moderation-test-images/$OUTPUT_SUBDIR"
else
  node scripts/fetchWebResearchModerationImages.js
fi

cd "$SCRIPT_DIR"
"$VENV_PYTHON" -m uvicorn app:app \
  --host 127.0.0.1 \
  --port 8787 \
  > "$LOG_FILE" 2>&1 &
VISION_PID=$!

cleanup() {
  kill "$VISION_PID" 2>/dev/null || true
  wait "$VISION_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=false
for _attempt in $(seq 1 "$STARTUP_WAIT_SECONDS"); do
  if ! kill -0 "$VISION_PID" 2>/dev/null; then
    echo "Visionservice stopte tijdens startup." >&2
    tail -n 120 "$LOG_FILE" >&2 || true
    exit 1
  fi
  if curl -fsS "$ENDPOINT/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "Visionservice werd niet binnen ${STARTUP_WAIT_SECONDS}s healthy." >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

cd "$REPO_ROOT"
if ! ARTES_CUSTOM_VISION_URL="$ENDPOINT" \
  ARTES_CUSTOM_VISION_TIMEOUT_MS="$POC_TIMEOUT_MS" \
  node scripts/prepareWebResearchModerationTestSet.js
then
  echo "---- vision service log ----" >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

if [[ ! -f "$OUTPUT_DIR/intake.json" || ! -f "$OUTPUT_DIR/labels.template.json" ]]; then
  echo "Web research POC output ontbreekt na verwerking." >&2
  exit 1
fi

echo "Web research moderation POC prepared locally for $OUTPUT_SUBDIR."
echo "Manifest: $MANIFEST_RELATIVE"
echo "Images: .tmp/moderation-test-images/$OUTPUT_SUBDIR"
echo "Embeddings/labels: .tmp/moderation-test-set/$OUTPUT_SUBDIR"
echo "This set is research-only, not training-approved and not production-eligible."
echo "No image or embedding files were committed."
