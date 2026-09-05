import assert from 'node:assert/strict';
import {
  ADULT_SUBJECT_ATTESTATION_RESOLVED_BY,
  buildAdultSubjectAttestationDraftState,
  buildAdultSubjectAttestationSnapshot,
  getAdultSubjectAttestationState,
  normalizeAdultSubjectAttestationDraftState,
  validateAdultSubjectAttestation,
} from '../src/utils/adultSubjectAttestation.js';

const facelessAdultContent = getAdultSubjectAttestationState({
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
});
assert.equal(facelessAdultContent.attestationRequired, true);
assert.equal(facelessAdultContent.humanReviewRequired, false);
assert.equal(facelessAdultContent.resolved, false);

const facelessAdultContentErrors = validateAdultSubjectAttestation({
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
});
assert.match(facelessAdultContentErrors.adultAgeConfirmation, /18 jaar of ouder/);
assert.equal(facelessAdultContentErrors.anonymousSubjectConsent, undefined, 'current age attestation does not invent off-platform contributor consent');

const uploaderConfirmedAdult = getAdultSubjectAttestationState({
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
  allDepictedSubjects18PlusConfirmed: true,
});
assert.equal(uploaderConfirmedAdult.resolved, true);
assert.equal(uploaderConfirmedAdult.resolvedBy, ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.UPLOADER_CONFIRMATION);
assert.deepEqual(validateAdultSubjectAttestation({
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
  allDepictedSubjects18PlusConfirmed: true,
}), {});

const concreteMinorConcern = getAdultSubjectAttestationState({
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: true,
  allDepictedSubjects18PlusConfirmed: true,
});
assert.equal(concreteMinorConcern.humanReviewRequired, true);
assert.equal(concreteMinorConcern.resolved, false, 'uploader age attestation must never bypass a concrete minor-safety concern');
assert.equal(concreteMinorConcern.resolvedBy, ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.HUMAN_REVIEW);
assert.match(validateAdultSubjectAttestation({
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: true,
  allDepictedSubjects18PlusConfirmed: true,
}).possibleMinorConcern, /menselijke beoordeling/);

const ordinaryContent = getAdultSubjectAttestationState({
  adultOrSexualContentPresent: false,
  ageNotReliablyVerifiable: true,
});
assert.equal(ordinaryContent.attestationRequired, false);
assert.equal(ordinaryContent.resolved, true);
assert.equal(ordinaryContent.resolvedBy, ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.NOT_REQUIRED);

const snapshot = buildAdultSubjectAttestationSnapshot({
  adultOrSexualContentPresent: true,
  ageNotReliablyVerifiable: true,
  possibleMinorConcern: false,
  allDepictedSubjects18PlusConfirmed: true,
  confirmedAt: '2026-09-05T20:00:00.000Z',
});
assert.equal(snapshot.version, 1);
assert.equal(snapshot.confirmedAt, '2026-09-05T20:00:00.000Z');

const draftState = buildAdultSubjectAttestationDraftState({
  allDepictedSubjects18PlusConfirmed: true,
});
assert.deepEqual(draftState, {
  adultSubjectAttestationDraft: {
    version: 1,
    allDepictedSubjects18PlusConfirmed: true,
  },
});
assert.deepEqual(normalizeAdultSubjectAttestationDraftState(draftState), {
  allDepictedSubjects18PlusConfirmed: true,
});
assert.deepEqual(normalizeAdultSubjectAttestationDraftState({ adultSubjectAttestation: snapshot }), {
  allDepictedSubjects18PlusConfirmed: true,
});

console.log('PASS adultSubjectAttestation.logic.test.mjs');
