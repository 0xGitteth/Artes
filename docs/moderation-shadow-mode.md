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
