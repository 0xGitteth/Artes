#!/usr/bin/env bash
# Artes research: compare paired cached Luke and RedDesert scores on 375 images.
# No AI image inference, downloads, packages, model server or production changes.
set -euo pipefail
cd /workspaces/Artes

WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"

if [[ ! -x "$PY" || ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ||
      ! -f "$WORK/nsfw-luke-private-scores.jsonl" ||
      ! -f "$WORK/reddesert-private-scores.jsonl" ]]; then
  echo "De bestaande Python-omgeving, menselijke labels of beide scorecaches ontbreken." >&2
  echo "Niets gedownload of geïnstalleerd. Stuur deze fout naar de chat." >&2
  exit 1
fi
if ! "$PY" -c 'import numpy, sklearn' >/dev/null 2>&1; then
  echo "De bestaande Python-omgeving mist numpy of scikit-learn." >&2
  exit 1
fi
for file in compare_luke_reddesert_fusion.py compare_three_nsfw.py evaluate_reddesert_artes.py evaluate_nsfw_development.py nsfw_shadow.py; do
  if ! git cat-file -e "FETCH_HEAD:vision-service/$file" 2>/dev/null; then
    echo "Haal de onderzoeksbranch opnieuw op met git fetch." >&2
    exit 1
  fi
  git show "FETCH_HEAD:vision-service/$file" > "$WORK/$file"
done

echo "Artes: drie modellen vergelijken op identieke, reeds opgeslagen foto-scores."
echo "Geen foto's opnieuw geanalyseerd, geen downloads, geen betaalde API en geen live wijzigingen."
echo "We trainen uitsluitend lokale context-classificatielagen en controleren vier gescheiden brongroepen."
"$PY" "$WORK/compare_luke_reddesert_fusion.py" --dataset "$DATA" --work "$WORK"
echo
echo "Stuur alleen dit bestand: $WORK/luke-reddesert-fusion-aggregate.json"
