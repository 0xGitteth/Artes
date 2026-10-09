#!/usr/bin/env bash
# Aggregate matched-recall comparison from three existing private score caches.
# No model downloads, no new inferences, no external image processing.
set -euo pipefail
cd /workspaces/Artes

WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
REF="FETCH_HEAD"

if [[ ! -x "$PY" || ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ]]; then
  echo "Bestaande ontwikkelomgeving of dataset niet gevonden. Stop zonder wijzigingen." >&2
  exit 1
fi
for file in nsfw-private-development-scores.jsonl nsfw-luke-private-scores.jsonl nsfw-gantman-private-scores.jsonl; do
  if [[ ! -s "$WORK/$file" ]]; then
    echo "Ontbrekende individuele scorecache: $WORK/$file" >&2
    exit 1
  fi
done
if ! git cat-file -e "$REF:vision-service/compare_nsfw_thresholds.py" 2>/dev/null; then
  echo "Haal eerst de nieuwste modelvergelijkingsbranch op." >&2
  exit 1
fi
mkdir -p "$WORK"
for file in compare_nsfw_thresholds.py compare_three_nsfw.py evaluate_nsfw_development.py nsfw_shadow.py; do
  git show "$REF:vision-service/$file" > "$WORK/$file"
done
"$PY" "$WORK/compare_nsfw_thresholds.py" \
  --data-dir "$DATA" --output-dir "$WORK"

echo
echo "Stuur alleen dit geaggregeerde bestand:"
echo "$WORK/nsfw-matched-recall-summary.json"
echo "Foto's en individuele scores blijven ongewijzigd lokaal; geen AI-model opnieuw uitgevoerd."
