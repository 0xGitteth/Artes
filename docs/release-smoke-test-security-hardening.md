# Security hardening release smoke-test checklist

Use this checklist after the security hardening chain is deployed to a non-production environment and again before production rollout. The scope is release verification only: do not change moderation classifier behavior, UI, contributor behavior, or claim workflow behavior while running these checks.

## Authentication and adult access

- [ ] Normal verified adult login works.
- [ ] Underage or not-adult user is blocked from main app actions.
- [ ] Codex/dev login is not available in production mode.

## Uploads and Storage

- [ ] Profile photo upload works.
- [ ] Managed profile avatar upload works.
- [ ] Normal image upload still works if the app currently supports it.
- [ ] Nested uploads are denied if attempted.
- [ ] Claim proof upload works with PNG.
- [ ] Claim proof upload works with JPG.
- [ ] Claim proof upload works with WebP if UI allows it.
- [ ] Claim proof rejects non-image files.

## Firestore rules

- [ ] DM participant can read and send messages.
- [ ] Non-participant cannot read or send messages.
- [ ] Support owner can read and send support messages.
- [ ] Moderator can read support threads.
- [ ] Contributor create still works for verified adult.
- [ ] Claim request create still works for verified adult.
- [ ] Direct claim vouch Firestore writes are denied.
- [ ] `submitClaimVouch` backend route remains the intended voting path.

## Moderation

- [ ] Upload requiring review creates or opens a review case.
- [ ] Moderator queue loads.
- [ ] Moderator can approve or reject a case.
- [ ] `getModerationExamplesForCase` works for a moderator.
- [ ] `getModerationExamplesForCase` is denied for non-moderator.
- [ ] `moderationExamples` Firestore client reads remain denied.

## Public data

- [ ] `publicUsers` search does not show hidden/inactive/underage profiles.
- [ ] Discover does not show hidden/inactive/underage posts.
- [ ] Anonymous contributor remains display-only and not claimable.

## Deploy readiness notes

The repository configuration supports these focused deploy commands. Replace the project placeholder with the intended staging or production Firebase project before running any command:

```sh
firebase deploy --only functions --project <staging-or-production-project>
firebase deploy --only firestore:rules --project <staging-or-production-project>
firebase deploy --only storage --project <staging-or-production-project>
```

Do not deploy automatically from local verification unless explicitly instructed and credentials are available. Do not rely on the currently active Firebase project for release deploys. Confirm the target project before running deploy commands. The only configured project in `.firebaserc` appears to be production (`artes-media-app`), but keep the explicit `--project` flag so the release operator consciously chooses the target.

## Local validation commands used for this release check

Run these from the repository root. `npm run test` is currently the default rules-test alias for `npm run test:rules`, so keep it for parity with CI expectations but do not treat it as separate non-rules coverage.

```sh
npm install
npm --prefix functions install
npm run lint
npm run test
npm run test:rules
npm run test:rules:storage
find tests -maxdepth 1 -type f -name '*.test.mjs' ! -name '*.rules.test.mjs' -print0 | xargs -0 node --test
node --test functions/test/*.test.js
npm run build
git diff --check
```

### Additional rules tests not covered by `npm run test:rules`

`npm run test:rules` currently covers `tests/firestore.publicUsers.rules.test.mjs`, `tests/storage.profileImages.rules.test.mjs`, and `tests/storage.uploads.rules.test.mjs`. Run the additional existing Firestore rules tests explicitly:

```sh
firebase emulators:exec --only firestore "node tests/firestore.claimInvites.rules.test.mjs && node tests/firestore.moodboards.rules.test.mjs"
```
