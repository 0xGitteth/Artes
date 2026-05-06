export const CONTRIBUTOR_CONSENT_STATUSES = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  NOT_REQUIRED: 'notRequired',
  ANONYMOUS: 'anonymous',
  PRESS_OR_STREET_EXCEPTION: 'pressOrStreetException',
});

export const MAKER_ROLE_IDS = Object.freeze([
  'photographer',
  'artist',
  'videographer',
  'retoucher',
  'art_director',
]);

export const SUBJECT_ROLE_IDS = Object.freeze([
  'model',
  'assistent',
  'fan',
]);

export const CONSENT_EXCEPTION_REASONS = Object.freeze({
  STREET: 'streetPhotography',
  PRESS: 'pressPhotography',
});

const MAKER_ROLE_SET = new Set(MAKER_ROLE_IDS);
const SUBJECT_ROLE_SET = new Set(SUBJECT_ROLE_IDS);
const CONSENT_STATUS_SET = new Set(Object.values(CONTRIBUTOR_CONSENT_STATUSES));

export const isMakerRole = (role) => MAKER_ROLE_SET.has(String(role || ''));
export const isSubjectRole = (role) => SUBJECT_ROLE_SET.has(String(role || ''));
export const isContributorConsentStatus = (status) => CONSENT_STATUS_SET.has(String(status || ''));

export const getSelfMakerRoles = (profileRoles = []) => (Array.isArray(profileRoles) ? profileRoles : [])
  .filter(isMakerRole);

export const getMakerCreditIndex = (credits = []) => (Array.isArray(credits) ? credits : [])
  .findIndex((credit) => isMakerRole(credit?.role));

export const hasMakerCredit = (credits = []) => getMakerCreditIndex(credits) >= 0;

export const hasVisibleSubjectCredit = (credits = []) => (Array.isArray(credits) ? credits : [])
  .some((credit) => isSubjectRole(credit?.role));

export const normalizeConsentException = (exception = {}) => {
  const type = Object.values(CONSENT_EXCEPTION_REASONS).includes(exception?.type) ? exception.type : '';
  const reason = String(exception?.reason || '').trim().slice(0, 500);
  const enabled = Boolean(exception?.enabled && type && reason);
  return {
    enabled,
    type: enabled ? type : null,
    reason: enabled ? reason : '',
  };
};

export const normalizeConsentCredit = (credit = {}, context = {}) => {
  const isSelf = Boolean(credit.isSelf);
  const isAnonymous = Boolean(credit.isAnonymous);
  const exception = normalizeConsentException(context.exception);
  const role = String(credit.role || '').trim();
  let consentStatus = credit.consentStatus;

  if (isAnonymous) {
    consentStatus = CONTRIBUTOR_CONSENT_STATUSES.ANONYMOUS;
  } else if (exception.enabled && !isSelf) {
    consentStatus = CONTRIBUTOR_CONSENT_STATUSES.PRESS_OR_STREET_EXCEPTION;
  } else if (isSelf) {
    consentStatus = CONTRIBUTOR_CONSENT_STATUSES.ACCEPTED;
  } else if (!consentStatus || !isContributorConsentStatus(consentStatus)) {
    consentStatus = CONTRIBUTOR_CONSENT_STATUSES.PENDING;
  }

  return {
    ...credit,
    role,
    consentStatus,
    consentRequired: consentStatus === CONTRIBUTOR_CONSENT_STATUSES.PENDING,
    consentUpdatedAt: credit.consentUpdatedAt || null,
  };
};

export const buildUploadConsent = ({ credits = [], exception = {}, aiPeoplePresent = false, subjectWarningAcknowledged = false } = {}) => {
  const normalizedException = normalizeConsentException(exception);
  const normalizedCredits = (Array.isArray(credits) ? credits : [])
    .map((credit) => normalizeConsentCredit(credit, { exception: normalizedException }));

  const makerCreditIndex = getMakerCreditIndex(normalizedCredits);

  return {
    version: 1,
    makerRoles: [...MAKER_ROLE_IDS],
    makerCreditIndex,
    consentStatuses: Object.values(CONTRIBUTOR_CONSENT_STATUSES),
    hasMaker: makerCreditIndex >= 0,
    hasVisibleSubject: hasVisibleSubjectCredit(normalizedCredits),
    aiPeoplePresent: Boolean(aiPeoplePresent),
    subjectWarningAcknowledged: Boolean(subjectWarningAcknowledged),
    exception: normalizedException,
    audit: [
      {
        action: 'uploadConsentCaptured',
        at: null,
        actor: 'uploader',
        makerCount: normalizedCredits.filter((credit) => isMakerRole(credit.role)).length,
        pendingConsentCount: normalizedCredits.filter((credit) => credit.consentStatus === CONTRIBUTOR_CONSENT_STATUSES.PENDING).length,
        exceptionType: normalizedException.type,
      },
    ],
  };
};

export const validateUploadConsent = ({ credits = [], uploaderRole = '', profileRoles = [], exception = {} } = {}) => {
  const errors = {};
  const normalizedException = normalizeConsentException(exception);
  const selfCredit = (Array.isArray(credits) ? credits : []).find((credit) => credit?.isSelf);

  if (!hasMakerCredit(credits)) {
    errors.maker = 'Voeg minstens één maker toe: fotograaf, artist, videograaf, retoucher of art director.';
  }

  if (selfCredit) {
    if (!Array.isArray(profileRoles) || !profileRoles.includes(selfCredit.role) || selfCredit.role !== uploaderRole) {
      errors.selfRole = 'Kies je eigen rol uit je profielrollen.';
    }
  }

  if (normalizedException.enabled && !normalizedException.reason) {
    errors.exception = 'Leg kort vast waarom dit straat- of persfotografie is.';
  }

  return errors;
};
