export const ADULT_SUBJECT_ATTESTATION_REASON = Object.freeze({
  AGE_NOT_RELIABLY_VERIFIABLE: 'ageNotReliablyVerifiable',
});

export const ADULT_SUBJECT_ATTESTATION_RESOLVED_BY = Object.freeze({
  NOT_REQUIRED: 'notRequired',
  UPLOADER_CONFIRMATION: 'uploaderConfirmation',
  HUMAN_REVIEW: 'humanReview',
});

export const normalizeAdultSubjectAttestationDraftState = (source = {}) => {
  const draft = source?.adultSubjectAttestationDraft && typeof source.adultSubjectAttestationDraft === 'object'
    ? source.adultSubjectAttestationDraft
    : source?.adultSubjectAttestation && typeof source.adultSubjectAttestation === 'object'
      ? source.adultSubjectAttestation
      : source;

  return {
    allDepictedSubjects18PlusConfirmed: draft?.allDepictedSubjects18PlusConfirmed === true,
  };
};

export const buildAdultSubjectAttestationDraftState = ({
  allDepictedSubjects18PlusConfirmed = false,
} = {}) => ({
  adultSubjectAttestationDraft: {
    version: 1,
    allDepictedSubjects18PlusConfirmed: Boolean(allDepictedSubjects18PlusConfirmed),
  },
});

export const getAdultSubjectAttestationState = ({
  adultOrSexualContentPresent = false,
  ageNotReliablyVerifiable = false,
  possibleMinorConcern = false,
  allDepictedSubjects18PlusConfirmed = false,
} = {}) => {
  const humanReviewRequired = Boolean(adultOrSexualContentPresent && possibleMinorConcern);
  const attestationRequired = Boolean(
    adultOrSexualContentPresent
    && ageNotReliablyVerifiable
    && !possibleMinorConcern
  );
  const ageConfirmationResolved = !attestationRequired || Boolean(allDepictedSubjects18PlusConfirmed);
  const resolved = !humanReviewRequired && ageConfirmationResolved;

  let resolvedBy = null;
  if (humanReviewRequired) {
    resolvedBy = ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.HUMAN_REVIEW;
  } else if (!attestationRequired) {
    resolvedBy = ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.NOT_REQUIRED;
  } else if (resolved) {
    resolvedBy = ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.UPLOADER_CONFIRMATION;
  }

  return {
    reason: attestationRequired ? ADULT_SUBJECT_ATTESTATION_REASON.AGE_NOT_RELIABLY_VERIFIABLE : null,
    adultOrSexualContentPresent: Boolean(adultOrSexualContentPresent),
    ageNotReliablyVerifiable: Boolean(ageNotReliablyVerifiable),
    possibleMinorConcern: Boolean(possibleMinorConcern),
    attestationRequired,
    humanReviewRequired,
    allDepictedSubjects18PlusConfirmed: Boolean(allDepictedSubjects18PlusConfirmed),
    resolved,
    resolvedBy,
  };
};

export const validateAdultSubjectAttestation = (input = {}) => {
  const state = getAdultSubjectAttestationState(input);
  const errors = {};

  if (state.humanReviewRequired) {
    errors.possibleMinorConcern = 'Deze upload vereist menselijke beoordeling vanwege een concrete twijfel over mogelijke minderjarigheid. Een uploaderbevestiging kan deze controle niet overslaan.';
    return errors;
  }

  if (state.attestationRequired && !state.allDepictedSubjects18PlusConfirmed) {
    errors.adultAgeConfirmation = 'We kunnen de leeftijd van het model niet goed bevestigen. Bevestig dat alle afgebeelde modellen 18 jaar of ouder waren op het moment van de opname.';
  }

  return errors;
};

export const buildAdultSubjectAttestationSnapshot = (input = {}) => {
  const state = getAdultSubjectAttestationState(input);
  return {
    version: 1,
    ...state,
    confirmedAt: state.resolvedBy === ADULT_SUBJECT_ATTESTATION_RESOLVED_BY.UPLOADER_CONFIRMATION
      ? (input?.confirmedAt || null)
      : null,
  };
};
