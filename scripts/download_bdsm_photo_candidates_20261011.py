#!/usr/bin/env python3
"""Append real BDSM/kink photography candidates from public source pages.

Research-only. No model inference, no automatic label confirmation, no
modifications to pre-existing Artes images, reviews, or training data.
"""
import argparse
import hashlib
import json
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

ROOT = Path.cwd() if __file__ == "<stdin>" else Path(__file__).resolve().parents[1]
RESEARCH = ROOT / ".tmp/moderation-research-discovery"
FOLDER = RESEARCH / "public-photo-candidates-20261010"
CATALOG = RESEARCH / "bdsm-diverse-candidates-20261011.json"
MAX_BYTES = 12 * 1024 * 1024
CAPS = {
    "ms_bondage": 15, "ms_shibari": 12, "ms_rope": 5,
    "ms_chained": 6, "rope_portfolio": 14, "rope_studio": 8,
    "rope_sessions": 4, "rope_photography": 0
}
MAGICS = [(b"\xff\xd8\xff", ".jpg"), (b"\x89PNG\r\n\x1a\n", ".png"), (b"RIFF", ".webp")]

def ext_for(data):
    for sig,ext in MAGICS:
        if data.startswith(sig):
            if ext==".webp" and data[8:12]!=b"WEBP":continue
            return ext
    return None

def download(item):
    try:
        req=Request(item["image_url"],headers={
            "User-Agent":"Mozilla/5.0 (compatible; ArtesOfflineResearch/1.0)",
            "Accept":"image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
            "Referer":item["source_page"]
        })
        with urlopen(req,timeout=28) as r:
            if int(r.headers.get("Content-Length") or "0")>MAX_BYTES:
                return item,None,"too_large"
            data=r.read(MAX_BYTES+1)
        ext=ext_for(data)
        if len(data)>MAX_BYTES or len(data)<2048 or ext is None:
            return item,None,"not_valid_photo"
        return item,(data,ext),None
    except (HTTPError,URLError,TimeoutError,OSError,ValueError) as error:
        return item,None,str(error)[:130]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--catalog",type=Path,default=CATALOG)
    ap.add_argument("--output",type=Path,default=FOLDER)
    ap.add_argument("--limit",type=int,default=64)
    ap.add_argument("--workers",type=int,default=4)
    args=ap.parse_args()
    out=args.output.resolve()
    manifest=out/"unreviewed-images.jsonl"
    if not manifest.is_file():
        raise SystemExit("Original image manifest ontbreekt, niet gewijzigd: "+str(manifest))
    original=[json.loads(x) for x in manifest.read_text(encoding="utf-8").splitlines() if x.strip()]
    if len(original)<350:
        raise SystemExit("Oorspronkelijke 350 ontbreken, niets gewijzigd.")
    registry=json.loads(args.catalog.read_text(encoding="utf-8"))
    grouped=defaultdict(list)
    for item in registry["candidates"]:
        grouped[item["source_facet"]].append(item)
    chosen=[]
    for cat, cap in CAPS.items():
        chosen.extend(grouped[cat][:cap])
    chosen=chosen[:max(0,args.limit)]
    haveids={item["id"] for item in original}
    hashes={item.get("sha256") for item in original}
    chosen=[item for item in chosen if item["id"] not in haveids]
    added=[]
    failed=[]
    with ThreadPoolExecutor(max_workers=max(1,min(8,args.workers))) as pool:
        tasks=[pool.submit(download,item) for item in chosen]
        for fut in as_completed(tasks):
            item,content,error=fut.result()
            if error:
                failed.append({"id":item["id"],"reason":error})
                continue
            data,ext=content
            digest=hashlib.sha256(data).hexdigest()
            if digest in hashes:
                failed.append({"id":item["id"],"reason":"duplicate"})
                continue
            target=out/(item["id"]+ext)
            if target.exists():
                failed.append({"id":item["id"],"reason":"already_exists"})
                continue
            temporary=target.with_suffix(ext+".part")
            temporary.write_bytes(data)
            os.replace(temporary,target)
            hashes.add(digest)
            added.append({
                "id":item["id"],"collection":"bdsm_kink_source_unreviewed",
                "source_facet":item["source_facet"],"source_site":item["source_site"],
                "source_page":item["source_page"],"image_page":item["image_page"],
                "image_url":item["image_url"],"filename":str(target),
                "bytes":len(data),"sha256":digest,"status":"candidate_unreviewed",
                "review_label":None,"ageVerified":False,
                "note":"Gallery origin is not a visual detector label. Manual inspection required."
            })
    added.sort(key=lambda x:x["id"])
    if added:
        temp=manifest.with_suffix(".jsonl.tmp")
        with temp.open("w",encoding="utf-8") as f:
            for item in original+added:f.write(json.dumps(item,ensure_ascii=False)+"\n")
        os.replace(temp,manifest)
    report={
        "sourceCandidates":len(registry["candidates"]),"chosen":len(chosen),
        "added":len(added),"skipped":len(failed),"currentTotal":len(original)+len(added),
        "modelUsed":False,"confirmedLabels":0,
        "bySource":dict((k,len([x for x in added if x["source_facet"]==k])) for k in CAPS),
        "failures":failed
    }
    (out/"bdsm-download-report-20261011.json").write_text(
        json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))
    print("Alle afbeeldingen blijven los van de definitieve trainingsdataset.")
if __name__=="__main__":
    main()
