#!/usr/bin/env python3
"""Combine two independently hand-reviewed Artes suggestion sets for ONE review UI.

Never use detection models, mark training-ready, or overwrite user reviews.
"""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

ROOT=Path.cwd() if __file__=="<stdin>" else Path(__file__).resolve().parents[1]
BASE=ROOT/".tmp/moderation-research-discovery"
FOLDER=BASE/"public-photo-candidates-20261010"
EXPLICIT=BASE/"explicit-visual-prefill-20261010.json"
EXPECTED_350_SHA="469d50c2d2f8b953c26123e2be9b5488c403f4c6c9af0f008970f2cb28468955"
VALID_NUDITY={"none","underwear_swimwear","implied_nude","bare_buttocks","female_bare_breasts","genitalia","male_topless",""}
VALID_CONTEXT={"none","suggestive","bdsm_kink","explicit_act",""}
VALID_AGE={"adult_clear","skip_minor_or_age_uncertain","not_required_nonadult_nonsexual",""}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--folder",type=Path,default=FOLDER)
    p.add_argument("--explicit",type=Path,default=EXPLICIT)
    a=p.parse_args()
    folder=a.folder.resolve()
    manifest=folder/"unreviewed-images.jsonl"
    prefill=folder/"assistant-visual-prefill.json"
    if not (manifest.is_file() and prefill.is_file() and a.explicit.is_file()):
        raise SystemExit("Missing original manifest, 350-photo prefill or new visual prefill.")
    photo_rows=[json.loads(s) for s in manifest.read_text(encoding="utf-8").splitlines() if s.strip()]
    digest=hashlib.sha256("|".join(x["id"] for x in photo_rows[:350]).encode("utf-8")).hexdigest()
    if digest!=EXPECTED_350_SHA:
        raise SystemExit("Original 350-photo identity/order differs. Nothing changed.")
    old=json.loads(prefill.read_text(encoding="utf-8"))
    new=json.loads(a.explicit.read_text(encoding="utf-8"))
    if old.get("method")!="assistant_manual_visual_review" or new.get("method")!="assistant_manual_visual_review":
        raise SystemExit("Refusing nonvisual or model-generated suggestions.")
    if new.get("existingDetectorModelUsed") is not False or new.get("authoritative") is not False:
        raise SystemExit("New proposals must be independent and non-authoritative.")
    if len(new.get("items",[]))!=108:
        raise SystemExit("Expected 108 manually inspected source images.")
    original_ids={p["id"] for p in photo_rows[:350]}
    old_items=old.get("items",[])
    if len(original_ids)!=350 or not original_ids.issubset({x["id"] for x in old_items}):
        raise SystemExit("Original 350 prefill is missing or incomplete.")
    file_ids={p["id"] for p in photo_rows if p.get("collection")=="explicit_source_unverified"
              and Path(p.get("filename","")).is_file()}
    by_id={x["id"]:x for x in old_items}
    new_count=0
    skipped=0
    for item in new["items"]:
        ident=item["id"]
        if ident not in file_ids:
            skipped+=1
            continue
        if (item.get("nudity") not in VALID_NUDITY
            or item.get("sexualContext") not in VALID_CONTEXT
            or item.get("ageSafety") not in VALID_AGE):
            raise SystemExit("Invalid manual suggestion: "+ident)
        if ident not in by_id:
            by_id[ident]=item
            new_count+=1
    merged=dict(old)
    merged["items"]=list(by_id.values())
    merged["sourceSets"]=["original_350_contact_sheets","108_extra_direct_manual_visual_inspection"]
    merged["authoritative"]=False
    merged["trainingReady"]=False
    merged["humanConfirmationRequired"]=True
    merged["existingDetectorModelUsed"]=False
    merged["summary"]={
      "originalImages":350,
      "extraImagesDownloaded":len(file_ids),
      "extraVisualProposalsMerged":len([x for x in merged["items"] if x["id"] in file_ids]),
      "totalVisualProposals":len(merged["items"]),
      "missingExtraImages":skipped,
      "confirmedHumanReviews":0,
    }
    backup=folder/"assistant-visual-prefill.original-350.backup.json"
    if not backup.exists():
        shutil.copyfile(prefill,backup)
    tmp=prefill.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(merged,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    os.replace(tmp,prefill)
    print("New downloaded extra photos with manual label proposals:",len(file_ids))
    print("New proposals merged:",new_count)
    print("Total candidates with suggestions:",len(merged["items"]))
    print("Existing human review decisions unchanged. All suggestions need confirmation.")
    print("Combined review prefill:",prefill)

if __name__=="__main__":
    main()
