import { normalizeRoleValue } from './roles.js';
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

export const MAKER_FUNCTION_IDS = Object.freeze([
  ...MAKER_ROLE_IDS,
  'maker',
  'rightsHolder',
  'productionOwner',
]);

export const SUBJECT_ROLE_IDS = Object.freeze([
  'model',
  'assistent',
  'fan',
]);

export const CONSENT_EXCEPTION_REASONS = Object.freeze({
  STREET: 'streetPhotography',
  PRESS: 'pressPhotography',
  DOCUMENTARY: 'documentary',
});

export const VISIBLE_PERSON_PROMPT_REASONS = Object.freeze({
  MAKER_AI_VISIBLE_PERSON_NO_SUBJECT: 'makerAiVisiblePersonNoSubjectContributor',
});

export const VISIBLE_PERSON_PROMPT_RESOLVED_BY = Object.freeze({
  TAGGED_CONTRIBUTOR: 'taggedContributor',
  ANONYMOUS_CONTRIBUTOR: 'anonymousContributor',
  EXCEPTION: 'exception',
  NOT_APPLICABLE: 'notApplicable',
});

export const MISSING_MAKER_PROMPT_RESOLVED_BY = Object.freeze({
  TAGGED_CONTRIBUTOR: 'taggedContributor',
  ANONYMOUS_CONTRIBUTOR: 'anonymousContributor',
  SELF_TAGGED_MAKER: 'selfTaggedMaker',
});

const MAKER_ROLE_SET = new Set(MAKER_ROLE_IDS);
const MAKER_FUNCTION_SET = new Set(MAKER_FUNCTION_IDS);
const SUBJECT_ROLE_SET = new Set(SUBJECT_ROLE_IDS);
const CONSENT_STATUS_SET = new Set(Object.values(CONTRIBUTOR_CONSENT_STATUSES));

export const isMakerRole = (role) => MAKER_ROLE_SET.has(normalizeRoleValue(role));
export const isMakerFunction = (makerFunction) => MAKER_FUNCTION_SET.has(normalizeRoleValue(makerFunction));
export const isSubjectRole = (role) => SUBJECT_ROLE_SET.has(normalizeRoleValue(role));
export const isContributorConsentStatus = (status) => CONSENT_STATUS_SET.has(String(status || ''));

export const getSelfMakerRoles = (profileRoles = []) => (Array.isArray(profileRoles) ? profileRoles : [])
  .filter(isMakerRole);

export const getCreditMakerFunction = (credit = {}) => {
  const explicitMakerFunction = normalizeRoleValue(credit?.makerFunction);
  if (Boolean(credit?.isMaker) && isMakerFunction(explicitMakerFunction)) return explicitMakerFunction;
  const role = normalizeRoleValue(credit?.role);
  return isMakerRole(role) ? role : '';
};

export const isExplicitMakerCredit = (credit = {}) => {
  if (getCreditMakerFunction(credit)) return true;
  const role = normalizeRoleValue(credit.role);
  return Boolean(credit.isSelf && role === 'model' && credit.selfPortrait === true && credit.isMaker === true);
};

export const getMakerCreditIndex = (credits = []) => (Array.isArray(credits) ? credits : [])
  .findIndex((credit) => isExplicitMakerCredit(credit));

export const hasMakerCredit = (credits = []) => getMakerCreditIndex(credits) >= 0;

export const hasAnonymousMakerCredit = (credits = []) => (Array.isArray(credits) ? credits : [])
  .some((credit) => isExplicitMakerCredit(credit) && Boolean(credit?.isAnonymous));

