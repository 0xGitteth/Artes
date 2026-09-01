# Artes moderation intelligence v1

Status: design and implementation foundation. This work starts from PR #380 head `b11d71f641c66490b3cabedf29ad09f590c888eb` and must remain isolated from production until explicitly approved.

## Goal

Artes should treat external multimodal models as detectors and infrastructure, not as the final policy authority. The target pipeline is:

1. image upload and stable fingerprinting;
2. exact/near duplicate reuse where the existing moderation lifecycle allows it;
3. semantic image embedding and retrieval of curated human examples;
4. an Artes-specific multimodal detector, initially Gemini-based and later supervised-tuned on Artes labels;
5. evidence fusion/calibration using the model result and relevant moderator examples;
6. deterministic Artes policy;
7. `allowed`, `18+`, `sensitive`, `18+ + sensitive`, `review`, or `forbidden` lifecycle routing.

The model must learn Artes detection semantics. It must not become the source of truth for what Artes permits.

## Current implementation assessment

### Keep

- `moderationExamples` as the audit/source-evidence collection. It already stores AI evidence, moderator decisions, corrected taxonomy, mismatch analytics, fingerprints, policy/model provenance, and moderation generation.
- The generation fence and moderation lifecycle from PR #380. Semantic learning must not reintroduce a second lifecycle authority.
- Exact SHA256 and dHash reuse for duplicate/near-duplicate identity use cases. Semantic similarity is a separate concept and must never be treated as identity.
- `composeModerationPolicyResult()` as the deterministic policy boundary. The policy layer should continue to decide publication/access outcomes from detector evidence.
- The golden-image testing concept, but expand it substantially and separate frozen benchmarks from trainable examples.

### Replace or narrow

- `fetchModerationExamplesForFingerprints()` as the main learning mechanism. SHA256/dHash remains useful for reuse, but it is not semantic learning.
- The current `finalOutcome` fallback as a notion of similarity. Two records with the same final outcome are not necessarily visually or semantically related.
- Prompt tuning as the main way to encode Artes nuance. Prompts remain useful as a contract/fallback, but repeated prompt changes should not be the primary learning loop.
- Gemini's coarse v2 detector output as the long-term target schema. Policy v2 already describes a richer future detector schema that separates nudity, sexual context, graphic injury, sensitive signals, minor concern, confidence, and uncertainty.

## Target detector schema

Supervised tuning should target concrete detection labels, not final Artes policy outcomes. The first target is the detector schema already described by moderation policy v2:

```json
{
  "nudity": "none | underwear_swimwear | implied_nude | bare_buttocks | female_bare_breasts | genitalia | male_topless",
  "sexualContext": "none | suggestive | bdsm_kink | explicit_act",
  "graphicInjury": "none | mild | graphic",
  "sensitiveSignals": [
    "bloodInjury",
    "selfHarm",
    "suicide",
    "eatingDisorder",
    "substanceDistress",
    "violence",
    "horrorScare"
  ],
  "possibleMinorConcern": false,
  "confidence": 0.0,
  "uncertaintyFlags": []
}
```

A separate policy function maps this evidence to access and moderation outcomes. This keeps future policy changes possible without retraining a model merely because an Artes access rule changes.

## Semantic retrieval

### Embedding model

Initial candidate: Vertex AI `multimodalembedding@001`.

Recommended first experiment:

- 512 dimensions;
- cosine distance;
- one embedding per moderation image;
- Firestore vector search over a server-only derived collection;
- top-k retrieval with a small k, initially 5-10;
- no similarity threshold hard-coded until calibrated on labeled data.

512 dimensions is below Firestore's vector-index limit and reduces storage/query payload relative to the 1408-dimensional default while preserving more information than 128/256. Dimension choice must be benchmarked before production use.

### Retrieval authority

Semantic neighbors are evidence, not identity and not direct moderation authority.

Rules:

- exact moderator-example reuse keeps the existing PR #380 generation/lifecycle rules;
- a single semantically similar example must never automatically make a new image forbidden;
- semantic evidence can support or weaken classifier confidence;
- strong disagreement between a model and nearby high-quality human examples should cause review or a second-stage classifier path until benchmarked thresholds justify automation;
- only curated examples with an approved detector label may influence semantic moderation;
- benchmark-only examples are never retrieved as training examples and never exported for tuning.

## Derived learning collection

Do not overload the audit collection with training lifecycle state. Keep `moderationExamples` as source evidence and derive server-only learning records into a new collection, provisionally `moderationLearningItems`.

Suggested fields:

- `schemaVersion`
- `sourceExampleId`
- `sourceFingerprintSha256`
- `policyVersion`
- `sourceModeratorAction`
- `sourceFinalOutcome`
- `sourceMismatchType`
- `candidate`
- `candidateExclusionReasons`
- `curationStatus`: `pending | approved | rejected | needs_adjudication`
- `labelVersion`
- `detectorLabel`
- `embedding.model`
- `embedding.dimension`
- `embedding.vector`
- `embedding.semanticClusterId`
- `trainingAsset.uri`
- `trainingAsset.approvedForTraining`
- `trainingAsset.retentionClass`
- `benchmarkOnly`
- `datasetSplitVersion`
- `datasetSplit`
- `trainingReady`
- `trainingReadinessReasons`

The first implementation intentionally does not persist the vector yet. It only defines the curation/readiness boundary so no existing moderation image silently becomes training material.

