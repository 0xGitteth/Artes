# Artes: context-first sexual moderation research (October 2026)

## Decision and model due diligence

Artes policy distinguishes **visible nudity** from **actual sexual acts**, while erotic suggestion and BDSM may be allowed with appropriate 18+ presentation. The target is **lower unnecessary human-review workload without missed safety-critical cases**, not a generic porn/not-porn decision.

Reviewed public model cards on 2026-10-09:

- **LukeJacob2023/nsfw-image-detector**: Apache-2.0, ViT-base (768 hidden features), 5 classes (`drawings, hentai, neutral, porn, sexy`), ~28k original examples according to publisher. Existing Arts-specific 375-image developmental comparison used the pinned revision `852ab7f43d70bb4b9d7d62f42ffa446e85f11670`. **Selected starting encoder, not yet validated for Artes.** https://huggingface.co/LukeJacob2023/nsfw-image-detector
- **reddesert/nsfw_detection**: OpenMDW 1.0 declared; 11 categories include `bdsm`, but no independently established separate `sexual_act` / `implied_nude` categories. Dataset size claimed at 640k. Optional future comparative baseline only after additional licensing and provenance checks; no installation/inference presently. https://huggingface.co/reddesert/nsfw_detection
- **necrosyth/nsfw-detection-with-yolo**: model card lists `suggestive`, `explicit_partial`, `explicit_full`, and `sexual_act`. **Do not integrate in proprietary Artes** without addressing Ultralytics YOLOv8 AGPL/Enterprise licensing; a third-party CC-BY label is not evidence that underlying Ultralytics rights are cleared. https://huggingface.co/necrosyth/nsfw-detection-with-yolo and https://www.ultralytics.com/license
- **porntech/sex-position**: MIT declared and names several sexual acts, but model author explicitly warns outputs are **undefined for non-NSFW input**; e.g., ordinary photos can look like particular sex acts. Unsuitable alone for automated blocking on an art platform. https://huggingface.co/porntech/sex-position

Do not rely on any publisher-reported accuracy as an Artes benchmark; independently inspect licenses and data handling before production use.

## Implemented first Artes contextual training prototype

`vision-service/train_luke_artes.py` trains **three independent lightweight classifier heads**, using the frozen pretrained Luke 768-dimension CLS features: `nudity` (seven distinctions), `sexualContext` (`none`, `suggestive`, `bdsm_kink`, `explicit_act`) and separate binary `explicitAct`. This is a genuine supervised learning step on image features, **not fine-tuning the original ViT weights**; the pretrained features are reused to avoid expensive retraining. Categorical overlaps across axes are preserved.

Existing, private, human-reviewed Artes train+validation photos (375, 103 source groups) are the only input. No earlier test set is used, no external AI service, no new hosting. The pinned Luke weights are read **from local cache only**; the process intentionally aborts if missing rather than downloading new weights.

Feature extraction is resumable with private, local JSONL cache. Each of four out-of-fold developmental evaluations fits scaling, PCA and supervised heads **only on the training source groups**; the other groups are scored without seeing their labels in the fold. A final research-only JSON head artifact is trained using all development samples and remains in the ignored local temp folder. The aggregate JSON provides per-class support, confusion matrices and results, including false alarms on non-explicit nude photos compared with the previously calibrated raw `porn` cutoff. These images have been researched before and are **not a fully independent untouched test**.

**Never use the JSON heads directly as a production model or decision authority.** Require new independent group-disjoint test images, label rights checks, thresholds, moderation lifecycle regression, risk-specific gates and measured full-system review rate. A photo or human body category never alone proves a sexual act. Do not auto-train based on an unverified AI label.

Run *only in the owner's existing Codespace*:

```sh
cd /workspaces/Artes
git fetch origin chatgpt/moderation-multidetector-shadow
git show FETCH_HEAD:vision-service/run_luke_artes_training.sh | bash
```

Share only: `.tmp/moderation-nsfw-pilot/luke-artes-trained-aggregate.json`.

Keep `luke-artes-private-embeddings.jsonl` and `luke-artes-heads-private.json` private. No production routes, staging config, Gemini calls, paid packages or release flags are changed by this prototype.

## After reading the first aggregate

Identify which contextual classes improve over the raw Luke scores, which have too few examples, and what types of human review cases drive actual production queue volume. Focus future, rights-eligible labeling on the weak classes, especially BDSM, implied nude and ambiguous genuine sex acts. Integrate only into staging shadow once independently tested; continue protective existing Gemini/Google Vision/nonsexual safety checks in meantime. Release decisions and rollback remain separate.
