#!/usr/bin/env bash
# Local metadata-only discovery. No photos downloaded, uploaded or labeled.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-independent-discovery"
mkdir -p "$WORK"
if ! git cat-file -e "FETCH_HEAD:vision-service/discover_fresh_photo_candidates.py" 2>/dev/null; then
  echo "Haal eerst de recentste onderzoeksbranch op." >&2
  exit 1
fi
git show FETCH_HEAD:vision-service/discover_fresh_photo_candidates.py > "$WORK/discover_fresh_photo_candidates.py"
echo "Nieuwe openbare fotografische bronnen zoeken (originele Flickr-foto's)."
echo "CC0/BY is een eerste filter; leeftijd, toestemming en AI-gebruiksrechten moeten nog per bron bevestigd worden."
echo "GEEN beeldbestanden downloaden. GEEN scores, persoonlijke afbeeldingen of rechtenverklaringen uploaden."
python3 "$WORK/discover_fresh_photo_candidates.py" --work "$WORK" --limit 240
python3 - "$WORK/photo-discovery-public-review-links.json" <<'PYFIX'
from pathlib import Path
import sys
p=Path(sys.argv[1]); raw=p.read_text(encoding="utf-8")
if raw.endswith(chr(92)+"n"): p.write_text(raw[:-2]+"\n", encoding="utf-8")
PYFIX
echo
echo "Stuur alleen: $WORK/photo-discovery-public-review-links.json"
