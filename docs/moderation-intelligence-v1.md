# Artes moderation intelligence v1

Status: design and implementation foundation. This work starts from PR #380 head `b11d71f641c66490b3cabedf29ad09f590c888eb` and must remain isolated from production until explicitly approved.

## Goal

Artes should treat external multimodal models as detectors and infrastructure, not as the final policy authority. The target pipeline is:

1. image upload and stable fingerprinting;
2. exact/near duplicate reuse where the existing moderation lifecycle allows it;
3. semantic image embedding and retrieval of curated human examples;
4. an Artes-specific multimodal detector, initially using an eligible external/base model and later tuned or trained on Artes labels;
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

Supervised tuning/training should target concrete detection labels, not final Artes policy outcomes. The first target is the detector schema already described by moderation policy v2:

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

Initial technical candidate, subject to the provider eligibility gate below: Vertex AI `multimodalembedding@001`.

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

Splitting by example ID or SHA256 alone is insufficient because near duplicates can leak across train and test. Related/near-duplicate images must share one leakage/semantic group before splitting.

Default provisional split: 80% train, 10% validation, 10% test. The current foundation uses a deterministic cluster hash only as a safe placeholder. Before the first real training dataset, replace this with a versioned group-stratified split planner so important labels remain represented in validation/test without placing related images in different splits. A frozen golden benchmark is separate from these splits and is never used for tuning.

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

## Provider eligibility gate

The learning architecture is intentionally provider-neutral.

The current Google Cloud Service Specific Terms state that customers must not allow end users to use a Generative AI Service as part of a website/application that is directed toward or likely to be accessed by people under 18. Artes intentionally has a general non-adult area that does not require 18+ verification. Therefore:

- do not assume Gemini is eligible as the production detector for uploads from general/unverified users;
- do not expand the existing Gemini production path until this use case has been clarified against the applicable Google Cloud terms;
- Gemini supervised fine-tuning is a conditional implementation option, not an architectural dependency;
- confirm whether `multimodalembedding@001` is subject to the same age restriction before using it in the under-18-capable production path;
- staging provider experiments should use administrator-supplied/authorized test data rather than silently routing production user data into a new service path;
- if Google does not permit this use, keep the same detector/retrieval/policy interfaces and replace the provider layer with an eligible non-generative/custom model path.

Google's Generative AI Prohibited Use Policy also covers sexually explicit activity. It does not clearly document whether a safety/moderation supervised-tuning dataset containing explicit adult sexual images is accepted. Before collecting or uploading an explicit tuning corpus, confirm this with Google or perform only a policy-compliant minimal staging acceptance test after the provider terms question is resolved.

## Model training plan

Vertex AI currently supports supervised image tuning for Gemini 2.5 Flash and `europe-west4` is a supported tuning endpoint. This is technically suitable for an Artes detector, but it remains conditional on the provider eligibility gate above.

Provider-neutral training sequence:

1. build a curated candidate dataset from `moderationExamples`;
2. create leakage/semantic groups and a frozen group-stratified split;
3. freeze golden benchmark v1;
4. evaluate the current detector baseline;
5. export only `trainingReady` examples to the selected training format/storage;
6. if the provider gate is satisfied, run one small supervised-tuning/training job in the staging environment only;
7. evaluate the new model on validation, held-out test, and golden benchmark;
8. reject the model if any critical safety metric regresses even when average accuracy improves;
9. run staging shadow evaluation before allowing the model to influence routing;
10. only after explicit approval, promote a model version to production.

Moderator corrections are accumulated into versioned batches. There is no immediate online learning from one click.

## Runtime rollout phases

### Phase 0: foundation

No runtime behavior change. Build candidate/curation schema, privacy boundary, deterministic grouping/split foundation, tests, provider guard, and architecture docs.

### Phase 1: semantic retrieval in staging

After the provider gate is resolved, generate embeddings for a small hand-labeled staging set, create a vector index, retrieve top-k examples, and log retrieval quality. Do not change moderation outcomes.

### Phase 2: semantic evidence shadow mode

Run embedding retrieval alongside the current classifier on staging uploads. Record whether human-neighbor evidence agrees with the classifier and the final moderator label.

### Phase 3: tuned/custom detector shadow mode

Train the first Artes detector and compare it with the current classifier without changing user-facing decisions.

### Phase 4: confidence-based automation

After benchmark gates are met, let the approved detector plus semantic evidence automatically resolve clear general/18+ cases. Review remains for uncertainty and serious safety conflicts.

### Phase 5: controlled model iterations

Periodically curate new moderator corrections, create a new immutable dataset version, retrain, benchmark, and promote only when it beats the currently approved version.

## Cost guardrails

- No model or embedding calls in unit tests.
- No embeddings for historic production examples until explicitly approved.
- Start with tens of curated staging images, then hundreds.
- Every batch size must be explicit in scripts.
- Training/tuning jobs are never started automatically from application code.
- Every moderation-learning cloud command must name `artes-staging` explicitly and reject `artes-media-app`.
- Before any paid tuning/training job, re-check current pricing and estimate the job from the final dataset size/epochs.

## First implementation step in this branch

Add pure moderation-learning modules and unit tests that:

- recognize which existing moderation examples are dataset candidates;
- validate the Artes detector-label schema;
- preserve taxonomy-correction learning evidence even when legacy mismatch analytics are coarse;
- require explicit curation and approved training media before `trainingReady=true`;
- assign provisional train/validation/test by semantic group;
- mark golden benchmark examples as non-trainable;
- store only media references, never image bytes;
- fail closed unless future moderation-learning cloud scripts target `artes-staging`, explicitly rejecting `artes-media-app`.

This step has no live moderation side effects and makes no Vertex AI calls.
