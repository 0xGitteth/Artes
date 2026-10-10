#!/usr/bin/env bash
# Artes research: obtain only the publisher artifact and inspect its TAR safely.
# No images are uploaded, no untrusted model code executed, no training or deployment.
set -euo pipefail
cd /workspaces/Artes
WORK=".tmp/moderation-nsfw-yolo"
mkdir -p "$WORK"
if ! git cat-file -e "FETCH_HEAD:vision-service/probe_nsfw_yolo_artifact.py"; then
  echo "Haal eerst de recentste research branch op met git fetch." >&2
  exit 1
fi
git show FETCH_HEAD:vision-service/probe_nsfw_yolo_artifact.py > "$WORK/probe_nsfw_yolo_artifact.py"
echo "NSFW-YOLO proef, fase 1: modelarchief downloaden en inspecteren."
echo "Alleen modelgewichten worden gedownload (maximaal 330 MiB); jouw foto's worden niet verzonden."
echo "Er wordt niets uitgepakt, getraind, uitgevoerd of in Artes gedeployed."
echo "Er wordt geen software geïnstalleerd en geen betaalde API aangeroepen."
python3 "$WORK/probe_nsfw_yolo_artifact.py" --work "$WORK"
echo
echo "Stuur dit bestand terug: $WORK/nsfw-yolo-archive-preflight.json"
