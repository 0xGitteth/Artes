#!/usr/bin/env bash
# Locally compare pretrained NSFW model scores to 375 human-reviewed development images.
# Reuses the existing Python venv and model cache; no new paid service or git checkout.
set -euo pipefail
cd /workspaces/Artes

WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
REF="FETCH_HEAD"
REV="7c914c1a94ac1a8d16af7982101756f5650b870a"

if [[ ! -x "$PY" || ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ]]; then
  echo "Bestaande Python-omgeving of dataset ontbreekt; geen installatie uitgevoerd." >&2
  exit 1
fi
if ! git cat-file -e "$REF:vision-service/evaluate_nsfw_development.py" 2>/dev/null; then
  echo "Voer eerst git fetch origin chatgpt/moderation-multidetector-shadow uit." >&2
  exit 1
fi
mkdir -p "$WORK"
git show "$REF:vision-service/nsfw_shadow.py" > "$WORK/nsfw_shadow.py"
git show "$REF:vision-service/evaluate_nsfw_development.py" > "$WORK/evaluate_nsfw_development.py"

echo "Vergelijk 375 bestaande ontwikkelfoto's met de oorspronkelijke Artes-beoordelingen."
echo "Geen externe beeld-API; geen nieuwe betaalde dienst. Codespaces-tijd telt wel mee."
echo "De 100 historische testfoto's worden NIET opnieuw gebruikt."
"$PY" "$WORK/evaluate_nsfw_development.py" \
  --data-dir "$DATA" \
  --output-dir "$WORK" \
  --model-revision "$REV"

echo
echo "Stuur ALLEEN dit samenvattende bestand naar de chat:"
echo "$WORK/nsfw-development-summary.json"
echo "Het afzonderlijke bestand met individuele scores blijft lokaal in .tmp voor eventuele latere modelvergelijking."