export const hasValidSelfMakerCredit = ({
  credits = [],
  uploaderRole = '',
  profileRoles = [],
  selfMakerRoleConfirmed = false,
  selfMakerRole = '',
} = {}) => (Array.isArray(credits) ? credits : [])
  .some((credit) => {
    const role = normalizeRoleValue(credit?.role);
    const normalizedUploaderRole = normalizeRoleValue(uploaderRole);
    const normalizedSelfMakerRole = normalizeRoleValue(selfMakerRole);
    const normalizedProfileRoles = Array.isArray(profileRoles) ? profileRoles.map((entry) => normalizeRoleValue(entry)) : [];
    if (!credit?.isSelf || role !== normalizedUploaderRole) return false;
    if (credit.selfPortrait === true && credit.isMaker === true && role === 'model') return true;
    const makerFunction = getCreditMakerFunction({ ...credit, role });
    if (!makerFunction) return false;
    if (normalizedProfileRoles.includes(role)) return true;
    return Boolean(selfMakerRoleConfirmed && normalizedSelfMakerRole === makerFunction);
  });

export const normalizeCreditAfterRoleChange = (previousCredit = {}, nextRole = '') => {
  const role = normalizeRoleValue(nextRole);
  if (isMakerRole(role)) {
    return {
      ...previousCredit,
      role,
      isMaker: true,
      makerFunction: role,
    };
  }

  return {
    ...previousCredit,
    role,
    isMaker: false,
    makerFunction: '',
  };
};

export const hasVisibleSubjectCredit = (credits = []) => (Array.isArray(credits) ? credits : [])
  .some((credit) => isSubjectRole(credit?.role));

export const hasAnonymousVisibleSubjectCredit = (credits = []) => (Array.isArray(credits) ? credits : [])
  .some((credit) => isSubjectRole(credit?.role) && Boolean(credit?.isAnonymous));

export const normalizeConsentException = (exception = {}) => {
  const type = Object.values(CONSENT_EXCEPTION_REASONS).includes(exception?.type) ? exception.type : '';
  const reason = String(exception?.reason || '').trim().slice(0, 500);
  const enabled = Boolean(exception?.enabled && type);
  return {
    enabled,
    type: enabled ? type : null,
    reason: enabled ? reason : '',
  };
};

export const sanitizePostCreditForWrite = (credit = {}) => {
  const safeCredit = {};
  [
    'role',
    'name',
    'uid',
    'contributorId',
    'instagramHandle',
    'website',
    'isExternal',
    'isAnonymous',
    'isSelf',
    'isMaker',
    'makerFunction',
    'selfPortrait',
    'consentStatus',
    'consentRequired',
    'consentUpdatedAt',
  ].forEach((key) => {
    if (credit[key] !== undefined) safeCredit[key] = credit[key];
  });
  return safeCredit;
};

export const normalizeConsentCredit = (credit = {}, context = {}) => {
  const isSelf = Boolean(credit.isSelf);
  const isAnonymous = Boolean(credit.isAnonymous);
  const exception = normalizeConsentException(context.exception);
  const role = normalizeRoleValue(credit.role);
  const explicitMakerFunction = normalizeRoleValue(credit.makerFunction);
  const legacyMakerFunction = isMakerRole(role) ? role : '';
  const makerFunction = isMakerFunction(explicitMakerFunction) ? explicitMakerFunction : legacyMakerFunction;
  const isSelfPortraitMaker = Boolean(isSelf && role === 'model' && credit.selfPortrait === true && credit.isMaker === true);
  const isMaker = Boolean(isSelfPortraitMaker || legacyMakerFunction || (credit.isMaker && makerFunction));
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
    makerFunction: makerFunction && !isSelfPortraitMaker ? makerFunction : null,
    isMaker,
    selfPortrait: isSelfPortraitMaker ? true : Boolean(credit.selfPortrait),
    consentStatus,
    consentRequired: consentStatus === CONTRIBUTOR_CONSENT_STATUSES.PENDING,
    consentUpdatedAt: credit.consentUpdatedAt || null,
  };
};


