#!/usr/bin/env bash
# Research only. Train first Artes multi-axis heads on cached Luke visual features.
# No remote image API, no model download, no new package installation, no deployment.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
if [[ ! -x "$PY" || ! -f "$WORK/nsfw-luke-private-scores.jsonl" ||
      ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ]]; then
  echo "Missing existing development set, Luke cache or Python environment. Stopped." >&2
  exit 1
fi
for filename in train_luke_artes.py compare_three_nsfw.py evaluate_nsfw_development.py nsfw_shadow.py; do
  git cat-file -e "FETCH_HEAD:vision-service/$filename"
  git show "FETCH_HEAD:vision-service/$filename" > "$WORK/$filename"
done
if ! "$PY" -c 'import numpy, sklearn, transformers, torch, PIL' >/dev/null 2>&1; then
  echo "Existing Python environment lacks needed training libraries; nothing installed." >&2
  exit 1
fi
echo "Training Artes heads locally from the pinned Luke model."
echo "No API calls or downloads. First extraction may take several minutes on CPU."
echo "Intermediate/private scores and training heads remain inside gitignored .tmp."
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 \
"$PY" "$WORK/train_luke_artes.py" --dataset "$DATA" --work "$WORK"
echo
echo "Share ONLY: $WORK/luke-artes-trained-aggregate.json"
