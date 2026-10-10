#!/usr/bin/env python3
"""Download independent real-photo candidates for manual Artes moderation review.

No classification models, no training writes, no changes to existing 350 review
decisions. GitHub public example pictures are only a discovery hint, not labels.
"""
import argparse
import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path.cwd() if __file__ == "<stdin>" else Path(__file__).resolve().parents[1]
FOLDER = ROOT / ".tmp/moderation-research-discovery/public-photo-candidates-20261010"
CANDIDATES = ROOT / ".tmp/moderation-research-discovery/explicit-candidates-20261010.json"
SIZE_LIMIT = 12 * 1024 * 1024

def fetch(item, folder):
    target = folder / (item["id"] + ".jpg")
    if target.exists():
        return {"ok": False, "id": item["id"], "reason": "file_exists"}
    request = Request(item["image_url"], headers={
        "User-Agent": "Mozilla/5.0 (compatible; ArtesOfflineResearch/1.0)",
        "Accept": "image/jpeg,image/*;q=0.8",
    })
    try:
        with urlopen(request, timeout=25) as response:
            length = int(response.headers.get("Content-Length") or 0)
            if length > SIZE_LIMIT:
                return {"ok":False, "id":item["id"], "reason":"oversized"}
            content_type = response.headers.get("Content-Type","").split(";")[0].lower()
            if content_type not in ("image/jpeg","application/octet-stream"):
                return {"ok":False, "id":item["id"], "reason":"not_jpeg"}
            data = response.read(SIZE_LIMIT + 1)
        if not (2048 <= len(data) <= SIZE_LIMIT and data[:3] == b"\xff\xd8\xff"):
            return {"ok":False, "id":item["id"], "reason":"invalid_jpeg"}
        return {"ok":True, "item":item, "data":data, "sha256":hashlib.sha256(data).hexdigest()}
    except (HTTPError, URLError, OSError, TimeoutError) as error:
        return {"ok":False, "id":item["id"], "reason":str(error)[:160]}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--catalog",type=Path,default=CANDIDATES)
    ap.add_argument("--output",type=Path,default=FOLDER)
    ap.add_argument("--limit",type=int,default=108)
    ap.add_argument("--workers",type=int,default=4)
    args=ap.parse_args()
    folder=args.output.resolve()
    catalog=json.loads(args.catalog.read_text(encoding="utf-8"))
    original_path=folder/"unreviewed-images.jsonl"
    if not original_path.exists():
        raise SystemExit("Original 350-photo manifest missing; refusing to make a new one.")
    original=[json.loads(line) for line in original_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(original) < 350:
        raise SystemExit("Original photo set incomplete; refusing to modify.")
    known_ids={item["id"] for item in original}
    known_hashes={item.get("sha256") for item in original}
    candidates=[i for i in catalog["items"] if i["id"] not in known_ids][:max(args.limit,0)]
    if not candidates:
        print("Nothing new to download; existing records remain untouched.")
        return
    folder.mkdir(parents=True,exist_ok=True)
    outcomes=[]
    with ThreadPoolExecutor(max_workers=max(1,min(args.workers,8))) as pool:
        fs=[pool.submit(fetch,item,folder) for item in candidates]
        for future in as_completed(fs):
            outcomes.append(future.result())
    new=[]
    skipped=[]
    for result in sorted(outcomes,key=lambda x:x.get("item",{}).get("id",x.get("id",""))):
        if not result["ok"]:
            skipped.append({k:v for k,v in result.items() if k not in ("data","item")})
            continue
        item=result["item"]
        digest=result["sha256"]
        if digest in known_hashes:
            skipped.append({"id":item["id"],"reason":"duplicate_bytes"})
            continue
        target=folder/(item["id"]+".jpg")
        if target.exists():
            skipped.append({"id":item["id"],"reason":"file_exists"})
            continue
        temp=target.with_suffix(".jpg.part")
        with temp.open("wb") as handle:
            handle.write(result["data"])
        os.replace(temp,target)
        known_ids.add(item["id"])
        known_hashes.add(digest)
        new.append({
            "id":item["id"],"collection":"explicit_source_unverified",
            "filename":str(target),"bytes":len(result["data"]),"sha256":digest,
            "source_page":item["source_page"],"image_page":item["image_page"],
            "image_url":item["image_url"],
            "status":"candidate_unreviewed","review_label":None,
            "humanVisualReviewRequired":True,"ageVerified":False,
            "discoveryOnly":True,
            "note":"The external source category is not an Artes content classification."
        })
    if new:
        next_manifest=folder/"unreviewed-images.jsonl.tmp"
        with next_manifest.open("w",encoding="utf-8") as handle:
            for item in original+new:
                handle.write(json.dumps(item,ensure_ascii=False)+"\n")
        os.replace(next_manifest,original_path)
    report={
        "downloaded":len(new),"skipped":len(skipped),"total":len(original)+len(new),
        "source":"public GitHub research samples","existingPhotosPreserved":len(original),
        "labelsCreated":0,"modelUsed":False,"failed":skipped[:20],
        "contactSheetGroup":"explicit_source_unverified"
    }
    (folder/"explicit-download-report.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))
    print("No images added to training or a confirmed test split.")

if __name__=="__main__":
    main()