export const getMissingMakerPromptState = ({
  credits = [],
  uploaderRole = '',
  profileRoles = [],
  missingMakerPromptShown = false,
  selfMakerRoleConfirmed = false,
  selfMakerRole = '',
} = {}) => {
  const creditList = Array.isArray(credits) ? credits : [];
  const validSelfMakerUsed = hasValidSelfMakerCredit({
    credits: creditList,
    uploaderRole,
    profileRoles,
    selfMakerRoleConfirmed,
    selfMakerRole,
  });
  const validMakerCredits = creditList.filter((credit) => {
    if (!isExplicitMakerCredit(credit)) return false;
    if (!credit?.isSelf) return true;
    const role = normalizeRoleValue(credit.role);
    const normalizedUploaderRole = normalizeRoleValue(uploaderRole);
    const normalizedSelfMakerRole = normalizeRoleValue(selfMakerRole);
    const normalizedProfileRoles = Array.isArray(profileRoles) ? profileRoles.map((entry) => normalizeRoleValue(entry)) : [];
    if (credit.selfPortrait === true && credit.isMaker === true && role === 'model') return role === normalizedUploaderRole;
    const makerFunction = getCreditMakerFunction({ ...credit, role });
    return role === normalizedUploaderRole
      && (
        normalizedProfileRoles.includes(role)
        || Boolean(selfMakerRoleConfirmed && normalizedSelfMakerRole === makerFunction)
      );
  });
  const hasResolvableMaker = validMakerCredits.length > 0;
  const anonymousMakerUsed = validMakerCredits.some((credit) => Boolean(credit?.isAnonymous));
  const shouldShowMissingMakerPrompt = !hasResolvableMaker;

  let resolvedBy = null;
  if (hasResolvableMaker) {
    if (anonymousMakerUsed) {
      resolvedBy = MISSING_MAKER_PROMPT_RESOLVED_BY.ANONYMOUS_CONTRIBUTOR;
    } else if (validSelfMakerUsed) {
      resolvedBy = MISSING_MAKER_PROMPT_RESOLVED_BY.SELF_TAGGED_MAKER;
    } else {
      resolvedBy = MISSING_MAKER_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR;
    }
  }

  return {
    missingMakerPromptShown: Boolean(missingMakerPromptShown || shouldShowMissingMakerPrompt),
    shouldShowMissingMakerPrompt,
    missingMakerPromptResolved: hasResolvableMaker,
    missingMakerResolvedBy: resolvedBy,
  };
};

export const getVisiblePersonPromptState = ({
  credits = [],
  uploaderRole = '',
  aiPeoplePresent = false,
  exception = {},
  userAcknowledgedVisiblePersonPrompt = false,
} = {}) => {
  const normalizedException = normalizeConsentException(exception);
  const makerUpload = isMakerRole(uploaderRole);
  const aiSuggestsVisiblePerson = Boolean(aiPeoplePresent);
  const promptApplies = makerUpload && aiSuggestsVisiblePerson;
  const anonymousContributorUsed = hasAnonymousVisibleSubjectCredit(credits);
  const hasSubjectContributor = hasVisibleSubjectCredit(credits);
  const visiblePersonPromptReason = promptApplies
    ? VISIBLE_PERSON_PROMPT_REASONS.MAKER_AI_VISIBLE_PERSON_NO_SUBJECT
    : null;

  let resolvedBy = null;
  if (promptApplies) {
    if (anonymousContributorUsed) {
      resolvedBy = VISIBLE_PERSON_PROMPT_RESOLVED_BY.ANONYMOUS_CONTRIBUTOR;
    } else if (hasSubjectContributor) {
      resolvedBy = VISIBLE_PERSON_PROMPT_RESOLVED_BY.TAGGED_CONTRIBUTOR;
    } else if (normalizedException.enabled) {
      resolvedBy = VISIBLE_PERSON_PROMPT_RESOLVED_BY.EXCEPTION;
    } else if (userAcknowledgedVisiblePersonPrompt) {
      resolvedBy = VISIBLE_PERSON_PROMPT_RESOLVED_BY.NOT_APPLICABLE;
    }
  }

  const visiblePersonPromptShown = promptApplies;
  const shouldShowVisiblePersonPrompt = promptApplies && !hasSubjectContributor;
  const unresolved = promptApplies && !resolvedBy;

  return {
    visiblePersonPromptShown,
    shouldShowVisiblePersonPrompt,
    visiblePersonPromptReason,
    userAcknowledgedVisiblePersonPrompt: Boolean(userAcknowledgedVisiblePersonPrompt),
    selectedExceptionReason: normalizedException.enabled ? normalizedException.type : null,
    anonymousContributorUsed,
    resolvedBy,
    unresolved,
  };
};

