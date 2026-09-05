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
  allDepictedSubjects18PlusConfirmed = false,
} = {}) => {
  const normalizedClassification = String(classification || '').trim();
  const allowedAdultContent = isAllowedAdultClassification(normalizedClassification);
  const disallowedSexualExplicit = normalizedClassification === 'disallowed_sexual_explicit';
  const possibleMinorConcern = hasPossibleMinorConcern(forbiddenReasons);

  return {
    adultOrSexualContentPresent: Boolean(allowedAdultContent || disallowedSexualExplicit || possibleMinorConcern),
    // Until Artes has verified age evidence for every depicted contributor, an allowed
    // adult upload can require uploader age attestation. Contributor publication consent
    // is a separate future workflow and must not be inferred from this age confirmation.
    ageNotReliablyVerifiable: allowedAdultContent,
    possibleMinorConcern,
    allDepictedSubjects18PlusConfirmed,
  };
};

export const shouldBlockAdultSubjectAttestationForModeration = ({ classification = null } = {}) => (
  String(classification || '').trim() === 'disallowed_sexual_explicit'
);
