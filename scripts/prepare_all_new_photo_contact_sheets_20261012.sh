#!/usr/bin/env bash
# Prepare contact sheets for the ONE future Artes manual moderation review.
# This never edits existing human review decisions or training datasets.
set -euo pipefail
cd /workspaces/Artes
git fetch origin chatgpt/moderation-photo-candidates-20261010
ROOT=".tmp/moderation-research-discovery"
PHOTOS="$ROOT/public-photo-candidates-20261010"
mkdir -p "$ROOT"
echo "Voorcontrole: controleren of alle benodigde Python-scripts geldig zijn"
for SCRIPT in \
 scripts/download_explicit_candidates_20261010.py \
 scripts/install_manual_visual_prefill_20261010.py \
 scripts/merge_explicit_visual_prefill_20261010.py \
 scripts/download_bdsm_photo_candidates_20261011.py \
 scripts/download_explicit_alt_candidates_20261011.py \
 scripts/download_ordinary_photo_candidates_20261012.py \
 scripts/create_moderation_contact_sheets_20261010.py; do
  git show "FETCH_HEAD:$SCRIPT" | python3 -c "import ast,sys; ast.parse(sys.stdin.read())" || exit 1
done
if [[ ! -f "$PHOTOS/unreviewed-images.jsonl" ]]; then
  echo "Fout: de eerste 350 gedownloade beelden ontbreken." >&2
  exit 1
fi

echo "[1/8] Voorbeoordeelde onderzoeksfoto's ophalen"
git show FETCH_HEAD:research/moderation/explicit-candidates-20261010.json > "$ROOT/explicit-candidates-20261010.json"
git show FETCH_HEAD:scripts/download_explicit_candidates_20261010.py | python3 - \
 --catalog "$ROOT/explicit-candidates-20261010.json" --output "$PHOTOS" --limit 108

echo "[2/8] De originele 350 visuele beoordelingen bewaren"
if [[ ! -f "$PHOTOS/assistant-visual-prefill.json" ]]; then
  git show FETCH_HEAD:scripts/install_manual_visual_prefill_20261010.py | python3 -
else
  echo "Reeds aanwezig. Niet overschreven."
fi

echo "[3/8] De bestaande 108 visuele beoordelingen samenvoegen"
git show FETCH_HEAD:research/moderation/explicit-visual-prefill-20261010.json > "$ROOT/explicit-visual-prefill-20261010.json"
git show FETCH_HEAD:scripts/merge_explicit_visual_prefill_20261010.py | python3 -

echo "[4/8] Nieuwe kink- en bondagefotografie verzamelen"
git show FETCH_HEAD:research/moderation/bdsm-diverse-candidates-20261011.json > "$ROOT/bdsm-diverse-candidates-20261011.json"
git show FETCH_HEAD:scripts/download_bdsm_photo_candidates_20261011.py | python3 - \
 --catalog "$ROOT/bdsm-diverse-candidates-20261011.json" --output "$PHOTOS" --limit 64

echo "[5/8] Extra onderzoekskandidaten uit twee andere bronnen verzamelen"
git show FETCH_HEAD:scripts/download_explicit_alt_candidates_20261011.py | python3 - \
 --output "$PHOTOS" --x1101-limit 48 --samo-limit 24

echo "[6/8] Gewone fotografie verzamelen"
git show FETCH_HEAD:research/moderation/ordinary-photo-candidates-20261012.json > "$ROOT/ordinary-photo-candidates-20261012.json"
git show FETCH_HEAD:scripts/download_ordinary_photo_candidates_20261012.py | python3 - \
 --catalog "$ROOT/ordinary-photo-candidates-20261012.json" --folder "$PHOTOS"

echo "[7/8] Contactvellen maken van alléén de nog niet onafhankelijk beoordeelde foto's"
git show FETCH_HEAD:scripts/create_moderation_contact_sheets_20261010.py | python3 - \
 --folder "$PHOTOS" \
 --collection "bdsm_kink_source_unreviewed,explicit_alt_source_unverified,ordinary_real_photography_unreviewed" \
 --output "$ROOT/Artes_nieuwe_contactvellen_20261012.zip"

echo "[8/8] Samenvatting:"
python3 - <<'PY'
import json
from collections import Counter
from pathlib import Path
f=Path(".tmp/moderation-research-discovery/public-photo-candidates-20261010")
items=[json.loads(line) for line in (f/"unreviewed-images.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
labels=json.loads((f/"assistant-visual-prefill.json").read_text(encoding="utf-8"))["items"]
print("Lokaal opgehaald:",len(items))
print("Reeds onafhankelijk voorgelabeld:",len(labels))
print("Nog visueel te beoordelen:", len(items)-len(labels))
print("Verdeling van de toegevoegde bronnen:")
for k,n in Counter(i["collection"] for i in items).items():print(" ",k,n)
print("Gemaakt: .tmp/moderation-research-discovery/Artes_nieuwe_contactvellen_20261012.zip")
PY
echo "Download die ZIP en upload hem in deze ChatGPT conversatie."
echo "De definitieve gecombineerde beoordelingspagina openen we PAS na voorbeoordeling van deze aanvulling."
