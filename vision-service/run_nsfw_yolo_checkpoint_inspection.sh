#!/usr/bin/env bash
# Analyze the 254 MB TAR already downloaded in the existing Codespace.
# Does not redownload, install, extract, execute, or upload anything.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-nsfw-yolo"
if [[ ! -f "$WORK/nsfw-yolo-archive-preflight.json" ]]; then
  echo "Het eerdere inspectierapport ontbreekt. Er wordt niets gedownload." >&2
  exit 1
fi
for file in probe_nsfw_yolo_artifact.py inspect_nsfw_yolo_checkpoint.py; do
  if ! git cat-file -e "FETCH_HEAD:vision-service/$file" 2>/dev/null; then
    echo "Haal eerst de onderzoeksbranch op met git fetch." >&2
    exit 1
  fi
  git show "FETCH_HEAD:vision-service/$file" > "$WORK/$file"
done
echo "Bestaande modelarchief lokaal opnieuw onderzoeken, zonder download of beeldanalyse..."
python3 "$WORK/inspect_nsfw_yolo_checkpoint.py" --work "$WORK"
echo
echo "Stuur dit JSON-bestand: $WORK/nsfw-yolo-checkpoint-inspection.json"
