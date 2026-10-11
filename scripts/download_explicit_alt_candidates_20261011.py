#!/usr/bin/env python3
"""Download additional public real-image research candidates from TWO independent archives.

This is image discovery only. NO classifier or pretrained moderation model is
run, NO explicit_act label is assigned, and existing reviews remain untouched.
"""
import argparse
import hashlib
import io
import json
import os
import re
import tarfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT=Path.cwd() if __file__=="<stdin>" else Path(__file__).resolve().parents[1]
FOLDER=ROOT/".tmp/moderation-research-discovery/public-photo-candidates-20261010"
SAMPLE_URL="https://huggingface.co/datasets/samo-vecto/nsfw-images/resolve/main/images.tgz?download=true"
HF_VIEWER="https://datasets-server.huggingface.co/rows"
MAX_PHOTO=12*1024*1024
MAX_TARBALL=65*1024*1024
EXCLUDE_NAME=re.compile(r"(^|[^a-z])(child|children|minor|underage|teen|lolita|schoolgirl|schoolboy)([^a-z]|$)",re.I)

def get(url,limit,timeout=32):
    req=Request(url,headers={"User-Agent":"Mozilla/5.0 (Artes research photo discovery)",
                              "Accept":"application/json,image/jpeg,image/png,image/webp,*/*"})
    with urlopen(req,timeout=timeout) as r:
        stated=int(r.headers.get("Content-Length") or "0")
        if stated>limit: raise ValueError("Download too large")
        data=r.read(limit+1)
        if len(data)>limit:raise ValueError("Download too large")
        return data

def extension(data):
    if data.startswith(b"\xff\xd8\xff"):return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):return ".png"
    if data.startswith(b"RIFF") and data[8:12]==b"WEBP":return ".webp"
    return None

def make_candidate(ident,bytes_data,origin,source_page,source_url,original_file):
    ext=extension(bytes_data)
    if ext is None or not 2048<=len(bytes_data)<=MAX_PHOTO:return None
    return {"id":ident,"bytes_data":bytes_data,"sha256":hashlib.sha256(bytes_data).hexdigest(),
            "ext":ext,"origin":origin,"source_page":source_page,"image_page":original_file,
            "image_url":source_url}

def collect_x1101(count):
    dataset="x1101/nsfw-full"
    info=[]
    for offset,amount in ((0,100),(100,26)):
        qs=urlencode({"dataset":dataset,"config":"default","split":"train","offset":offset,"length":amount})
        obj=json.loads(get(HF_VIEWER+"?"+qs,12*1024*1024,timeout=30))
        info.extend(obj.get("rows",[]))
    by_index={r.get("row_idx"):r for r in info}
    idxs=sorted({round(i*(len(by_index)-1)/max(count-1,1)) for i in range(max(0,count))})
    wants=[]
    for idx in idxs:
        entry=by_index.get(idx,{})
        link=entry.get("row",{}).get("image",{}).get("src")
        if isinstance(link,str) and link.startswith("https://datasets-server.huggingface.co/"):
            wants.append((idx,link))
    def load(pair):
        idx,link=pair
        try:
            data=get(link,MAX_PHOTO,timeout=35)
            return make_candidate("hf-x1101-"+str(idx).zfill(4),data,"hf_x1101",
              "https://huggingface.co/datasets/x1101/nsfw-full",
              link,"https://huggingface.co/datasets/x1101/nsfw-full?row="+str(idx)),None
        except (HTTPError,URLError,OSError,TimeoutError,ValueError) as err:
            return None,"x1101 "+str(idx)+": "+str(err)[:110]
    outcomes=[]
    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes=list(pool.map(load,wants))
    return [r for r,e in outcomes if r is not None],[e for r,e in outcomes if e is not None]

