const ALLOWED_ADULT_CLASSIFICATIONS = new Set([
  'allowed_adult_art_nude',
  'allowed_adult_erotic_suggestive',
  'allowed_adult_sensitive_graphic',
]);

const normalizeForbiddenReason = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return String(value.reason || value.trigger || '').trim();
  return '';
};

export const hasPossibleMinorConcern = (forbiddenReasons = []) => (Array.isArray(forbiddenReasons) ? forbiddenReasons : [])
  .some((reason) => normalizeForbiddenReason(reason) === 'possible_minor_concern');

export const isAllowedAdultClassification = (classification) => ALLOWED_ADULT_CLASSIFICATIONS.has(String(classification || '').trim());

export const buildAdultSubjectAttestationInputFromModeration = ({
  classification = null,
  forbiddenReasons = [],
  credits = [],
  allDepictedSubjects18PlusConfirmed = false,
  anonymousSubjectPublicationConsentConfirmed = false,
} = {}) => {
  const normalizedClassification = String(classification || '').trim();
  const allowedAdultContent = isAllowedAdultClassification(normalizedClassification);
  const disallowedSexualExplicit = normalizedClassification === 'disallowed_sexual_explicit';
  const possibleMinorConcern = hasPossibleMinorConcern(forbiddenReasons);

  return {
    credits,
    adultOrSexualContentPresent: Boolean(allowedAdultContent || disallowedSexualExplicit || possibleMinorConcern),
    // Until Artes has verified age evidence for every depicted contributor, an allowed
    // adult upload is treated as requiring uploader age attestation. This avoids trying
    // to infer adulthood from a face or body shape.
    ageNotReliablyVerifiable: allowedAdultContent,
    possibleMinorConcern,
    allDepictedSubjects18PlusConfirmed,
    anonymousSubjectPublicationConsentConfirmed,
  };
};

export const shouldBlockAdultSubjectAttestationForModeration = ({ classification = null } = {}) => (
  String(classification || '').trim() === 'disallowed_sexual_explicit'
);
