#!/usr/bin/env bash
# One local three-model study, no app deployment, no paid API.
# The existing 375-image Viddexa cache is reused.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-nsfw-pilot"
NODE="$WORK/gantman-node"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
REF="FETCH_HEAD"

if [[ ! -x "$PY" || ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ||
      ! -f "$WORK/nsfw-private-development-scores.jsonl" ]]; then
  echo "De eerder gebruikte Python-omgeving, ontwikkelbeelden of Viddexa-scores ontbreken." >&2
  echo "Er wordt niets gedownload of geïnstalleerd. Stuur deze fout naar de chat." >&2
  exit 1
fi
if ! git cat-file -e "$REF:vision-service/compare_three_nsfw.py" 2>/dev/null; then
  echo "Haal eerst de nieuwste PR-branch op met git fetch." >&2
  exit 1
fi
mkdir -p "$WORK" "$NODE"
git show "$REF:vision-service/compare_three_nsfw.py" > "$WORK/compare_three_nsfw.py"
git show "$REF:vision-service/evaluate_nsfw_development.py" > "$WORK/evaluate_nsfw_development.py"
git show "$REF:vision-service/nsfw_shadow.py" > "$WORK/nsfw_shadow.py"
git show "$REF:vision-service/score_gantman_nsfw.mjs" > "$NODE/score_gantman_nsfw.mjs"

"$PY" "$WORK/compare_three_nsfw.py" prepare --data-dir "$DATA" --output-dir "$WORK"

echo
echo "Model 1: bestaande 375 NSFW Mini scores worden hergebruikt."
echo "Model 2: LukeJacob ViT downloadt ongeveer 343 MB, alleen voor deze test."
echo "Model 3: NSFWJS MobileNet gebruikt lokale CPU, geen externe beeld-API."
echo "Let op: de bestaande Codespace verbruikt tijdens testen wel CPU-uren en opslag."

# Tests are independent: if an optional model fails, summarize incomplete data
# instead of declaring the three-way comparison successful.
set +e
"$PY" "$WORK/compare_three_nsfw.py" luke \
  --data-dir "$DATA" --output-dir "$WORK" --max-new 3
LUKE_SMOKE=$?
if [[ $LUKE_SMOKE -eq 0 ]]; then
  "$PY" "$WORK/compare_three_nsfw.py" luke --data-dir "$DATA" --output-dir "$WORK"
  LUKE_RUN=$?
else
  LUKE_RUN=$LUKE_SMOKE
fi

# Install only in ignored .tmp directory, never modify root package.json
# or package-lock.json. No native TensorFlow, no GPU, no paid endpoint.
if [[ ! -d "$NODE/node_modules/nsfwjs" || ! -d "$NODE/node_modules/@tensorflow/tfjs" ||
      ! -d "$NODE/node_modules/sharp" ]]; then
  npm install --prefix "$NODE" --no-save --no-audit --no-fund --ignore-scripts \
    nsfwjs@4.1.0 @tensorflow/tfjs@4.22.0 sharp@0.34.5
  NODE_INSTALL=$?
else
  NODE_INSTALL=0
fi
if [[ $NODE_INSTALL -eq 0 ]]; then
  node "$NODE/score_gantman_nsfw.mjs" \
    "$WORK/nsfw-development-manifest.jsonl" \
    "$WORK/nsfw-gantman-private-scores.jsonl" 3
  GANT_SMOKE=$?
  if [[ $GANT_SMOKE -eq 0 ]]; then
    node "$NODE/score_gantman_nsfw.mjs" \
      "$WORK/nsfw-development-manifest.jsonl" \
      "$WORK/nsfw-gantman-private-scores.jsonl"
    GANT_RUN=$?
  else
    GANT_RUN=$GANT_SMOKE
  fi
else
  GANT_RUN=$NODE_INSTALL
fi

"$PY" "$WORK/compare_three_nsfw.py" report --data-dir "$DATA" --output-dir "$WORK"
REPORT=$?
set -e

echo
echo "Resultaat: $WORK/nsfw-three-way-summary.json"
echo "Stuur ALLEEN deze samenvatting naar de chat, geen individuele scores of foto's."
if [[ $LUKE_RUN -ne 0 || $GANT_RUN -ne 0 || $REPORT -ne 0 ]]; then
  echo "Let op: ten minste één model werkte niet volledig; rapport markeert dat expliciet."
  echo "Stuur ook de laatste terminalregels als één kandidaat niet is voltooid."
fi
