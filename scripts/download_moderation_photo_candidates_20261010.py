#!/usr/bin/env python3
"""Download public candidate photos for manual Artes moderation review.

This never edits any existing annotations, training data, or moderation code.
It skips unavailable, non-image or duplicate downloads without bypassing access restrictions.
"""
import argparse
import hashlib
import json
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "research/moderation/photo-candidates-20261010.json"
OUT = ROOT / ".tmp/moderation-research-discovery/public-photo-candidates-20261010"
LIMIT_BYTES = 12 * 1024 * 1024

def choose(items, limit):
    groups = {}
    for item in items:
        groups.setdefault(item["collection"], []).append(item)
    categories = list(groups)
    result = []
    while len(result) < limit and any(groups.values()):
        for category in categories:
            if groups[category] and len(result) < limit:
                result.append(groups[category].pop(0))
    return result

def fetch(item, output):
    url = item["image_url"]
    req = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; ArtesModerationResearch/1.0)",
        "Referer": item["source_page"],
        "Accept": "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
    })
    try:
        with urlopen(req, timeout=25) as response:
            ctype = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
            if ctype not in ("image/jpeg", "image/png", "image/webp"):
                return {"id": item["id"], "status": "skipped", "reason": "not_image", "content_type": ctype}
            ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[ctype]
            target = output / (item["id"] + ext)
            digest = hashlib.sha256()
            size = 0
            with target.open("wb") as file:
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > LIMIT_BYTES:
                        raise ValueError("image_too_large")
                    digest.update(chunk)
                    file.write(chunk)
            if size < 2048:
                target.unlink(missing_ok=True)
                return {"id": item["id"], "status": "skipped", "reason": "image_too_small"}
            return {
                "id": item["id"], "status": "downloaded", "filename": str(target),
                "bytes": size, "sha256": digest.hexdigest(),
                "collection": item["collection"], "source_page": item["source_page"],
                "image_page": item["image_page"], "image_url": url,
                "review_label": None
            }
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        (output / (item["id"] + ".jpg")).unlink(missing_ok=True)
        (output / (item["id"] + ".png")).unlink(missing_ok=True)
        (output / (item["id"] + ".webp")).unlink(missing_ok=True)
        return {"id": item["id"], "status": "skipped", "reason": str(error)[:180]}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=350)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    items = json.loads(args.catalog.read_text(encoding="utf-8"))["candidates"]
    chosen = choose(items, max(args.limit, 0))
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    gathered = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
        future_map = {pool.submit(fetch, item, out): item for item in chosen}
        for future in as_completed(future_map):
            gathered.append(future.result())
    seen = set()
    unique = []
    for record in sorted(gathered, key=lambda x: x["id"]):
        if record["status"] == "downloaded":
            if record["sha256"] in seen:
                Path(record["filename"]).unlink(missing_ok=True)
                record["status"] = "skipped"
                record["reason"] = "duplicate"
            else:
                seen.add(record["sha256"])
                unique.append(record)
    (out / "download-results.json").write_text(json.dumps(gathered, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "unreviewed-images.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in unique),
        encoding="utf-8"
    )
    n = len(unique)
    print(f"Downloaded {n} distinct images out of {len(chosen)} candidates.")
    print(f"Images and review manifest: {out}")
    print(f"Skipped: {len(chosen) - n}. Nothing was added to training or existing reviews.")

if __name__ == "__main__":
    main()
