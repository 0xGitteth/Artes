# Artes supervised moderation classifier

This service includes actual supervised training for seven nudity categories
and four sexual-context categories, using frozen DINOv2 features and two
class-balanced logistic regression heads. It does not train DINOv2 from scratch.
The implementation is an offline research probe; software tests are not photo
accuracy, and no trained photo artifact is supplied with this code.

## Training

Install CPU dependencies with `bash setup_cpu_poc.sh`. Run a preflight from this
directory, without downloading a backbone or fitting a model:

```bash
.venv/bin/python train_classifier.py \
  --dataset /absolute/path/to/batch/dataset.json \
  --selection /absolute/path/to/train-selection.json \
  --output /absolute/path/to/run
```

The trainer requires the confirmed schema-4 reviews and their broader visible
pubic-region definition. It verifies image/source hashes, labels, duplicates and
all recorded maker/scene groups. An optional hash-bound selection can omit
training images only, preserving labels and the held-out split.

The current batch needs omission of `X400561`: its unresolved leakage group
crosses train/test. This leaves 278 training candidates and the original 70
test images. The omission does not assert that the photo is a duplicate or
overturn its human label. Both heads have feasible five-fold maker separation.

Actual training additionally requires `--run` and
`--training-clearance /absolute/path/to/use-assessment.json`. The assessment
must cover each image, its exact bytes, source evidence and execution scope.
The default is `existing_workspace`; external execution requires
`--execution-scope artes_temporary_compute` and a matching assessment.
Content confirmation or a local assessment never authorizes an external upload.

A private diagnostic use assessment does not clear all personality/model rights,
verify age or enable runtime/production. Original readiness flags remain
unchanged. Public CC copyright licences do not clear all other rights; a
separate AI licence must not be assumed universally necessary. See
[CC's training guidance](https://creativecommons.org/using-cc-licensed-works-for-ai-training-2/)
and [its FAQ](https://creativecommons.org/faq/).

Fitting and choosing regularization use training makers only. Feature extraction
is checkpointed per image. Numeric JSON weights record the resolved backbone
revision and processor fingerprint; no executable pickle is loaded. Outputs:
`classifier.json`, `training-report.json`, `training-cv-predictions.json`,
`embeddings-train.jsonl`. CV used for model selection is optimistic diagnostic
data, not held-out accuracy. Probabilities are explicitly uncalibrated.

## Frozen test

After freezing the artifact:

```bash
.venv/bin/python evaluate_classifier.py \
  --dataset /absolute/path/to/batch/dataset.json \
  --selection /absolute/path/to/train-selection.json \
  --artifact /absolute/path/to/run/classifier.json \
  --evaluation-clearance /absolute/path/to/evaluation-use-assessment.json \
  --output /absolute/path/to/frozen-test --final-test
```

The test checks fitted-image, hash and maker overlaps. A lock binds checkpoint
results to the exact artifact and dataset. Evaluation needs an image-specific
use assessment with matching execution scope, independently of training permission.
Reports include class support,
confusion matrices, precision and recall. The current 70 images contain zero
explicit-act cases, so they cannot validate explicit-act detection. No test
result may be reused for tuning and then presented as a fresh held-out score.

## Service output

Start `uvicorn app:app --host 127.0.0.1 --port 8787`.
Set `ARTES_CLASSIFIER_ARTIFACT` to actual trained JSON weights. Missing settings
retain embeddings-only behavior; invalid or incompatible configured weights
fail rather than being ignored. Serving shares training's EXIF handling,
preprocessing, normalized 768-dimensional CLS features and backbone revision.

`POST /v1/infer` returns embeddings and optional `headPredictions`, including
labels, class probabilities and unassessed safety fields. `detectorResult`
remains null: two experimental heads cannot attest to injury, coercion or age
and do not satisfy the full Artes detector safety contract. Negative safety
flags must not be invented. The service does not decide access or publish an
image. App routing awaits independently measured quality, calibration, required
safety evidence and the Artes policy mapping.

Inference decodes images in memory and does not retain requests for training.

## Verification

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Tests cover fitting/export/inference compatibility, maker separation, held-out
isolation, invalid weights and execution-scope enforcement. Synthetic vectors
are not additional photos or evidence of classification accuracy.
