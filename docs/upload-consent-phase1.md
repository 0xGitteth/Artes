# Upload consent phase 1

## Data model

Posts now carry upload consent metadata alongside `credits`:

- `credits[]`: contributor credits with `role`, display identity fields, and first-phase consent fields:
  - `consentStatus`: `pending`, `accepted`, `rejected`, `notRequired`, `anonymous`, or `pressOrStreetException`
  - `consentRequired`: `true` for unresolved non-self credits, otherwise `false`
  - `consentUpdatedAt`: reserved for the full workflow
- `uploadConsent`: auditable upload-level consent snapshot:
  - `version: 1`
  - `makerRoles`: maker role allowlist used at upload time
  - `consentStatuses`: status allowlist used at upload time
  - `hasMaker`: upload validation result that at least one maker credit exists
  - `hasVisibleSubject`: whether a model/subject-style credit was tagged
  - `aiPeoplePresent`: AI signal that people may be visible; this is not an identity claim
  - `subjectWarningAcknowledged`: uploader acknowledgement when AI suggests people but no subject is tagged
  - `exception`: optional street/press exception (`enabled`, `type`, `reason`)
- `consentAudit[]`: append-only style audit entries for first-phase capture.
- `consentException`: denormalized street/press exception for query/review convenience.

Claimed temporary contributors can create `contributorContentRequests` with `requestType` of `remove`, `hide`, or `correction`.

## Role mapping

Maker role allowlist is based on existing profile roles:

- `photographer`
- `artist`
- `videographer`
- `retoucher`
- `art_director`

This means model + MUA alone is not enough. A self maker credit is only offered when the uploader has one of the maker roles on their own profile.

## Upload validation

Phase 1 blocks publishing when no maker credit exists. It also validates that the uploader's self credit role comes from their own profile roles.

If AI says people may be present and no model/subject-style credit is present, the UI warns the uploader and requires acknowledgement or tagging before publishing. The AI signal must not make identity claims.

Street and press exceptions do not block publishing by default, but the uploader must record a reason and the reason is stored with the audit data.

## Firestore rules impact

Post creates/updates that pass moderation now also need first-phase consent metadata:

- `credits` must be a non-empty list.
- `uploadConsent.version` must be `1`.
- `uploadConsent.hasMaker` must be `true`.
- `uploadConsent.makerRoles` must include the first-phase maker allowlist.
- `uploadConsent.consentStatuses` must include all supported first-phase statuses.
- `consentAudit` must be a non-empty list.

Claimed contributor content requests are writeable only by the UID that claimed the contributor profile; moderators can read/update them.

## Open follow-up list for full consent workflow

1. Send and track contributor consent invitations for every pending non-self credit.
2. Build accepted/rejected consent screens and notifications for claimed contributors.
3. Let moderators review `pressOrStreetException` reasons and convert them to `notRequired`, `pending`, or `rejected` where needed.
4. Add immutable server-side audit appends for consent status changes.
5. Backfill legacy posts with a migration path and moderator review queue for missing makers.
6. Add richer visible-subject roles or an explicit `subject` role if product wants non-model subjects to be tagged separately.
7. Add contributor-facing bulk actions after claim for correction/hide/remove requests across multiple posts.
8. Add UI for uploader remediation when a contributor rejects consent after publication.
