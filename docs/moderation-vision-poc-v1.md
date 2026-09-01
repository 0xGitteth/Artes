# Artes moderation vision POC v1

Status: staging-only design. No production routing, deployment, model call, training job, or moderation outcome change is introduced by this document or its accompanying contract modules.

## First baseline

The first non-generative baseline should use DINOv2 ViT-B/14 as an image feature extractor.

POC descriptor:

- provider: `artes_custom_vision`
- model: `dinov2_vitb14`
- embedding dimension: 768
- distance: cosine
- generative: false
- usage: staging proof of concept only

The choice is deliberately behind `moderationVisionProvider.js`. Artes code must consume the provider contract rather than DINO-specific output so the backbone can be replaced after benchmarking without changing moderation policy.

## Why this baseline

The immediate POC needs a visual representation that can support both nearest-neighbor retrieval and a small supervised classifier. It does not need a generative model and it must not encode final Artes policy.

The baseline therefore has two independent outputs:

1. a fixed-size image embedding for semantic retrieval;
2. an Artes detector label produced by a downstream classifier trained against `artes_detector_v1`.

The embedding itself is not a moderation decision.

## Detector boundary

The provider/detector contract may describe only concrete image evidence:

- nudity class;
- sexual context;
- graphic injury;
- sensitive signals;
- possible minor concern;
- confidence;
- uncertainty flags.

The model result must not contain `finalOutcome`, `policyDecision`, or `accessLevel`. Those remain owned by deterministic Artes policy.

## Dataset manifest

`moderationDatasetManifest.js` creates an immutable split manifest from training-ready learning items.

Requirements:

- benchmark-only examples are excluded;
- non-training-ready examples are excluded;
- all images in one semantic/leakage cluster receive one split;
- split assignment is deterministic for a dataset version;
- balancing uses concrete detector strata rather than final `allowed/forbidden` outcomes;
- the manifest records cluster assignments and per-split stratum counts for auditability.

The manifest is the authoritative train/validation/test assignment for a model training run. The earlier per-item cluster hash remains only a provisional readiness aid and must not be used as the final training split once a manifest exists.

## First classifier experiment

Start with the frozen DINOv2 embeddings and lightweight supervised heads rather than immediately fine-tuning the backbone. Compare at least:

- nearest-neighbor retrieval quality;
- one-vs-rest logistic/linear classifiers for detector facets;
- calibrated confidence and abstention behavior;
- errors on the frozen Artes golden benchmark.

Only consider backbone fine-tuning if the frozen-feature baseline plateaus and the labeled dataset is large enough to justify it.

## Staging data sequence

1. Audit existing `moderationExamples` read-only in `artes-staging`.
2. Count eligible resolved moderator decisions and category/mismatch coverage.
3. Build a small authorized image set with explicit detector labels.
4. Generate embeddings outside the production request path.
5. Create semantic/leakage clusters.
6. Freeze dataset manifest v1.
7. Train the lightweight detector heads.
8. Evaluate against the golden benchmark and current Gemini baseline.
9. Keep all output in shadow mode until release gates are met.

No historic production media should be copied into durable training storage merely because a moderator decision exists. The privacy/retention decision remains a separate product gate.

## Release principle

A custom vision model is promoted only if it reduces unnecessary review while preserving critical forbidden-content safety and correct 18+ gating. Average accuracy alone is insufficient.
