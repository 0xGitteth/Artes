#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"
LOG_FILE="$REPO_ROOT/.tmp/vision-external-male-topless-v1.log"
MODEL_CACHE="$SCRIPT_DIR/.model-cache/huggingface"
ENDPOINT="http://127.0.0.1:8787"
MANIFEST_NAME="moderation-external-male-topless-poc-v1.json"
OUTPUT_SUBDIR="external-male-topless-v1"
IMAGE_DIR="$REPO_ROOT/.tmp/moderation-test-images/$OUTPUT_SUBDIR"
OUTPUT_DIR="$REPO_ROOT/.tmp/moderation-test-set/$OUTPUT_SUBDIR"
STARTUP_WAIT_SECONDS="${ARTES_VISION_STARTUP_WAIT_SECONDS:-120}"
POC_TIMEOUT_MS="${ARTES_CUSTOM_VISION_TIMEOUT_MS:-300000}"
SKIP_FETCH="${ARTES_EXTERNAL_POC_SKIP_FETCH:-0}"

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

cd "$REPO_ROOT"
if [[ "$SKIP_FETCH" == "1" ]]; then
  if [[ ! -d "$IMAGE_DIR" || ! -f "$IMAGE_DIR/sources.json" ]]; then
    echo "Kan fetch niet overslaan: bestaande male-topless afbeeldingen of sources.json ontbreken." >&2
    exit 2
  fi
  echo "Reusing already fetched male-topless POC images from .tmp/moderation-test-images/$OUTPUT_SUBDIR"
else
  ARTES_EXTERNAL_POC_MANIFEST="$MANIFEST_NAME" \
  ARTES_EXTERNAL_POC_OUTPUT_SUBDIR="$OUTPUT_SUBDIR" \
  node scripts/fetchExternalModerationPocImages.js
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
    echo "---- vision service log ----" >&2
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
  echo "---- vision service log ----" >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

cd "$REPO_ROOT"
if ! ARTES_AUTHORIZED_TEST_IMAGE_DIR="$IMAGE_DIR" \
  ARTES_AUTHORIZED_TEST_OUTPUT_DIR="$OUTPUT_DIR" \
  ARTES_CUSTOM_VISION_URL="$ENDPOINT" \
  ARTES_CUSTOM_VISION_TIMEOUT_MS="$POC_TIMEOUT_MS" \
  node scripts/prepareAuthorizedModerationTestSet.js --confirm-authorized
then
  echo "---- vision service log ----" >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

if [[ ! -f "$OUTPUT_DIR/intake.json" ]]; then
  echo "Male-topless POC intake ontbreekt na verwerking: $OUTPUT_DIR/intake.json" >&2
  exit 1
fi

echo "External male-topless POC v1 prepared locally."
echo "Images: .tmp/moderation-test-images/$OUTPUT_SUBDIR"
echo "Embeddings/labels: .tmp/moderation-test-set/$OUTPUT_SUBDIR"
echo "Existing seed and expansion directories were not modified."
echo "No image or embedding files were committed."
