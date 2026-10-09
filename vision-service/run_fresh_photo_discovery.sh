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
echo
echo "Stuur alleen: $WORK/photo-discovery-aggregate.json"