export const buildUploadConsent = ({
  credits = [],
  exception = {},
  aiPeoplePresent = false,
  subjectWarningAcknowledged = false,
  uploaderRole = '',
  profileRoles = [],
  visiblePersonPromptResolvedAt = null,
  missingMakerPromptShown = false,
  missingMakerPromptResolvedAt = null,
  selfMakerRoleConfirmed = false,
  selfMakerRole = '',
  selfMakerRoleConfirmedAt = null,
} = {}) => {
  const normalizedException = normalizeConsentException(exception);
  const normalizedCredits = (Array.isArray(credits) ? credits : [])
    .map((credit) => normalizeConsentCredit(credit, { exception: normalizedException }));

  const makerCreditIndex = getMakerCreditIndex(normalizedCredits);
  const missingMakerPrompt = getMissingMakerPromptState({
    credits: normalizedCredits,
    uploaderRole,
    profileRoles,
    missingMakerPromptShown,
    selfMakerRoleConfirmed,
    selfMakerRole,
  });
  const visiblePersonPrompt = getVisiblePersonPromptState({
    credits: normalizedCredits,
    uploaderRole,
    aiPeoplePresent,
    exception: normalizedException,
    userAcknowledgedVisiblePersonPrompt: subjectWarningAcknowledged,
  });

  return {
    version: 1,
    makerRoles: [...MAKER_ROLE_IDS],
    makerCreditIndex,
    consentStatuses: Object.values(CONTRIBUTOR_CONSENT_STATUSES),
    hasMaker: makerCreditIndex >= 0,
    hasVisibleSubject: hasVisibleSubjectCredit(normalizedCredits),
    aiPeoplePresent: Boolean(aiPeoplePresent),
    subjectWarningAcknowledged: Boolean(subjectWarningAcknowledged),
    visiblePersonPromptShown: visiblePersonPrompt.visiblePersonPromptShown,
    visiblePersonPromptReason: visiblePersonPrompt.visiblePersonPromptReason,
    userAcknowledgedVisiblePersonPrompt: visiblePersonPrompt.userAcknowledgedVisiblePersonPrompt,
    selectedExceptionReason: visiblePersonPrompt.selectedExceptionReason,
    anonymousContributorUsed: visiblePersonPrompt.anonymousContributorUsed,
    resolvedBy: visiblePersonPrompt.resolvedBy,
    resolvedAt: visiblePersonPrompt.resolvedBy ? visiblePersonPromptResolvedAt : null,
    missingMakerPromptShown: missingMakerPrompt.missingMakerPromptShown,
    missingMakerPromptResolved: missingMakerPrompt.missingMakerPromptResolved,
    missingMakerResolvedBy: missingMakerPrompt.missingMakerResolvedBy,
    missingMakerResolvedAt: missingMakerPrompt.missingMakerPromptResolved ? missingMakerPromptResolvedAt : null,
    selfMakerRoleConfirmed: Boolean(selfMakerRoleConfirmed),
    selfMakerRole: selfMakerRoleConfirmed ? normalizeRoleValue(selfMakerRole) : null,
    selfMakerRoleOutsideProfile: Boolean(selfMakerRoleConfirmed && normalizeRoleValue(selfMakerRole) && (!Array.isArray(profileRoles) || !profileRoles.map((entry) => normalizeRoleValue(entry)).includes(normalizeRoleValue(selfMakerRole)))),
    selfMakerRoleConfirmedAt: selfMakerRoleConfirmed ? selfMakerRoleConfirmedAt : null,
    exception: normalizedException,
    audit: [
      {
        action: 'uploadConsentCaptured',
        at: null,
        actor: 'uploader',
        makerCount: normalizedCredits.filter(isExplicitMakerCredit).length,
        pendingConsentCount: normalizedCredits.filter((credit) => credit.consentStatus === CONTRIBUTOR_CONSENT_STATUSES.PENDING).length,
        exceptionType: normalizedException.type,
        visiblePersonPromptShown: visiblePersonPrompt.visiblePersonPromptShown,
        visiblePersonPromptReason: visiblePersonPrompt.visiblePersonPromptReason,
        userAcknowledgedVisiblePersonPrompt: visiblePersonPrompt.userAcknowledgedVisiblePersonPrompt,
        selectedExceptionReason: visiblePersonPrompt.selectedExceptionReason,
        anonymousContributorUsed: visiblePersonPrompt.anonymousContributorUsed,
        resolvedBy: visiblePersonPrompt.resolvedBy,
        resolvedAt: visiblePersonPrompt.resolvedBy ? visiblePersonPromptResolvedAt : null,
        missingMakerPromptShown: missingMakerPrompt.missingMakerPromptShown,
        missingMakerPromptResolved: missingMakerPrompt.missingMakerPromptResolved,
        missingMakerResolvedBy: missingMakerPrompt.missingMakerResolvedBy,
        missingMakerResolvedAt: missingMakerPrompt.missingMakerPromptResolved ? missingMakerPromptResolvedAt : null,
        selfMakerRoleConfirmed: Boolean(selfMakerRoleConfirmed),
        selfMakerRole: selfMakerRoleConfirmed ? normalizeRoleValue(selfMakerRole) : null,
        selfMakerRoleOutsideProfile: Boolean(selfMakerRoleConfirmed && normalizeRoleValue(selfMakerRole) && (!Array.isArray(profileRoles) || !profileRoles.map((entry) => normalizeRoleValue(entry)).includes(normalizeRoleValue(selfMakerRole)))),
        selfMakerRoleConfirmedAt: selfMakerRoleConfirmed ? selfMakerRoleConfirmedAt : null,
      },
    ],
  };
};

