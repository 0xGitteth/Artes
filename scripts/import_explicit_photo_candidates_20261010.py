#!/usr/bin/env python3
"""Import a bounded public NSFW research image archive as UNREVIEWED candidates.

Never modifies existing Artes training files or human labels. The public
archive contains 126 images, but its generic 'NSFW' label does NOT confirm
any particular image depicts an explicit sexual act or an adult subject.
"""
import argparse
import hashlib
import json
import os
import re
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path.cwd() if __file__ == "<stdin>" else Path(__file__).resolve().parents[1]
OUTPUT = ROOT / ".tmp/moderation-research-discovery/public-photo-candidates-20261010"
ARCHIVE_URL = "https://huggingface.co/datasets/x1101/nsfw-full/resolve/main/nsfw-full.zip?download=true"
SOURCE_URL = "https://huggingface.co/datasets/x1101/nsfw-full"
MAX_ARCHIVE_BYTES = 380 * 1024 * 1024
MAX_ITEM_BYTES = 12 * 1024 * 1024
EXT = {".jpg", ".jpeg", ".png", ".webp"}
SKIP_TERMS = re.compile(r"(?:^|[^a-z])(child|children|minor|underage|teen|young|schoolgirl|schoolboy)(?:[^a-z]|$)", re.I)

def atomic_write(path, content):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, default=OUTPUT)
    p.add_argument("--limit", type=int, default=80)
    p.add_argument("--archive", type=Path, help="Optional already-downloaded original ZIP; do not fetch again")
    a = p.parse_args()
    out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / "unreviewed-images.jsonl"
    if not manifest_path.exists():
        raise SystemExit("Missing initial research manifest; first download existing photo candidates.")
    existing = [json.loads(line) for line in manifest_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    hashes = set(item.get("sha256") for item in existing)
    ids = set(item.get("id") for item in existing)
    imported = []
    download_path = a.archive
    created_temp = False
    if download_path is None:
        handle, name = tempfile.mkstemp(prefix="artes-public-nsfw-", suffix=".zip", dir=str(out))
        os.close(handle)
        download_path = Path(name)
        created_temp = True
        try:
            req = urllib.request.Request(ARCHIVE_URL, headers={"User-Agent": "Mozilla/5.0 (Artes research importer)"})
            with urllib.request.urlopen(req, timeout=90) as response, download_path.open("wb") as target:
                declared = int(response.headers.get("Content-Length") or 0)
                if declared > MAX_ARCHIVE_BYTES:
                    raise ValueError("Archive exceeds allowed download size")
                downloaded = 0
                while True:
                    buf = response.read(1024 * 1024)
                    if not buf:
                        break
                    downloaded += len(buf)
                    if downloaded > MAX_ARCHIVE_BYTES:
                        raise ValueError("Archive too large")
                    target.write(buf)
        except Exception:
            download_path.unlink(missing_ok=True)
            raise
    try:
        with zipfile.ZipFile(download_path) as z:
            members = [m for m in z.infolist()
                if not m.is_dir()
                and Path(m.filename).suffix.lower() in EXT
                and m.file_size <= MAX_ITEM_BYTES
                and m.file_size >= 2048
                and not SKIP_TERMS.search(m.filename)]
            members.sort(key=lambda m: m.filename.lower())
            for member in members:
                if len(imported) >= max(a.limit, 0):
                    break
                with z.open(member) as stream:
                    data = stream.read(MAX_ITEM_BYTES + 1)
                if len(data) > MAX_ITEM_BYTES:
                    continue
                digest = hashlib.sha256(data).hexdigest()
                if digest in hashes:
                    continue
                extension = Path(member.filename).suffix.lower()
                ident = "hf126-" + hashlib.sha256(member.filename.encode("utf-8")).hexdigest()[:14]
                if ident in ids:
                    continue
                target = out / (ident + extension)
                # Image bytes are never unzipped using their untrusted archive paths.
                target.write_bytes(data)
                record = {
                    "id": ident, "status": "candidate_unreviewed",
                    "collection": "explicit_source_unverified",
                    "source_page": SOURCE_URL, "image_page": SOURCE_URL,
                    "image_url": ARCHIVE_URL + "#member=" + member.filename,
                    "filename": str(target), "bytes": len(data), "sha256": digest,
                    "review_label": None, "age_verified": False,
                    "notes": "NSFW archive candidate only; sexual activity and age NOT confirmed"
                }
                imported.append(record)
                hashes.add(digest)
                ids.add(ident)
    finally:
        if created_temp:
            download_path.unlink(missing_ok=True)
    if imported:
        atomic_write(manifest_path, "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in existing + imported))
    print(json.dumps({
        "added_candidates": len(imported),
        "total_candidates": len(existing) + len(imported),
        "group": "explicit_source_unverified",
        "destination": str(manifest_path),
        "note": "Not reviewed, not training-ready, and not labeled explicit_act"
    }, ensure_ascii=False))
if __name__ == "__main__":
    main()
