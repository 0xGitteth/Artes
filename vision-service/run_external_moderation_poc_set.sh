#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"
LOG_FILE="$REPO_ROOT/.tmp/vision-external-poc.log"
MODEL_CACHE="$SCRIPT_DIR/.model-cache/huggingface"
ENDPOINT="http://127.0.0.1:8787"
IMAGE_DIR="$REPO_ROOT/.tmp/moderation-test-images/external-poc"
OUTPUT_DIR="$REPO_ROOT/.tmp/moderation-test-set/external-poc"

if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Vision POC venv ontbreekt. Run eerst: bash vision-service/setup_cpu_poc.sh" >&2
  exit 2
fi

mkdir -p "$REPO_ROOT/.tmp" "$MODEL_CACHE"
export HF_HOME="$MODEL_CACHE"

cd "$REPO_ROOT"
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

process_summary="$OUTPUT_DIR/intake.json"
if [[ ! -f "$process_summary" ]]; then
  echo "Externe POC intake ontbreekt na verwerking: $process_summary" >&2
  exit 1
fi

echo "External moderation POC set prepared locally."
echo "Images: .tmp/moderation-test-images/external-poc"
echo "Embeddings/labels: .tmp/moderation-test-set/external-poc"
echo "No image or embedding files were committed."