## Training media and privacy boundary

Current moderation preview media has an operational retention lifecycle and can be cleaned up. Training media therefore needs a separate explicit purpose and lifecycle.

Until a product/privacy decision is made, a moderator correction alone must not create a durable training copy.

A future training asset should require all of the following:

- source moderation example is resolved and eligible;
- a server-side curation step explicitly marks the asset `approvedForTraining`;
- media is copied into a dedicated staging training bucket/prefix, not reused implicitly from the preview lifecycle;
- only opaque example IDs are used in paths and exports;
- client access remains denied;
- deletion/revocation state is auditable;
- training export excludes revoked/deleted assets;
- retention period and deletion-on-account/content-removal behavior are explicitly decided before production collection starts.

## Dataset quality and leakage prevention

A production correction is a candidate example, not automatically a training example.

Training-ready requires:

1. resolved upload moderation decision;
2. stable SHA256 source binding;
3. policy version;
4. explicit curated detector label;
5. approved durable training asset;
6. semantic cluster assignment;
7. deterministic dataset split by semantic cluster.

Splitting by example ID or SHA256 alone is insufficient because near duplicates can leak across train and test. Related/near-duplicate images must share one `semanticClusterId`, and the cluster determines the split.

Default provisional split: 80% train, 10% validation, 10% test. A frozen golden benchmark is separate from this split and is never used for tuning.

## Golden benchmark

Expand the current four golden categories into a versioned frozen benchmark containing representative Artes boundaries, including at minimum:

- ordinary fashion/portrait;
- swimwear;
- ordinary boudoir/lingerie;
- erotic but fully covered imagery;
- implied nude;
- art nude with breasts/buttocks/genitalia;
- genital close-up without visible sexual act;
- BDSM/kink without explicit act;
- explicit sexual act;
- uncertainty around explicit act;
- possible-minor concern cases suitable for safe internal testing;
- each nonsexual sensitive category at general/sensitive/adult-sensitive boundaries;
- policy edge cases already documented in moderation policy v2.

Metrics must be stratified by category. Overall accuracy alone is not an acceptable release gate.

Recommended release metrics:

- forbidden-safety recall and critical miss count;
- false-forbidden rate;
- false-review rate;
- 18+ false-negative and false-positive rates;
- sensitive-warning precision/recall by trigger;
- boudoir/lingerie overrestriction rate;
- explicit-vs-borderline confusion rate;
- human review rate;
- automatic-decision rate;
- p50/p95 moderation latency;
- disagreement rate between classifier, semantic neighbors, and human benchmark labels.

## Model training plan

Vertex AI currently supports supervised image tuning for Gemini 2.5 Flash. The tuning dataset can contain image inputs and target outputs. The first tuned model should still emit the Artes detector schema above.

Training sequence:

1. build a curated candidate dataset from `moderationExamples`;
2. create semantic clusters and a frozen split;
3. freeze golden benchmark v1;
4. evaluate the current Gemini 2.5 Flash prompt baseline;
5. export only `trainingReady` examples to JSONL/GCS;
6. run one small supervised-tuning job in `artes-staging`/`europe-west4`;
7. evaluate the tuned model on validation, held-out test, and golden benchmark;
8. reject the model if any critical safety metric regresses even when average accuracy improves;
9. run staging shadow evaluation before allowing the tuned model to influence routing;
10. only after explicit approval, promote a model version to production.

Moderator corrections are accumulated into versioned batches. There is no immediate online learning from one click.

## Runtime rollout phases

### Phase 0: foundation

No runtime behavior change. Build candidate/curation schema, privacy boundary, deterministic cluster split, tests, and architecture docs.

### Phase 1: semantic retrieval in staging

Generate embeddings for a small hand-labeled staging set, create a Firestore vector index, retrieve top-k examples, and log retrieval quality. Do not change moderation outcomes.

### Phase 2: semantic evidence shadow mode

Run embedding retrieval alongside the current classifier on staging uploads. Record whether human-neighbor evidence agrees with Gemini and the final moderator label.

### Phase 3: tuned detector shadow mode

Train the first Artes detector and compare it with the current classifier without changing user-facing decisions.

### Phase 4: confidence-based automation

After benchmark gates are met, let the tuned detector plus semantic evidence automatically resolve clear general/18+ cases. Review remains for uncertainty and serious safety conflicts.

### Phase 5: controlled model iterations

Periodically curate new moderator corrections, create a new immutable dataset version, retrain, benchmark, and promote only when it beats the currently approved version.

## Cost guardrails

- No Vertex calls in unit tests.
- No embeddings for historic production examples until explicitly approved.
- Start with tens of curated staging images, then hundreds.
- Embedding generation is currently inexpensive enough for controlled experiments, but every batch size must be explicit in scripts.
- Tuning jobs are never started automatically from application code.
- Every tuning command must name `artes-staging` explicitly and reject `artes-media-app`.
- Before any paid tuning job, re-check current Vertex pricing and estimate the job from the final dataset size/epochs.

## First implementation step in this branch

Add a pure `moderationLearningDataset.js` module and unit tests that:

- recognizes which existing moderation examples are dataset candidates;
- validates the Artes detector-label schema;
- requires explicit curation and approved training media before `trainingReady=true`;
- assigns train/validation/test by semantic cluster;
- marks golden benchmark examples as non-trainable;
- stores only media references, never image bytes.

This step has no live moderation side effects and makes no Vertex AI calls.
