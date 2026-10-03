# Artes custom moderation vision service

Implementation candidate for staging. Production still uses its existing runtime unless explicitly migrated. A trained, benchmarked detector and an approved hosted endpoint are required before enabling automation.

## Runtime

`POST /v1/infer` accepts JPEG, PNG or WebP bytes and returns a normalized, 768-dimensional DINOv2 embedding. When an `ARTES_DETECTOR_ARTIFACT` is installed, it also returns supervised labels for nudity, sexual context, injury, minor concern and seven sensitive signals. Otherwise `detectorResult` remains `null` and the custom moderation route requires review.

The model returns visual evidence. Deterministic Artes policy owns publication, 18+ categories and forbidden decisions. The service cannot return `finalOutcome`, `policyDecision` or `accessLevel`.

The Functions integration runs independent Vision calls and custom inference concurrently. Resolved moderator-example reuse skips those model calls. Gemini caches only apply in the legacy runtime; switching providers cannot reuse an older Gemini result as custom-model authority.

Service configuration:

| Variable | Purpose |
| --- | --- |
| `ARTES_DINOV2_REVISION` | Exact 40-character model commit used to extract training features. Required with a detector. |
| `ARTES_DETECTOR_ARTIFACT` | Path to the approved JSON heads. Missing classes always produce uncertainty flags. |
| `ARTES_VISION_AUTH_TOKEN` | Shared server token. Set for any hosted service; keep inference on a private network or authenticated TLS endpoint. |

Functions configuration:

| Variable | Purpose |
| --- | --- |
| `MODERATION_RUNTIME_MODE=artes_custom_vision` | Deliberately select the custom provider. |
| `ARTES_VISION_ENDPOINT` | Service base URL. |
| `ARTES_VISION_AUTH_TOKEN` | Matching service token. |
| `ARTES_VISION_TIMEOUT_MS` | Request and response-body deadline, default 15 seconds. |
| `ARTES_VISION_RELEASE_JSON` | Server-controlled release approval, bound to model, dataset, label and policy versions. |

The service warms an installed detector and its embedding model before accepting requests. Invalid artifacts fail startup. Missing/invalid responses, version mismatches, unsupported labels, possible minor concern, out-of-support embeddings and below-threshold predictions require review. Current sensitive labels lack encouragement/instruction and total-impact semantics, so those cases also require review.

## Training and independent evaluation

`functions/moderationTrainingExport.js` joins approved learning records, a frozen group manifest and features tied to the exact image hash/model revision. It rejects research-only previews, benchmark-only rows, revoked assets, uncertainty flags and any image/source/semantic group crossing split boundaries. Export does not mutate the original human labels or reassign the frozen holdout.

The export has `schemaVersion: 1`, `labelVersion: artes_detector_v1`, `datasetVersion`, `embedding: {modelId, revision, dimension}` and `items`. Each item includes the original approval/provenance fields plus `datasetSplit`, `datasetSplitFinal: true`, `leakageGroupId` and `embeddingVector`. The trainer also accepts approved local `imagePath` values instead of vectors; these must be inside the dataset directory and match `sourceFingerprintSha256`.

Run one training/evaluation job on approved input:

```bash
python vision-service/train_detector.py --dataset approved-dataset/dataset.json --output-dir detector-output
```

Install CPU PyTorch and `requirements-training.txt` in an isolated environment first, or use the `Train approved moderation detector` GitHub Actions workflow after this workflow has been registered on the default branch. That workflow consumes an existing approved dataset artifact and produces the three outputs without Codespaces transfers:

- `detector.json`: JSON linear heads and calibrated embedding support. No pickle/code loading.
- `benchmark.json`: missing label coverage, independent-group errors, critical misses, confidence thresholds and manual-review rate.
- `release-candidate.json`: version-bound release metadata, always `approved: false`.

Only the training split fits weights. Validation chooses score scaling, support and thresholds. The untouched test split measures release suitability. Correlated examples count as one group; a group only succeeds if all automated labels in it are correct. Runtime requires a validated per-category threshold, at least 100 held-out automated examples and 20 independent groups, zero critical misses and a 95% Wilson precision lower bound of at least 0.99. These are conservative release gates, not an accuracy claim. For example, 100 perfect independent cases do not pass the statistical gate.

Review the independent benchmark and hosting/retention/cost decision before approving a candidate. Research curation alone does not approve image rights, training retention or production promotion. Keep approved training inputs and derived artifacts within the authorized training environment.

## Checks

```bash
npm run test:moderation-intelligence
python -m pip install -r vision-service/requirements-test.txt
python -m unittest discover -s vision-service -p 'test_*.py' -v
```

The GitHub checks run backend regressions, Python contract/training tests, lint and build automatically. Tests use synthetic embeddings and mock DINO feature extraction; they do not download a base model or establish real-image accuracy. The deployed model must still pass independent image benchmarks.

Images are decoded in memory for inference and are not retained by this endpoint. Training retention remains a separate approved data lifecycle.
