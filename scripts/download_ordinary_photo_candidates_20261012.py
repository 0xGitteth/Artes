#!/usr/bin/env python3
"""Append ordinary creative photographs as negative-control review candidates.

Read-only with respect to existing image bytes, human reviews, and any
model training assets. Gallery source tags are NOT moderation labels.
"""
import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path.cwd() if __file__ == "<stdin>" else Path(__file__).resolve().parents[1]
DEFAULT_CATALOG = ROOT / ".tmp/moderation-research-discovery/ordinary-photo-candidates-20261012.json"
DEFAULT_FOLDER = ROOT / ".tmp/moderation-research-discovery/public-photo-candidates-20261010"
MAX_BYTES = 12 * 1024 * 1024

def actual_extension(data):
    if data.startswith(b"\xff\xd8\xff"): return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"): return ".png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP": return ".webp"
    return None

def get(item):
    url = item["image_url"]
    if not url.startswith("https://burst.shopifycdn.com/photos/"):
        return item, None, "unknown_source"
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; ArtesOfflineResearch/1.0)",
        "Accept": "image/jpeg,image/webp,image/png,image/*;q=0.8",
    })
    try:
        with urlopen(request, timeout=28) as response:
            size = int(response.headers.get("Content-Length") or 0)
            if size > MAX_BYTES:
                return item, None, "too_large"
            data = response.read(MAX_BYTES + 1)
        extension = actual_extension(data)
        if extension is None or not 2048 <= len(data) <= MAX_BYTES:
            return item, None, "invalid_or_oversize_image"
        return item, (data, extension), None
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        return item, None, str(error)[:160]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--folder", type=Path, default=DEFAULT_FOLDER)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    folder = args.folder.resolve()
    manifest = folder / "unreviewed-images.jsonl"
    if not manifest.is_file():
        raise SystemExit("Existing Artes photo manifest missing. Nothing changed.")
    old = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(old) < 350:
        raise SystemExit("Original 350 images missing. Nothing changed.")

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))["candidates"]
    hashes = {entry.get("sha256") for entry in old}
    ids = {entry["id"] for entry in old}
    choices = [item for item in catalog if item["id"] not in ids]
    collected = []
    failed = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
        futures = [pool.submit(get, item) for item in choices]
        for future in as_completed(futures):
            item, image, error = future.result()
            if error:
                failed.append({"id": item["id"], "reason": error})
                continue
            data, extension = image
            digest = hashlib.sha256(data).hexdigest()
            if digest in hashes:
                failed.append({"id": item["id"], "reason": "duplicate"})
                continue
            target = folder / (item["id"] + extension)
            if target.exists():
                failed.append({"id": item["id"], "reason": "already_exists"})
                continue
            tmp = target.with_suffix(extension + ".part")
            tmp.write_bytes(data)
            os.replace(tmp, target)
            hashes.add(digest)
            collected.append({
                "id": item["id"], "collection": "ordinary_real_photography_unreviewed",
                "source_facet": item["source_facet"], "source_site": item["source_site"],
                "source_page": item["source_page"], "image_page": item["image_page"],
                "image_url": item["image_url"], "filename": str(target),
                "bytes": len(data), "sha256": digest,
                "review_label": None, "status": "candidate_unreviewed",
                "ageVerified": False,
                "note": "Ordinary photography source; no visual moderation label assigned."
            })
    collected.sort(key=lambda x: x["id"])
    if collected:
        tmp = manifest.with_suffix(".jsonl.tmp")
        with tmp.open("w", encoding="utf-8") as handle:
            for item in old + collected:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        os.replace(tmp, manifest)
    report = {
        "catalog_candidates": len(catalog), "downloaded": len(collected),
        "skipped": len(failed), "total_local_images": len(old) + len(collected),
        "by_category": {category: sum(r["source_facet"] == category for r in collected)
                         for category in sorted({x["source_facet"] for x in catalog})},
        "failures": failed,
        "detectorUsed": False, "confirmedLabels": 0,
        "existingHumanReviewsChanged": False
    }
    (folder / "ordinary-photo-download-report-20261012.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("Only unreviewed ordinary-photo candidates appended.")
if __name__ == "__main__":
    main()
