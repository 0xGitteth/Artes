import assert from 'node:assert/strict';
import {
  ADULT_SUBJECT_ATTESTATION_RESOLVED_BY,
  buildAdultSubjectAttestationSnapshot,
  getAdultSubjectAttestationState,
  validateAdultSubjectAttestation,
} from '../src/utils/adultSubjectAttestation.js';

const facelessAdultContent = getAdultSubjectAttestationState({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
});
assert.equal(facelessAdultContent.attestationRequired, true);
assert.equal(facelessAdultContent.humanReviewRequired, false);
assert.equal(facelessAdultContent.anonymousConsentConfirmationRequired, true);
assert.equal(facelessAdultContent.resolved, false);

const facelessAdultContentErrors = validateAdultSubjectAttestation({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
});
assert.match(facelessAdultContentErrors.adultAgeConfirmation, /18 jaar of ouder/);
assert.match(facelessAdultContentErrors.anonymousSubjectConsent, /toestemming/);

const uploaderConfirmedAnonymousAdult = getAdultSubjectAttestationState({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
  allDepictedSubjects18PlusConfirmed: true,
  anonymousSubjectPublicationConsentConfirmed: true,
});
assert.equal(uploaderConfirmedAnonymousAdult.resolved, true);
assert.equal(uploaderConfirmedAnonymousAdult.resolvedBy, ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.UPLOADER_CONFIRMATION);
assert.deepEqual(validateAdultSubjectAttestation({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
  allDepictedSubjects18PlusConfirmed: true,
  anonymousSubjectPublicationConsentConfirmed: true,
}), {});

const namedAdultSubjectNeedsOnlyAgeConfirmation = getAdultSubjectAttestationState({
  credits: [{ role: 'model', name: 'Model' }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
  allDepictedSubjects18PlusConfirmed: true,
});
assert.equal(namedAdultSubjectNeedsOnlyAgeConfirmation.anonymousConsentConfirmationRequired, false);
assert.equal(namedAdultSubjectNeedsOnlyAgeConfirmation.resolved, true);

const concreteMinorConcern = getAdultSubjectAttestationState({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: true,
  allDepictedSubjects18PlusConfirmed: true,
  anonymousSubjectPublicationConsentConfirmed: true,
});
assert.equal(concreteMinorConcern.humanReviewRequired, true);
assert.equal(concreteMinorConcern.resolved, false, 'uploader attestation must never bypass a concrete minor-safety concern');
assert.equal(concreteMinorConcern.resolvedBy, ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.HUMAN_REVIEW);
assert.match(validateAdultSubjectAttestation({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: true,
  allDepictedSubjects18PlusConfirmed: true,
  anonymousSubjectPublicationConsentConfirmed: true,
}).possibleMinorConcern, /menselijke beoordeling/);

const ordinaryContent = getAdultSubjectAttestationState({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: false,
  ageNotReliablyVerifiable: true,
});
assert.equal(ordinaryContent.attestationRequired, false);
assert.equal(ordinaryContent.resolved, true);
assert.equal(ordinaryContent.resolvedBy, ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.NOT_REQUIRED);

const snapshot = buildAdultSubjectAttestationSnapshot({
  credits: [{ role: 'model', isAnonymous: true }],
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
  allDepictedSubjects18PlusConfirmed: true,
  anonymousSubjectPublicationConsentConfirmed: true,
  confirmedAt: '2026-09-05T20:00:00.000Z',
});
assert.equal(snapshot.version, 1);
assert.equal(snapshot.confirmedAt, '2026-09-05T20:00:00.000Z');

console.log('PASS adultSubjectAttestation.logic.test.mjs');
