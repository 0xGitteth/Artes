#!/usr/bin/env bash
# Safe FIRST step: inspect the Luke-vs-Gemini pairing.
# Zero Google API calls; zero image uploads; no Gemini inference.
set -euo pipefail
cd /workspaces/Artes

WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
REF="FETCH_HEAD"
if [[ ! -x "$PY" || ! -f "$WORK/nsfw-luke-private-scores.jsonl" ||
      ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ]]; then
  echo "De bestaande 375-image dataset of Luke-scorecache is niet gevonden; er wordt niets gestart." >&2
  exit 1
fi
for file in compare_gemini_luke.py compare_three_nsfw.py evaluate_nsfw_development.py nsfw_shadow.py; do
  git cat-file -e "$REF:vision-service/$file" || exit 1
done
git cat-file -e "$REF:functions/scripts/runGeminiLukePilot.mjs" || exit 1

# No new packages or changes to the working branch.
git show "$REF:functions/scripts/runGeminiLukePilot.mjs" > "$WORK/runGeminiLukePilot.mjs"
for file in compare_gemini_luke.py compare_three_nsfw.py evaluate_nsfw_development.py nsfw_shadow.py; do
  git show "$REF:vision-service/$file" > "$WORK/$file"
done

echo "Alleen bestaande resultaten bekijken. GEEN Google/Gemini API-aanroepen."
echo "De vergelijking gebruikt de Gemini promptcode uit je huidige checkout:"
git branch --show-current
node "$WORK/runGeminiLukePilot.mjs" --preview --limit 82
"$PY" "$WORK/compare_gemini_luke.py" --dataset "$DATA" --work "$WORK" --limit 82

echo
echo "Eventueel eerder gemaakte lokale Gemini-artifacts (alleen bestandsnamen):"
find .tmp -maxdepth 6 -type f \( -iname '*gemini*.json' -o -iname '*gemini*.jsonl' \
  -o -iname '*gemini*.csv' \) -print 2>/dev/null | head -20 || true
echo
echo "Stuur dit rapport, zonder foto's of individuele scores:"
echo "$WORK/gemini-luke-aggregate.json"
echo "Als 0 gekoppelde Gemini-resultaten zijn gevonden, doen we pas na jouw toestemming een kleine, betaalde externe test."