export const validateUploadConsent = ({
  credits = [],
  uploaderRole = '',
  profileRoles = [],
  exception = {},
  aiPeoplePresent = false,
  subjectWarningAcknowledged = false,
  selfMakerRoleConfirmed = false,
  selfMakerRole = '',
} = {}) => {
  const errors = {};
  const normalizedException = normalizeConsentException(exception);
  const selfCredit = (Array.isArray(credits) ? credits : []).find((credit) => credit?.isSelf);

  if (!hasMakerCredit(credits)) {
    errors.maker = 'Er mist nog een maker. Voeg een fotograaf, videograaf, retoucher, art director of kunstenaar toe.';
  }

  if (selfCredit) {
    const selfRoleInProfile = Array.isArray(profileRoles) && profileRoles.map((entry) => normalizeRoleValue(entry)).includes(normalizeRoleValue(selfCredit.role));
    const confirmedSelfMakerForUpload = Boolean(
      selfMakerRoleConfirmed
      && normalizeRoleValue(selfMakerRole) === getCreditMakerFunction(selfCredit)
      && normalizeRoleValue(selfCredit.role) === normalizeRoleValue(uploaderRole)
      && isExplicitMakerCredit(selfCredit)
    );
    if ((!selfRoleInProfile && !confirmedSelfMakerForUpload) || normalizeRoleValue(selfCredit.role) !== normalizeRoleValue(uploaderRole)) {
      errors.selfRole = 'Kies je eigen rol uit je profielrollen of bevestig een makerrol voor deze upload.';
    }
  }

  const visiblePersonPrompt = getVisiblePersonPromptState({
    credits,
    uploaderRole,
    aiPeoplePresent,
    exception: normalizedException,
    userAcknowledgedVisiblePersonPrompt: subjectWarningAcknowledged,
  });
  if (visiblePersonPrompt.unresolved) {
    errors.visiblePersonPrompt = 'Er lijkt mogelijk een persoon zichtbaar te zijn. Kies Model toevoegen, Anoniem toevoegen, Niet van toepassing of Straat/pers uitzondering.';
  }

  return errors;
};
