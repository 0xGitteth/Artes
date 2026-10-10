#!/usr/bin/env bash
# One-time independent visual review preparation. Never changes training models.
set -euo pipefail
cd /workspaces/Artes
git fetch origin chatgpt/moderation-photo-candidates-20261010
RESEARCH=".tmp/moderation-research-discovery"
PHOTOS="$RESEARCH/public-photo-candidates-20261010"
mkdir -p "$RESEARCH"
echo "1/5: Laden van 108 onafhankelijke bronfoto's..."
git show FETCH_HEAD:research/moderation/explicit-candidates-20261010.json > "$RESEARCH/explicit-candidates-20261010.json"
git show FETCH_HEAD:scripts/download_explicit_candidates_20261010.py | python3 - \
  --catalog "$RESEARCH/explicit-candidates-20261010.json" \
  --output "$PHOTOS" \
  --limit 108
echo "2/5: Bestaande voorbeoordeling van 350 behouden..."
if [[ ! -f "$PHOTOS/assistant-visual-prefill.json" ]]; then
  git show FETCH_HEAD:scripts/install_manual_visual_prefill_20261010.py | python3 -
else
  echo "Bestaand voorbeoordelingsbestand blijft behouden."
fi
echo "3/5: Onafhankelijke beoordeling van 108 foto's toevoegen..."
git show FETCH_HEAD:research/moderation/explicit-visual-prefill-20261010.json > "$RESEARCH/explicit-visual-prefill-20261010.json"
git show FETCH_HEAD:scripts/merge_explicit_visual_prefill_20261010.py | python3 -
echo "4/5: Alles in dezelfde beoordelingsomgeving..."
echo "5/5: Open de Codespaces tab Ports, poort 8794 > Open in Browser."
echo "Stoppen met Ctrl+C, voortgang wordt automatisch bewaard."
git show FETCH_HEAD:scripts/review_moderation_photo_candidates_20261010.py | python3 -
