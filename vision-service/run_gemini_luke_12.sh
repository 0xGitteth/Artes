#!/usr/bin/env bash
# Explicitly authorized 12-image Gemini vs Luke pilot, confined to staging.
# Running this WILL send up to 12 existing development images to Google Vertex AI.
# Google API usage MAY BE BILLED. No staging or production deployment occurs.
set -euo pipefail
cd /workspaces/Artes

ROOT="/workspaces/Artes"
WORK="$ROOT/.tmp/moderation-nsfw-pilot"
DATA="$ROOT/.tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY="$ROOT/.tmp/moderation-v5-siglip2/.venv/bin/python"
REF="FETCH_HEAD"

if [[ ! -x "$PY" || ! -f "$WORK/nsfw-luke-private-scores.jsonl" ||
      ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ]]; then
  echo "Bestaande dataset, Python-omgeving of Luke-scores ontbreken. Gestopt zonder Google-aanroepen." >&2
  exit 1
fi
if [[ ! -d "$ROOT/functions/node_modules/@google-cloud/vertexai" ]]; then
  echo "De bestaande Vertex AI Node-bibliotheek ontbreekt in functions/node_modules." >&2
  echo "Er worden geen nieuwe pakketten geïnstalleerd. Stuur deze melding naar de chat." >&2
  exit 1
fi
for file in compare_gemini_luke.py compare_three_nsfw.py evaluate_nsfw_development.py nsfw_shadow.py; do
  git cat-file -e "$REF:vision-service/$file" || exit 1
  git show "$REF:vision-service/$file" > "$WORK/$file"
done
git cat-file -e "$REF:functions/scripts/runGeminiLukePilot.mjs" || exit 1
git show "$REF:functions/scripts/runGeminiLukePilot.mjs" > "$WORK/runGeminiLukePilot.mjs"

echo "GEAUTORISEERDE 12-FOTO VERGELIJKING"
echo "Google project: artes-staging (niet productie)"
echo "Google model: gemini-2.5-flash; locatie: europe-west4"
echo "Maximaal 12 cumulatieve Gemini-verzoeken; voor een volgende serie is een nieuwe goedkeuring nodig."
echo "De foto's verlaten Codespaces en worden verwerkt door Google Vertex AI; er kunnen kosten ontstaan."
echo "Bij de eerste API-fout of ongeldig contract stoppen we direct."
echo "De originele beelden, persoonlijke paden en ruwe API-responses worden niet gerapporteerd."
echo

# These flags apply only to this single Node invocation.
ARTES_GEMINI_COMPARISON_AUTHORIZED=YES \
ENABLE_GEMINI_CLASSIFIER=true \
GOOGLE_CLOUD_PROJECT=artes-staging \
GOOGLE_CLOUD_LOCATION=europe-west4 \
GEMINI_MODEL=gemini-2.5-flash \
node "$WORK/runGeminiLukePilot.mjs" --run --external-google-approved --limit 12 --max-new 12

"$PY" "$WORK/compare_gemini_luke.py" --dataset "$DATA" --work "$WORK" --limit 12
echo
echo "Stuur alleen dit aggregaat naar de chat: $WORK/gemini-luke-aggregate.json"
echo "Geen individuele scores, foto's of geheimen opsturen."
