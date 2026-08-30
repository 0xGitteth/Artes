# Moderation v2: index wiring status

The Gemini moderation v2 classifier is implemented in `functions/geminiModerationClassifier.js`; its contract and prompt live in `functions/geminiModerationContract.js`.

## Current status

The v2 classifier is now wired into the live moderation flow in `functions/index.js`.

`functions/index.js` imports the classifier with an alias:

```js
import { runGeminiClassifier as runGeminiClassifierV2 } from './geminiModerationClassifier.js';
```

The moderation flow calls:

```js
const geminiClassifierResult = await runGeminiClassifierV2(parsed);
```

The old local `runGeminiClassifier` implementation remains in `functions/index.js` for now, but it is no longer the classifier used by this moderation path. Removing that dead legacy implementation can be done separately after this policy migration.

## Validation completed on this PR

The v2 wiring and surrounding policy/lifecycle changes have repeatedly passed the repository's expanded moderation test suite together with:

```bash
npm run test:moderation-policy
npm run lint
npm run build
git diff --check
```

The moderation test command now includes policy boundaries, Gemini contract behaviour, review regressions, uploader corrections, moderator decisions, moderation-example lookup/routing, user moderation actions, upload reuse isolation and source-level integration checks.

A read-only real-image Gemini v2 smoke runner is now available at:

```bash
npm run golden:moderation-v2:classifier
```

Its `--dry-run` mode verifies all four golden image files without making an external AI call:

```bash
npm run golden:moderation-v2:classifier -- --dry-run
```

That dry-run has been executed successfully in GitHub Actions together with the full moderation suite, lint, build and `git diff --check`.

The runner only invokes the Gemini v2 classifier. It deliberately does not call the production `moderateImage` endpoint and does not write Firestore/upload/review state.

## Runtime configuration

Before a production deployment, verify the Firebase Functions runtime configuration:

- `ENABLE_GEMINI_CLASSIFIER=true`
- whether `GEMINI_MODEL` is explicitly set
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`

If `GEMINI_MODEL` is not explicitly set, the v2 classifier defaults to `gemini-2.5-flash`.

No production deployment is part of this PR review work.

## Real-image verification

The repository contains four real-image goldens under `testing/moderation_goldens_v1/images`:

- `safe/SAFE_01.jpg`
- `boudoir/BOUDOIR_01.jpg`
- `borderline/BORDERLINE_01.jpg`
- `explicit/EXPLICIT_01.jpg`

The historical XLSX/CSV files are reference baselines, not executable tests, and still contain an older expectation for the borderline Art Nude case.

To perform the actual Gemini v2 real-image smoke run, install the Functions dependencies and run from an explicitly authenticated non-production Google Cloud environment with Vertex AI access, for example with these runtime values available:

```bash
ENABLE_GEMINI_CLASSIFIER=true
GOOGLE_CLOUD_PROJECT=<non-production-project>
GOOGLE_CLOUD_LOCATION=europe-west4
npm run golden:moderation-v2:classifier
```

The repository currently has no GitHub Actions authentication setup for Vertex AI, so the real external AI call cannot safely be performed from the existing CI without provisioning a non-production identity.

Do not use the production moderation endpoint merely to obtain a test result, because that path can create moderation/upload state.

The classifier smoke runner is not a replacement for a full live-path E2E: SafeSearch, Firestore moderation history/review lifecycle and publication are intentionally outside that script. A complete real-image live-path verification should therefore remain a controlled pre-deploy gate once a safe non-production environment is available.
