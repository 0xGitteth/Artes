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

The repository configuration supports these focused deploy commands:

```sh
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only storage
```

Do not deploy automatically from local verification unless explicitly instructed and credentials are available.

## Local validation commands used for this release check

```sh
npm install
npm run lint
npm run test
npm run test:rules
npm run test:rules:storage
node --test functions/test/*.test.js
npm run build
git diff --check
```
