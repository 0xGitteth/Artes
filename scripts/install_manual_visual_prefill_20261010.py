#!/usr/bin/env python3
"""Install hand-reviewed contact-sheet label proposals, never run any detector."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT=Path.cwd() if __file__=="<stdin>" else Path(__file__).resolve().parents[1]
FOLDER=ROOT/".tmp/moderation-research-discovery/public-photo-candidates-20261010"
EXPECTED_SHA="469d50c2d2f8b953c26123e2be9b5488c403f4c6c9af0f008970f2cb28468955"
TOKENS="""
Ia Fa Fa Fa Fa Ia Ia Ia Ia Fa Ia Ba Ia Fa Fa Ia
Fa Ba Ba Fa Ba Fa Fa Fa Fa Us Us Us Us Us Us Us
Bs Bs Us Bs Us Bs Us Us Fs Bs Fs Bs Bs Fs Bs Us
Bs Us Bs Ia Ia Fn In Fn Bs Fn Bs Ia Ia Us Us Us
Us Us Hs Us Us Us Hn Bs Us Bs Us Us Fs Fs Fs Us
Us Us Us Us Us Us Us In Mn In In Bn Hn Bn Bn Iu
Fn Mn Gn Fn Bn Fn Bn Mn Gn Gn Bn Mn Gn Mn Gn Mn
Gn Gn Gn Mn Gn ?n In Bn Gn Mn Bn Fs Gn Us Mn Mn
Mn Fn Mn Bn Gn ?n Gn Fn Mk Mn Gn Bn Bn Mn Mn Mn
Bn Mn Bn Mn Bn Mn Bn Mn Gn Gn Gn Bn Mn Mn Mn Mn
Mn Mk Bn Bn Mn Mn Mn Gn Gn Mn Mn Mn Gn Mn In Mn
Bn Bn Gn Mn Gn Gn Bn Bn Gn Gn Bn Bn Bn Bk Bn Fn
Bn Mn In Bn In Gn Gn Mn Bn Mn Bn Mn Gn Gn Bn Bn
Mn Gn Mn Bn In Gn Mn Bn Gn Bn Fn Bn Gn Bn Fn Bn
Bn Gn Gn Fn Gn Gn In Mn Mk In Gn Bn Gn Bn Mn Bn
Bn Gn Bn Gn Gn Bn Bn Bn Gn Fn Gn Fn Bn Hn In Fn
Fn Gn Gk Gn Gn Gn Gn Gn Gn Gn Gn Gn Mn Gk Gn Gn
Gn Gn In Gn Gn Gn Gn In Gn Gn Gn Gn Fn Gn Gn Gn
Bn Gn Gn Gn Gn Gn Gn Fn In Gn Gn Gn Gn Gn Fn In
Gn Gn Gn Fn In Gn Gn Gn Gn Gn Fn Gn Gn Gn Gn Gn
Gn Fn Gn Gn Fn In Gn Gn Bn Fn Fn In Gn Gn Fn Fn
Gn In In Gn Fn Bn In Bn Gn In Mn Bn Bn Gn
"""
NUDITY={"H":"none","U":"underwear_swimwear","I":"implied_nude","B":"bare_buttocks",
        "F":"female_bare_breasts","G":"genitalia","M":"male_topless"}
CONTEXT={"a":"none","n":"none","s":"suggestive","k":"bdsm_kink","u":"none"}
NOTES={96:"Age visually uncertain: check adult status before approval",
       118:"Painted/possibly non-photographic body: inspect original",
       134:"Clearly an illustration, exclude from real-photography collection",
       213:"Subject very small: check original at full resolution",
       231:"Subject very small: check original at full resolution",
       344:"Clay-covered body: confirm this is a photograph of an adult"}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--folder",type=Path,default=FOLDER)
    args=ap.parse_args()
    folder=args.folder.resolve()
    manifest=folder/"unreviewed-images.jsonl"
    if not manifest.is_file():
        raise SystemExit("Download manifest not found: "+str(manifest))
    pictures=[json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    codes=TOKENS.split()
    if len(pictures)<350 or len(codes)!=350:
        raise SystemExit("Original 350 photos missing; no files changed.")
    pictures=pictures[:350]
    sha=hashlib.sha256("|".join(p["id"] for p in pictures).encode()).hexdigest()
    if sha!=EXPECTED_SHA:
        raise SystemExit("The original 350 photos or their order changed. Refusing to mismatch labels.")
    output=folder/"assistant-visual-prefill.json"
    if output.exists():
        raise SystemExit("Prefill already exists: refusing to overwrite "+str(output))
    items=[]
    for nr,(photo,code) in enumerate(zip(pictures,codes),1):
        if len(code)!=2 or (code[0] not in NUDITY and code[0]!="?") or code[1] not in CONTEXT:
            raise SystemExit("Invalid manual label token for photo "+str(nr))
        nudity=NUDITY.get(code[0],"")
        context=CONTEXT[code[1]]
        age=("skip_minor_or_age_uncertain" if code[1]=="u" else
             "not_required_nonadult_nonsexual" if nudity=="none" and context=="none" else
             "adult_clear")
        items.append({
            "id":photo["id"],"nudity":nudity,"sexualContext":context,
            "ageSafety":"" if code[0]=="?" else age,
            "basis":"assistant_visual_review_of_contact_sheet",
            "sourceFileSha256":photo.get("sha256"),
            "thumbnailOnly":True,
            "originalReviewNeeded":nr in NOTES,
            "note":NOTES.get(nr,""),
            "reviewDisposition":("exclude_non_photographic_or_synthetic" if nr==134 else
                "inspect_original_before_decision" if nr==118 else
                "exclude_age_uncertain" if nr==96 else
                "suggested_labels_need_human_confirmation")
        })
    output.write_text(json.dumps({
        "schemaVersion":1,"method":"assistant_manual_visual_review",
        "authoritative":False,"humanConfirmationRequired":True,
        "existingDetectorModelUsed":False,"ageVerified":False,"trainingReady":False,
        "items":items
    },indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print("Installed 350 manually visually reviewed candidate records.")
    print("6 records need further original-image inspection; no labels accepted automatically.")
    print("Review suggestions: "+str(output))
    print("All previous human labels and training sets remain unchanged.")

if __name__=="__main__":
    main()
