#!/usr/bin/env bash
# Public-source metadata search, not image collection.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-independent-discovery"
mkdir -p "$WORK"
SCRIPT="vision-service/discover_multisource_photo_candidates.py"
if ! git cat-file -e "FETCH_HEAD:$SCRIPT" 2>/dev/null; then
  echo "Eerst de laatste onderzoeksbranch ophalen met git fetch." >&2
  exit 1
fi
git show "FETCH_HEAD:$SCRIPT" > "$WORK/discover_multisource_photo_candidates.py"
echo "Openverse doorzoeken ZONDER Flickr als verplichte bron."
echo "Dit is publieke metadata, geen gedownloade foto's of licentiegoedkeuring."
python3 "$WORK/discover_multisource_photo_candidates.py" --work "$WORK" --limit 180
echo
echo "Deel: $WORK/photo-discovery-public-review-links.json"
echo "Als er 0 zijn, deel OOK: $WORK/photo-discovery-aggregate.json"
