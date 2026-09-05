# Adult subject age attestation v1

## Why this exists

Artes will receive adult, nude and sexual photography where a face is cropped, hidden, turned away or intentionally anonymous. Missing facial age evidence is not itself a reason to block or reject that content, and these images must remain represented in moderation research.

Age uncertainty, a concrete minor-safety concern and contributor publication consent are three separate concerns.

## Current product rule

### 1. Adult/sexual content, age not reliably verifiable, no concrete minor concern

Publishing may continue after uploader age attestation when Artes chooses to enable this step in the upload flow.

Required age copy:

> We kunnen de leeftijd van het model niet goed bevestigen. Bevestig dat alle afgebeelde modellen 18 jaar of ouder waren op het moment van de opname.

The confirmation is auditable upload metadata. It is not model-generated proof of age.

### 2. Concrete possible-minor concern in adult/sexual content

A positive uploader age attestation MUST NOT bypass the safety concern. The upload remains subject to human safety review.

`possible_minor_concern` should require affirmative youth/minor indicators in the adult/sexual context. A hidden face, crop, rear view, anonymous subject, incomplete age evidence, or inability to estimate an exact age is not sufficient by itself.

Body shape alone must not be used as age verification or as the sole basis for a minor concern.

### 3. Non-adult, non-sexual content

No adult subject age attestation is required solely because the subject's age cannot be visually verified.

## Contributor consent is not a current upload requirement

Artes already has first-phase contributor metadata and anonymous/off-platform contributor support, but requiring an uploader to check a box that an anonymous model consented has little product value at the current network size. Many collaborators are still outside Artes and are reached through channels such as Instagram.

Therefore current adult age attestation stays separate from contributor publication consent. There is no current requirement in this age-attestation logic for an uploader to confirm publication consent on behalf of an anonymous model.

Do not wire a separate anonymous-consent checkbox into the current upload UI merely because adult age attestation exists.

## Future contributor consent workflow

The product ambition is a native participant-consent workflow once enough photographers, models and other contributors are active on Artes.

Target behavior:

- an upload can exist in Artes while participant consent is still pending;
- visibility/publication status can remain withheld until all participants whose consent is required have accepted;
- each relevant participant receives an in-app request to accept or reject participation/publication;
- participant acceptance is stored as contributor-specific state and audit history, not as an uploader assertion;
- the existing contributor/credit infrastructure should be extended rather than duplicating identity records;
- off-platform and anonymous contributors need a pragmatic fallback until they can be represented by a claimed Artes account.

The exact roles that require acceptance, legacy-post behavior and edge cases such as editorial/street/documentary exceptions remain future product decisions. Do not prematurely make those choices part of the current upload flow.

## Future contributor controls

Later contributor-facing controls should also support at least two distinct actions:

1. **Request removal/offline action**: a depicted or credited participant can ask for a photo to be taken offline or reviewed for removal. This affects publication itself and may require a dispute/moderation flow rather than an automatic irreversible delete.
2. **Hide on my profile**: a participant can make a shared/collaborative post invisible on their own profile without necessarily removing the post globally or from the original uploader's profile.

These actions must remain separate because hiding a post from one profile is not the same as withdrawing publication consent for the post globally.

## Research handling

For `web_research`, a public Flickr candidate is not excluded merely because the face is absent or adulthood cannot be visually proven, provided there is no concrete minor-safety concern. Flickr publication is provenance, not proof that a subject is 18+.

Research candidates with an affirmative possible-minor concern stay out of the ordinary adult research pool pending human safety review.

## Runtime integration contract

The current pure age logic lives in `src/utils/adultSubjectAttestation.js` and moderation routing in `src/utils/adultSubjectAttestationRouting.js`.

The age-attestation logic only needs:

- `adultOrSexualContentPresent`
- `ageNotReliablyVerifiable`
- `possibleMinorConcern`
- `allDepictedSubjects18PlusConfirmed`

A concrete `possibleMinorConcern` has priority over uploader age attestation.

The future contributor consent workflow should be implemented separately on top of contributor identities, consent statuses, notifications and visibility state when the product is ready for it. It is intentionally not integrated into the current upload UI now.

This document does not make the research dataset training-ready or production-eligible.
