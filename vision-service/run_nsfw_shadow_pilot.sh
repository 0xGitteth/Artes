#!/usr/bin/env bash
# First small CPU-only NSFW pilot, requiring only the previously used Codespace.
# No deploy, no paid API, no write to Git-tracked source files.
set -euo pipefail
cd /workspaces/Artes

WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
REF="FETCH_HEAD"
REV="7c914c1a94ac1a8d16af7982101756f5650b870a"

if [[ ! -x "$PY" ]]; then
  echo "Bestaande Python-omgeving ontbreekt: $PY. Stop zonder installatie." >&2
  exit 1
fi
if [[ ! -d "$DATA" ]]; then
  echo "Bestaande dataset ontbreekt op verwachte locatie: $DATA. Stop zonder wijzigingen." >&2
  exit 1
fi
if ! git cat-file -e "$REF:vision-service/nsfw_shadow.py" 2>/dev/null; then
  echo "Haal eerst de branch op: git fetch origin chatgpt/moderation-multidetector-shadow" >&2
  exit 1
fi
mkdir -p "$WORK"
git show "$REF:vision-service/nsfw_shadow.py" > "$WORK/nsfw_shadow.py"
git show "$REF:vision-service/benchmark_nsfw_shadow.py" > "$WORK/benchmark_nsfw_shadow.py"

echo "Start CPU-test op hoogstens 30 bestaande beelden, zonder upload naar derden."
echo "Let op: Codespaces rekent mogelijk gebruik buiten je gratis maandtegoed."
echo "De pretrained modelgewichten worden eenmalig gratis van Hugging Face gedownload."
"$PY" "$WORK/benchmark_nsfw_shadow.py" \
  --images-dir "$DATA" \
  --model-revision "$REV" \
  --max-images 30 | tee "$WORK/benchmark.json"
echo
echo "Klaar. Download dit bestand vanuit Codespaces en stuur het in de chat:"
echo "$WORK/benchmark.json"
