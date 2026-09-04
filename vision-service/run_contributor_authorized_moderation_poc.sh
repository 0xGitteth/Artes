#!/usr/bin/env bash
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$SCRIPT_DIR/.venv/bin/python"
LOG_FILE="$REPO_ROOT/.tmp/vision-contributor-authorized.log"
MODEL_CACHE="$SCRIPT_DIR/.model-cache/huggingface"
ENDPOINT="http://127.0.0.1:8787"
STARTUP_WAIT_SECONDS="${ARTES_VISION_STARTUP_WAIT_SECONDS:-120}"
POC_TIMEOUT_MS="${ARTES_CUSTOM_VISION_TIMEOUT_MS:-300000}"

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
node scripts/prepareContributorAuthorizedModerationIntake.js --confirm-authorized

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
if ! ARTES_CUSTOM_VISION_URL="$ENDPOINT" \
  ARTES_CUSTOM_VISION_TIMEOUT_MS="$POC_TIMEOUT_MS" \
  node scripts/prepareContributorAuthorizedModerationEmbeddings.js --confirm-authorized
then
  echo "---- vision service log ----" >&2
  tail -n 120 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "Contributor-authorized moderation POC embedded locally."
echo "Images remain in .tmp/moderation-contributor-images"
echo "Intake/embeddings: .tmp/moderation-contributor-intake"
echo "No image or embedding files were committed or uploaded."