def collect_samo(count):
    blob=get(SAMPLE_URL,MAX_TARBALL,timeout=110)
    archive=tarfile.open(fileobj=io.BytesIO(blob),mode="r:gz")
    members=[m for m in archive.getmembers() if m.isfile() and m.size<=MAX_PHOTO
             and m.size>=2048 and m.name.lower().endswith((".jpg",".jpeg",".png",".webp"))
             and not EXCLUDE_NAME.search(m.name)]
    n=min(len(members),max(0,count))
    positions=sorted({round(i*(len(members)-1)/max(n-1,1)) for i in range(n)}) if n else []
    results=[]
    errors=[]
    for i in positions:
        item=members[i]
        ident="hf-samo-"+hashlib.sha256(item.name.encode("utf-8")).hexdigest()[:15]
        try:
            f=archive.extractfile(item)
            if f is None:continue
            data=f.read(MAX_PHOTO+1)
            result=make_candidate(ident,data,"hf_samo",
              "https://huggingface.co/datasets/samo-vecto/nsfw-images",
              SAMPLE_URL+"#"+item.name,
              "https://huggingface.co/datasets/samo-vecto/nsfw-images/tree/main")
            if result:results.append(result)
        except (OSError,ValueError) as error:
            errors.append(ident+": "+str(error)[:110])
    archive.close()
    return results,errors

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--output",type=Path,default=FOLDER)
    ap.add_argument("--x1101-limit",type=int,default=48)
    ap.add_argument("--samo-limit",type=int,default=24)
    args=ap.parse_args()
    out=args.output.resolve()
    manifest=out/"unreviewed-images.jsonl"
    if not manifest.is_file():raise SystemExit("Existing photo manifest missing. Nothing changed.")
    rows=[json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(rows)<350:raise SystemExit("Original 350 photos are missing. Nothing changed.")
    known_id={i["id"] for i in rows}
    known_sha={i.get("sha256") for i in rows}
    new=[]
    failures=[]
    for source,fn,count in (("hf_x1101",collect_x1101,args.x1101_limit),
                            ("hf_samo",collect_samo,args.samo_limit)):
        try:
            sampled,errors=fn(count)
            failures.extend(errors)
            for item in sampled:
                if item["id"] in known_id or item["sha256"] in known_sha:continue
                filename=out/(item["id"]+item["ext"])
                if filename.exists():continue
                tmp=filename.with_suffix(filename.suffix+".part")
                tmp.write_bytes(item["bytes_data"])
                os.replace(tmp,filename)
                known_id.add(item["id"]);known_sha.add(item["sha256"])
                new.append({
                    "id":item["id"],"collection":"explicit_alt_source_unverified",
                    "source_site":source,"source_page":item["source_page"],
                    "image_page":item["image_page"],"image_url":item["image_url"],
                    "filename":str(filename),"sha256":item["sha256"],
                    "bytes":len(item["bytes_data"]),"review_label":None,
                    "status":"candidate_unreviewed","ageVerified":False,
                    "note":"Source is unverified for explicit_act; manual inspection required."
                })
        except (HTTPError,URLError,OSError,TimeoutError,ValueError,tarfile.TarError,KeyError,TypeError) as error:
            failures.append(source+": "+str(error)[:180])
    if new:
        temp=manifest.with_suffix(".jsonl.tmp")
        with temp.open("w",encoding="utf-8") as f:
            for row in rows+new:f.write(json.dumps(row,ensure_ascii=False)+"\n")
        os.replace(temp,manifest)
    report={"added":len(new),"bySource":{src:sum(x["source_site"]==src for x in new)
                 for src in ("hf_x1101","hf_samo")},
            "failed":failures,"newTotal":len(rows)+len(new),
            "detectorLabelsApplied":0,"existingHumanReviewsChanged":False,
            "reviewRequired":True}
    (out/"explicit-alt-download-report-20261011.json").write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))
    print("All imported images are unreviewed. No explicit_act labels are assumed.")
if __name__=="__main__":
    main()
