#!/usr/bin/env bash
# Research only: one locally inferred, rights-reviewed 375-photo RedDesert comparison.
# Downloads publisher weights ONLY (85 MB), verifies SHA256, never uploads photos.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-nsfw-pilot"
DATA=".tmp/moderation-v2/Artes_training_v2/Artes_dataset_v2_volledig"
if [[ ! -f "$DATA/train.json" || ! -f "$DATA/validation.json" ]]; then
  echo "De bestaande Artes-beelden of hun manifests ontbreken; niets gedownload." >&2
  exit 1
fi

# Prefer the successful research environment, but use an existing activated or
# repository venv when it already contains all compatible scientific libraries.
# Do not install or change the contents of any venv automatically.
CANDIDATES=(".tmp/moderation-v5-siglip2/.venv/bin/python" ".venv/bin/python")
if [[ -n "${VIRTUAL_ENV:-}" ]]; then
  CANDIDATES+=("$VIRTUAL_ENV/bin/python")
fi
if command -v python3 >/dev/null 2>&1; then
  CANDIDATES+=("$(command -v python3)")
fi
if command -v python >/dev/null 2>&1; then
  CANDIDATES+=("$(command -v python)")
fi
declare -A CHECKED=()
PY=""
for candidate in "${CANDIDATES[@]}"; do
  [[ -x "$candidate" ]] || continue
  full_path="$(realpath "$candidate")"
  [[ -z "${CHECKED[$full_path]:-}" ]] || continue
  CHECKED[$full_path]=1
  if "$candidate" -c 'import torch, safetensors.torch, PIL.Image, numpy, sklearn.metrics' >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done

if [[ -z "$PY" ]]; then
  echo "Geen bestaande Python-omgeving heeft alle werkende RedDesert-bibliotheken." >&2
  echo "Dit is de diagnostiek (nog steeds zonder downloads of installaties):" >&2
  declare -A DIAGNOSED=()
  for candidate in "${CANDIDATES[@]}"; do
    [[ -x "$candidate" ]] || continue
    full_path="$(realpath "$candidate")"
    [[ -z "${DIAGNOSED[$full_path]:-}" ]] || continue
    DIAGNOSED[$full_path]=1
    "$candidate" - <<'PYTEST' >&2
import importlib
import sys
print("Python:", sys.executable)
for module in ("torch", "safetensors.torch", "PIL.Image", "numpy", "sklearn.metrics"):
    try:
        importlib.import_module(module)
        print("  OK:", module)
    except Exception as exc:
        print("  PROBLEEM:", module, "=>", type(exc).__name__, str(exc)[:350])
PYTEST
  done
  echo "Stuur bovenstaande PROBLEEM-regels door; ik pas alleen de noodzakelijke afhankelijkheid aan." >&2
  exit 1
fi
echo "Werkende bestaande Python-omgeving: $PY"
mkdir -p "$WORK"
for file in evaluate_reddesert_artes.py resnet34_no_torchvision.py evaluate_nsfw_development.py nsfw_shadow.py; do
  if ! git cat-file -e "FETCH_HEAD:vision-service/$file" 2>/dev/null; then
    echo "Haal de onderzoeksbranch eerst op met git fetch." >&2
    exit 1
  fi
  git show "FETCH_HEAD:vision-service/$file" > "$WORK/$file"
done
# Verify that the pure-PyTorch replacement can build both documented publisher
# state_dict layouts before downloading 85 MB of model weights.
"$PY" - "$WORK" <<'PYTEST'
import sys
sys.path.insert(0, sys.argv[1])
from resnet34_no_torchvision import build_red_desert_resnet34
for layout in ('torchvision', 'fastai_sequential'):
    model = build_red_desert_resnet34(layout, num_classes=11)
    state = model.state_dict()
    required = ('conv1.weight', 'fc.weight') if layout == 'torchvision' else ('0.0.weight', '1.8.weight')
    if not all(key in state for key in required):
        raise ValueError('local_model_architecture_missing_required_weights')
    print('Lokaal ResNet34-model gebouwd:', layout, flush=True)
    del model
PYTEST
echo "RedDesert: authentieke modelgewichten controleren en lokaal op 375 bestaande afbeeldingen testen."
echo "ResNet34 wordt met de bestaande PyTorch gebouwd, zonder torchvision te installeren."
echo "Modeldownload max. 85 MB, geen beeld-API, geen serverinstallatie, geen code uit modelrepository uitgevoerd."
echo "RedDesert kent BDSM wel, maar geen aantoonbaar afzonderlijke sexual_act klasse."
"$PY" "$WORK/evaluate_reddesert_artes.py" --dataset "$DATA" --work "$WORK"
echo
echo "Stuur alleen: $WORK/reddesert-artes-aggregate.json"
