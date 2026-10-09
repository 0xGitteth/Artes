#!/usr/bin/env bash
# Research only: one locally inferred, rights-reviewed 375-photo RedDesert comparison.
# Downloads publisher weights ONLY (85 MB), verifies SHA256, never uploads photos.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
if [[ ! -x "$PY" || ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ]]; then
  echo "Bestaande dataset of Python-omgeving ontbreekt; niets gedownload." >&2
  exit 1
fi
if ! "$PY" -c 'import torch, torchvision, safetensors, PIL, numpy, sklearn' >/dev/null 2>&1; then
  echo "Een bestaande Python-bibliotheek ontbreekt; niets geïnstalleerd of gedownload. Stuur deze fout." >&2
  exit 1
fi
mkdir -p "$WORK"
for file in evaluate_reddesert_artes.py evaluate_nsfw_development.py nsfw_shadow.py; do
  if ! git cat-file -e "FETCH_HEAD:vision-service/$file" 2>/dev/null; then
    echo "Haal de onderzoeksbranch eerst op met git fetch." >&2
    exit 1
  fi
  git show "FETCH_HEAD:vision-service/$file" > "$WORK/$file"
done
echo "RedDesert: authentieke modelgewichten controleren en lokaal op 375 bestaande afbeeldingen testen."
echo "Modeldownload max. 85 MB, geen beeld-API, geen serverinstallatie, geen code uit modelrepository uitgevoerd."
echo "RedDesert kent BDSM wel, maar geen aantoonbaar afzonderlijke sexual_act klasse."
"$PY" "$WORK/evaluate_reddesert_artes.py" --dataset "$DATA" --work "$WORK"
echo
echo "Stuur alleen: $WORK/reddesert-artes-aggregate.json"
