# Adult subject age attestation v1

## Why this exists

Artes will receive adult, nude and sexual photography where a face is cropped, hidden, turned away or intentionally anonymous. Missing facial age evidence is not itself a reason to block or reject that content, and these images must remain represented in moderation research.

Age uncertainty and a concrete minor-safety concern are separate states.

## Product rule

### 1. Adult/sexual content, age not reliably verifiable, no concrete minor concern

Publishing may continue after uploader attestation.

Required copy:

> We kunnen de leeftijd van het model niet goed bevestigen. Bevestig dat alle afgebeelde modellen 18 jaar of ouder waren op het moment van de opname.

If an anonymous subject/model is credited, additionally require:

> Bevestig dat het anonieme model toestemming heeft gegeven voor het plaatsen van deze foto.

Both confirmations are auditable upload metadata. They are not model-generated proof of age.

### 2. Concrete possible-minor concern in adult/sexual content

A positive uploader attestation MUST NOT bypass the safety concern. The upload remains subject to human safety review.

`possible_minor_concern` should require affirmative youth/minor indicators in the adult/sexual context. A hidden face, crop, rear view, anonymous subject, incomplete age evidence, or inability to estimate an exact age is not sufficient by itself.

Body shape alone must not be used as age verification or as the sole basis for a minor concern.

### 3. Non-adult, non-sexual content

No adult subject age attestation is required solely because the subject's age cannot be visually verified.

## Anonymous models and consent

Artes already supports anonymous contributor/model credits. For adult/sexual uploads where age is not reliably verifiable, an anonymous model requires both:

- uploader confirmation that all depicted models were 18+ at capture time;
- uploader confirmation that the anonymous model consented to publication.

This is separate from the existing named-contributor consent workflow.

## Research handling

For `web_research`, a public Flickr candidate is not excluded merely because the face is absent or adulthood cannot be visually proven, provided there is no concrete minor-safety concern. Flickr publication is provenance, not proof that a subject is 18+.

Research candidates with an affirmative possible-minor concern stay out of the ordinary adult research pool pending human safety review.

## Runtime integration contract

The pure logic lives in `src/utils/adultSubjectAttestation.js`.

The upload UI/moderated-upload orchestration should pass:

- `adultOrSexualContentPresent`
- `ageNotReliablyVerifiable`
- `possibleMinorConcern`
- subject credits, including `isAnonymous`
- `allDepictedSubjects18PlusConfirmed`
- `anonymousSubjectPublicationConsentConfirmed`

A concrete `possibleMinorConcern` has priority over uploader attestation.

This document does not make the research dataset training-ready or production-eligible.
