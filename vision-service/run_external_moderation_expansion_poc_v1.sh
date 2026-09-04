#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"
LOG_FILE="$REPO_ROOT/.tmp/vision-external-expansion-v1.log"
MODEL_CACHE="$SCRIPT_DIR/.model-cache/huggingface"
ENDPOINT="http://127.0.0.1:8787"
MANIFEST_NAME="moderation-external-expansion-poc-v1.json"
OUTPUT_SUBDIR="external-expansion-v1"
IMAGE_DIR="$REPO_ROOT/.tmp/moderation-test-images/$OUTPUT_SUBDIR"
OUTPUT_DIR="$REPO_ROOT/.tmp/moderation-test-set/$OUTPUT_SUBDIR"

if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Vision POC venv ontbreekt. Run eerst: bash vision-service/setup_cpu_poc.sh" >&2
  exit 2
fi

mkdir -p "$REPO_ROOT/.tmp" "$MODEL_CACHE"
export HF_HOME="$MODEL_CACHE"

cd "$REPO_ROOT"
ARTES_EXTERNAL_POC_MANIFEST="$MANIFEST_NAME" \
ARTES_EXTERNAL_POC_OUTPUT_SUBDIR="$OUTPUT_SUBDIR" \
node scripts/fetchExternalModerationPocImages.js

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
for _attempt in $(seq 1 30); do
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
  echo "Visionservice werd niet op tijd healthy." >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

cd "$REPO_ROOT"
if ! ARTES_AUTHORIZED_TEST_IMAGE_DIR="$IMAGE_DIR" \
  ARTES_AUTHORIZED_TEST_OUTPUT_DIR="$OUTPUT_DIR" \
  ARTES_CUSTOM_VISION_URL="$ENDPOINT" \
  ARTES_CUSTOM_VISION_TIMEOUT_MS="60000" \
  node scripts/prepareAuthorizedModerationTestSet.js --confirm-authorized
then
  echo "---- vision service log ----" >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

if [[ ! -f "$OUTPUT_DIR/intake.json" ]]; then
  echo "Externe expansion POC intake ontbreekt na verwerking: $OUTPUT_DIR/intake.json" >&2
  exit 1
fi

echo "External moderation expansion POC v1 prepared locally."
echo "Images: .tmp/moderation-test-images/$OUTPUT_SUBDIR"
echo "Embeddings/labels: .tmp/moderation-test-set/$OUTPUT_SUBDIR"
echo "Original external-poc seed directories were not modified by this runner."
echo "No image or embedding files were committed."
