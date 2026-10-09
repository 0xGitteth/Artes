# Moderation shadow providers (staging only)

Status: implementation contract and wiring for #382. No provider has been activated, no model is approved and nothing in this branch deploys itself.

## Why this exists

The existing `moderationPolicy.js` and moderation lifecycle remain the **sole authority** for uploads and publication. This module collects comparison-only observations from up to three independently configured specialized vision detectors while testing in `artes-staging`. Model assertions about `finalOutcome`, `publicationState`, `accessLevel` and other policy decisions are rejected.

Use these specialized signals to compare nudity, explicit sexual acts, violence, self-harm and eating-disorder promotion; do not equate a sexual-content probability to evidence of a specific act.

**Nothing in shadow output grants permission to publish or automatically rejects an upload.** All results are server-side diagnostics only.

## Staging opt-in

Configuration is intentionally absent by default, including on production. After a service is independently reviewed and approved for the test environment, set these **server environment** variables only on `artes-staging`:

- `ARTES_SHADOW_ENABLED=true`
- `ARTES_SHADOW_PROVIDERS_JSON=[{"id":"nsfw","endpoint":"https://approved-nsfw-service.example","tokenEnv":"ARTES_SHADOW_TOKEN_NSFW"},{"id":"safety","endpoint":"https://approved-safety-service.example","tokenEnv":"ARTES_SHADOW_TOKEN_SAFETY"}]`
- `ARTES_SHADOW_TOKEN_NSFW` and `ARTES_SHADOW_TOKEN_SAFETY` as secrets, if the providers require bearer authentication.
- Optional `ARTES_SHADOW_TIMEOUT_MS=2500` per-provider limit, clamped to 500–5000 milliseconds.

Provider endpoints must be HTTPS. These are examples, not activated or approved URLs. Request routing is server-side only; clients cannot supply or override provider URLs or tokens. Do not enable without vendor data-handling review, specifically the handling/retention of sensitive uploads and locations of processing.

Each configured endpoint must implement `POST /v1/signals` with:

```json
{
  "contractVersion": 1,
  "image": { "mimeType": "image/jpeg", "base64": "<base64 encoded bytes>" },
  "requestedOutputs": ["signals"]
}
```

Response (example based on synthetic data):

```json
{
  "contractVersion": 1,
  "providerId": "nsfw",
  "modelVersion": "model-v1",
  "uncertain": false,
  "signals": [
    { "type": "sexual_suggestive", "confidence": 0.9 },
    { "type": "nudity", "confidence": 0.7 }
  ]
}
```

Allowed signal types are exported as `SHADOW_SIGNAL_TYPES` by `functions/moderationShadowProviders.js`. Scores must be finite numbers in [0, 1]. Unknown categories, invalid responses, policy-owned fields and provider mismatches are rejected. These categories are **observations**, not final Artes labels.

## First local specialized model: NSFW Detection 2 Mini

Implementation: \`vision-service/nsfw_shadow.py\` and the existing FastAPI service's optional \`POST /v1/signals\` route. This reuses the **existing** vision-service container/process. No paid API, no separate cloud service, no model download in automated tests, and no new mandatory runtime dependency.

- Upstream model: https://huggingface.co/viddexa/nsfw-detection-2-mini
- Model weights license as declared by publisher: Apache-2.0. Keep attribution/license obligations and check dependencies before deployment.
- Five source categories: \`Normal\`, \`Porn\`, \`Hentai\`, \`Drawing\`, \`Sexy\`. **The \`Porn\` category is NOT proof of a visible sexual act**, and the model's published F1 is not an Artes-specific accuracy estimate.
- It returns five raw signals: \`nsfw_normal_category\`, \`nsfw_porn_category\`, \`nsfw_hentai_category\`, \`nsfw_drawing_category\`, \`nsfw_sexy_category\`. None maps to \`sexual_explicit\` or directly to a publication decision. Results are always marked uncalibrated/uncertain.
- CPU by default. No GPU or paid inference endpoint needed to test. Measured CPU latency, RAM and minimum hosting resources are still **unknown**; evaluate on the intended inexpensive European server size before activating.

This adapter is OFF by default. To use it **only after separate staging approval and deployment**, configure the existing vision service in staging with:

- \`ARTES_NSFW_SHADOW_ENABLED=true\`
- \`ARTES_NSFW_SHADOW_TOKEN=<random server secret>\` (mandatory; endpoint refuses unauthenticated inference even if the existing /v1/infer endpoint has no auth configured)
- \`ARTES_NSFW_MODEL_REVISION=<verified full 40-character Hugging Face commit SHA>\` (mandatory, pinned/reproducible; never \`main\`)

The existing Functions environment for \`artes-staging\` must then set \`ARTES_SHADOW_ENABLED=true\` and e.g.
\`ARTES_SHADOW_PROVIDERS_JSON=[{"id":"nsfw","endpoint":"https://<staging-vision-service-host>","tokenEnv":"ARTES_SHADOW_TOKEN_NSFW"}]\`
with \`ARTES_SHADOW_TOKEN_NSFW\` matching the service's \`ARTES_NSFW_SHADOW_TOKEN\`. The full endpoint must use approved HTTPS and no untrusted request-supplied URL.

**No live endpoint or env var has been configured by this PR.** Loading the model and downloading its weights happens only after an authenticated request reaches the explicitly enabled endpoint. The route fails closed when disabled, unpinned, unauthenticated or inference is unavailable.

The existing Python test suite verifies only the integration contract with synthetic images and mock inference. Running the real pretrained model, collecting timing/memory and benchmarking the 375 development + fresh independent test images are separate steps. Do not classify the model as production-ready merely because CI passes.

## Safety and limitations

- Only `artes-staging` and only opt-in. All other projects run zero shadow-provider calls.
- Cached evaluations and previously routeable moderator decisions are not sent to shadow providers.
- One request contacts at most three providers concurrently; timeouts, network errors, invalid JSON and response mismatches produce bounded status-only diagnostics.
- The log entry `moderation_shadow_observation` contains provider identifiers, model version, normalized signals and latency. It contains **no photo bytes, credentials, raw provider responses or URLs**. Staging server logs should have restricted access and retention. Current telemetry does not persist image-linked evaluation outcomes or establish independent benchmark performance.
- The request body does send the image bytes to configured providers. Never configure unreviewed third-party endpoints.
- A timeout can add up to five seconds in staging and must be performance-tested before broad usage.
- General image classifiers are **not** an adequate replacement for specialized CSAM handling. Known CSAM matching and suspected new CSAM need vetted authorized-provider integration, access controls, escalation and statutory procedures in a separate implementation. Do not use unvetted CSAM samples for model training.
- Do not enable automated moderation or the release gate based on these shadow signals. Fresh independent held-out benchmarks remain mandatory.

## Verification

```sh
node --test functions/test/moderationShadowProviders.test.js tests/moderationShadowIntegrationSource.test.mjs
npm run test:moderation-intelligence
```

This phase proves an isolated pluggable *mockable* adapter and staging observation wiring. It does not connect real NSFW or safety services, does not collect real benchmark metrics, and does not implement model fine-tuning.
