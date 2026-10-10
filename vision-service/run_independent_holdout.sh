#!/usr/bin/env bash
# Three-phase private Artes holdout workflow: scan, seal, evaluate.
# Only local data; strictly no model downloads/uploads, installs or production use.
set -euo pipefail
cd /workspaces/Artes
ACTION="${1:-}"
if [[ "$ACTION" != "scan" && "$ACTION" != "seal" && "$ACTION" != "evaluate" ]]; then
  echo "Gebruik: git show FETCH_HEAD:vision-service/run_independent_holdout.sh | bash -s -- scan" >&2
  echo "Acties: scan -> handmatig labels/rechten aanvullen -> seal -> evaluate" >&2
  exit 2
fi
WORK=".tmp/moderation-nsfw-pilot"
HOLDOUT=".tmp/moderation-independent-holdout"
DEVELOPMENT=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
PY=".tmp/moderation-v5-siglip2/.venv/bin/python"
if [[ ! -x "$PY" || ! -f "$DEVELOPMENT/train.json" || ! -f "$DEVELOPMENT/validation.json" ]]; then
  echo "De eerdere 375 ontwikkelfoto's of hun Python-omgeving ontbreken. Geen installaties." >&2
  exit 1
fi
mkdir -p "$HOLDOUT/images" "$HOLDOUT/_local_scripts"
for file in prepare_independent_holdout.py evaluate_independent_holdout.py \
            audit_fusion_readiness.py compare_three_nsfw.py \
            evaluate_nsfw_development.py evaluate_reddesert_artes.py \
            nsfw_shadow.py resnet34_no_torchvision.py; do
  if ! git cat-file -e "FETCH_HEAD:vision-service/$file" 2>/dev/null; then
    echo "De nieuwste onderzoeksbranch ontbreekt: eerst git fetch uitvoeren." >&2
    exit 1
  fi
  git show "FETCH_HEAD:vision-service/$file" > "$HOLDOUT/_local_scripts/$file"
done
if [[ "$ACTION" == "scan" ]]; then
  echo "1. Plaats uitsluitend nieuwe, legaal verkregen beelden in $HOLDOUT/images/"
  echo "2. Daarna scant dit commando de beelden op hergebruik van de 375 ontwikkelfoto's."
  "$PY" "$HOLDOUT/_local_scripts/prepare_independent_holdout.py" scan \
    --development "$DEVELOPMENT" --holdout "$HOLDOUT"
  echo "Vul nu de menselijke labels, onafhankelijke bron en rechten in $HOLDOUT/holdout-draft.json aan."
elif [[ "$ACTION" == "seal" ]]; then
  echo "Controleren: labels vooraf ingevuld, rechten bevestigd, beelden/bronnen nieuw, geen visuele duplicaten."
  "$PY" "$HOLDOUT/_local_scripts/prepare_independent_holdout.py" seal \
    --development "$DEVELOPMENT" --holdout "$HOLDOUT"
  echo "Private testset afgesloten. Deel hooguit $HOLDOUT/holdout-intake-aggregate.json"
else
  if [[ ! -f "$HOLDOUT/holdout-sealed.json" || ! -f "$WORK/luke-reddesert-fusion-private-heads.json" ]]; then
    echo "Testset of eerdere frozen fusion-classifier ontbreekt; eerst scan en seal." >&2
    exit 1
  fi
  # Block network model lookup even when libraries are misconfigured.
  export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1
  echo "Bevroren model en grenswaarde 0.25 testen op nieuwe foto's. Geen training of live wijzigingen."
  "$PY" "$HOLDOUT/_local_scripts/evaluate_independent_holdout.py" \
    --development "$DEVELOPMENT" --holdout "$HOLDOUT" --work "$WORK"
  echo "Deel alleen: $HOLDOUT/holdout-independent-aggregate.json"
fi
