import { Timestamp } from 'firebase-admin/firestore';

const CONSENT_EXCEPTION_TYPES = new Set([
  'streetPhotography',
  'pressPhotography',
  'documentary',
]);

const MAKER_ROLE_IDS = Object.freeze([
  'photographer',
  'artist',
  'videographer',
  'retoucher',
  'art_director',
]);

const MAKER_FUNCTION_IDS = new Set([
  ...MAKER_ROLE_IDS,
  'maker',
  'rightsHolder',
  'productionOwner',
]);

const CONSENT_STATUS_IDS = Object.freeze([
  'pending',
  'accepted',
  'rejected',
  'notRequired',
  'anonymous',
  'pressOrStreetException',
]);


const PUBLIC_CREDIT_FIELDS = Object.freeze([
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
]);


const PUBLIC_UPLOAD_CONSENT_FIELDS = Object.freeze([
  'version',
  'makerRoles',
  'makerCreditIndex',
  'consentStatuses',
  'hasMaker',
  'hasVisibleSubject',
  'aiPeoplePresent',
  'subjectWarningAcknowledged',
  'visiblePersonPromptShown',
  'visiblePersonPromptReason',
  'userAcknowledgedVisiblePersonPrompt',
  'selectedExceptionReason',
  'anonymousContributorUsed',
  'resolvedBy',
  'resolvedAt',
  'missingMakerPromptShown',
  'missingMakerPromptResolved',
  'missingMakerResolvedBy',
  'missingMakerResolvedAt',
  'selfMakerRoleConfirmed',
  'selfMakerRole',
  'selfMakerRoleOutsideProfile',
  'selfMakerRoleConfirmedAt',
]);

const PUBLIC_CONSENT_AUDIT_FIELDS = Object.freeze([
  'action',
  'at',
  'actor',
  'makerCount',
  'pendingConsentCount',
  'exceptionType',
  'visiblePersonPromptShown',
  'visiblePersonPromptReason',
  'userAcknowledgedVisiblePersonPrompt',
  'selectedExceptionReason',
  'anonymousContributorUsed',
  'resolvedBy',
  'resolvedAt',
  'missingMakerPromptShown',
  'missingMakerPromptResolved',
  'missingMakerResolvedBy',
  'missingMakerResolvedAt',
  'selfMakerRoleConfirmed',
  'selfMakerRole',
  'selfMakerRoleOutsideProfile',
  'selfMakerRoleConfirmedAt',
]);

const ALLOWED_PUBLIC_CORRECTION_TYPES = new Set([
  'safeCorrection',
  'sensitiveCorrection',
  'reviewRequiredCorrection',
  'noCorrectionForbidden',
]);

const PUBLIC_CORRECTION_FIELDS = Object.freeze([
  'type',
  'suggestedThemes',
  'suggestedTriggers',
  'originalSelectedThemes',
  'originalSelectedTriggers',
  'finalAcceptedThemes',
  'finalAcceptedTriggers',
  'reason',
  'requiresUserAcceptance',
  'requiresModeratorReview',
  'publishBlocked',
  'userAcceptedAt',
  'userRejectedAt',
  'reviewRequestedAt',
]);

const PUBLIC_CREDIT_TIMESTAMP_FIELDS = Object.freeze(['consentUpdatedAt']);
const PUBLIC_UPLOAD_CONSENT_TIMESTAMP_FIELDS = Object.freeze([
  'resolvedAt',
  'missingMakerResolvedAt',
  'selfMakerRoleConfirmedAt',
]);
const PUBLIC_CONSENT_AUDIT_TIMESTAMP_FIELDS = Object.freeze([
  'at',
  'resolvedAt',
  'missingMakerResolvedAt',
  'selfMakerRoleConfirmedAt',
]);
const PUBLIC_CORRECTION_TIMESTAMP_FIELDS = Object.freeze([
  'userAcceptedAt',
  'userRejectedAt',
  'reviewRequestedAt',
]);

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const normalizeString = (value) => String(value ?? '').trim();
const containsEvery = (items, required) => Array.isArray(items)
  && required.every((item) => items.includes(item));


export const sanitizePersistedPostCreditForWrite = (credit = {}) => {
  if (!isRecord(credit)) return {};
  const safeCredit = {};
  PUBLIC_CREDIT_FIELDS.forEach((key) => {
    if (credit[key] !== undefined) safeCredit[key] = credit[key];
  });
  return safeCredit;
};


const pickPublicFields = (value, fields) => {
  if (!isRecord(value)) return {};
  const safe = {};
  fields.forEach((key) => {
    if (value[key] !== undefined) safe[key] = value[key];
  });
  return safe;
};


export const rehydratePersistedPublicationTimestamp = (value) => {
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? Timestamp.fromDate(value) : null;
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? Timestamp.fromDate(parsed) : null;
  }
  if (!isRecord(value)) return null;

  const type = normalizeString(value.type);
  if (type && type !== 'firestore/timestamp/1.0' && type !== 'timestamp') return null;
  const seconds = value.seconds;
  const nanoseconds = value.nanoseconds === undefined ? 0 : value.nanoseconds;
  if (!Number.isSafeInteger(seconds)
    || !Number.isInteger(nanoseconds)
    || nanoseconds < 0
    || nanoseconds >= 1_000_000_000) return null;
  try {
    return new Timestamp(seconds, nanoseconds);
  } catch {
    return null;
  }
};

const rehydrateTimestampFields = (target, fields) => {
  for (const key of fields) {
    if (target[key] === undefined || target[key] === null) continue;
    const timestamp = rehydratePersistedPublicationTimestamp(target[key]);
    if (!timestamp) return { ok: false, field: key };
    target[key] = timestamp;
  }
  return { ok: true };
};

const invalidConsentTimestamp = (field) => ({
  ok: false,
  status: 400,
  code: 'consent_timestamp_invalid',
  error: `Persisted publication consent timestamp is invalid: ${field}`,
});

export const normalizePersistedPublicationStringList = (items = []) => Array.from(new Set(
  (Array.isArray(items) ? items : [])
    .map((item) => normalizeString(typeof item === 'string' ? item : item?.trigger))
    .filter(Boolean),
));

export const sanitizePersistedPublicationCorrection = (value) => {
  if (!isRecord(value)) return null;
  const safe = pickPublicFields(value, PUBLIC_CORRECTION_FIELDS);
  ['suggestedThemes', 'suggestedTriggers', 'originalSelectedThemes', 'originalSelectedTriggers', 'finalAcceptedThemes', 'finalAcceptedTriggers']
    .forEach((key) => {
      if (safe[key] !== undefined) safe[key] = normalizePersistedPublicationStringList(safe[key]);
    });
  if (safe.reason !== undefined) safe.reason = normalizeString(safe.reason).slice(0, 1000);
  if (!rehydrateTimestampFields(safe, PUBLIC_CORRECTION_TIMESTAMP_FIELDS).ok) return null;
  const requestedType = normalizeString(safe.type);
  const hasAcceptedState = Boolean(safe.userAcceptedAt);
  if (ALLOWED_PUBLIC_CORRECTION_TYPES.has(requestedType)) {
    safe.type = requestedType;
  } else if (hasAcceptedState) {
    safe.type = 'safeCorrection';
  } else {
    return null;
  }
  return safe;
};

export const sanitizePersistedPublicationImageMeta = (value) => {
  if (!isRecord(value)) return null;
  const safe = {};
  ['width', 'height', 'aspectRatio', 'sizeBytes'].forEach((key) => {
    const numeric = Number(value[key]);
    if (Number.isFinite(numeric) && numeric >= 0) safe[key] = numeric;
  });
  const orientation = normalizeString(value.orientation);
  if (orientation) safe.orientation = orientation.slice(0, 40);
  return Object.keys(safe).length > 0 ? safe : null;
};

const normalizeConsentException = (value = {}) => {
  const source = isRecord(value) ? value : {};
  const requestedType = normalizeString(source.type);
  const enabled = source.enabled === true && CONSENT_EXCEPTION_TYPES.has(requestedType);
  return {
    enabled,
    type: enabled ? requestedType : null,
    reason: enabled ? normalizeString(source.reason).slice(0, 500) : '',
  };
};

const DEFAULT_CONSENT_DRAFT_SELF_MAKER_ROLE = 'photographer';

const normalizeConsentDraftMakerRole = (value, fallback = null) => {
  const normalized = normalizeString(value);
  return MAKER_ROLE_IDS.includes(normalized) ? normalized : fallback;
};

export const sanitizePersistedConsentDraftState = (draft = {}) => {
  const source = isRecord(draft) ? draft : {};
  const rawException = isRecord(source.consentException) ? source.consentException : {};
  const normalizedException = normalizeConsentException(rawException);
  const selectedExceptionType = CONSENT_EXCEPTION_TYPES.has(normalizeString(rawException.type))
    ? normalizeString(rawException.type)
    : 'streetPhotography';
  const rawConfirmation = isRecord(source.selfMakerRoleConfirmation)
    ? source.selfMakerRoleConfirmation
    : {};
  const confirmedRole = normalizeConsentDraftMakerRole(rawConfirmation.role, null);
  const confirmed = rawConfirmation.confirmed === true && Boolean(confirmedRole);
  return {
    consentException: {
      enabled: normalizedException.enabled,
      type: normalizedException.type || selectedExceptionType,
      reason: normalizedException.enabled ? normalizedException.reason : '',
    },
    aiPeoplePresent: source.aiPeoplePresent === true,
    subjectWarningAcknowledged: source.subjectWarningAcknowledged === true,
    missingMakerPromptShown: source.missingMakerPromptShown === true,
    selectedSelfMakerRole: normalizeConsentDraftMakerRole(
      source.selectedSelfMakerRole,
      DEFAULT_CONSENT_DRAFT_SELF_MAKER_ROLE,
    ),
    pendingSelfMakerRole: normalizeConsentDraftMakerRole(source.pendingSelfMakerRole, null),
    selfMakerRoleConfirmation: confirmed
      ? {
          confirmed: true,
          role: confirmedRole,
          confirmedAt: normalizeString(rawConfirmation.confirmedAt) || null,
        }
      : { confirmed: false, role: '', confirmedAt: null },
  };
};

export const sanitizePersistedPendingInviteContributors = (items = []) => (Array.isArray(items) ? items : [])
  .map((item) => {
    if (!isRecord(item)) return null;
    const contributorId = normalizeString(item.contributorId);
    if (!contributorId) return null;
    return {
      contributorId,
      displayName: normalizeString(item.displayName).slice(0, 200),
    };
  })
  .filter(Boolean);

export const resolveTrustedModeratedImageUrl = (upload = {}) => (
  normalizeString(upload?.imageUrl || upload?.previewUrl) || null
);

export const buildPersistedModerationDraftState = ({ draft = {}, upload = {} } = {}) => {
  const source = isRecord(draft) ? { ...draft } : {};
  const trustedImageUrl = resolveTrustedModeratedImageUrl(upload);
  if (!trustedImageUrl) {
    return {
      ok: false,
      status: 409,
      code: 'moderated_image_missing',
      error: 'Persisted moderation draft is not bound to a moderated image',
    };
  }
  const imageMeta = sanitizePersistedPublicationImageMeta(source.imageMeta);
  const pendingInviteContributors = sanitizePersistedPendingInviteContributors(source.pendingInviteContributors);
  const consentDraftState = sanitizePersistedConsentDraftState(source);
  [
    'imageUrl',
    'previewUrl',
    'imageRef',
    'storagePath',
    'imageMeta',
    'pendingInviteContributors',
    'consentException',
    'aiPeoplePresent',
    'subjectWarningAcknowledged',
    'missingMakerPromptShown',
    'selectedSelfMakerRole',
    'pendingSelfMakerRole',
    'selfMakerRoleConfirmation',
  ].forEach((key) => delete source[key]);
  return {
    ok: true,
    draft: {
      ...source,
      imageUrl: trustedImageUrl,
      ...(imageMeta ? { imageMeta } : {}),
      pendingInviteContributors,
      ...consentDraftState,
    },
  };
};

const sameConsentException = (left, right) => (
  left.enabled === right.enabled
  && left.type === right.type
  && left.reason === right.reason
);

const isActualMakerCredit = (credit = {}) => {
  if (!isRecord(credit)) return false;
  const role = normalizeString(credit.role);
  const makerFunction = normalizeString(credit.makerFunction);
  if (MAKER_ROLE_IDS.includes(role)) return true;
  if (credit.isMaker === true && MAKER_FUNCTION_IDS.has(makerFunction)) return true;
  return role === 'model'
    && credit.isSelf === true
    && credit.isMaker === true
    && credit.selfPortrait === true
    && (credit.makerFunction === undefined || credit.makerFunction === null || makerFunction === '');
};

export const buildPersistedPublicationConsentProof = ({ postDraft = {}, userId = '' } = {}) => {
  const draft = isRecord(postDraft) ? postDraft : {};
  const rawCredits = Array.isArray(draft.credits) ? draft.credits : [];
  const uploadConsent = isRecord(draft.uploadConsent) ? draft.uploadConsent : null;
  const rawConsentAudit = Array.isArray(draft.consentAudit) ? draft.consentAudit : [];
  const consentException = normalizeConsentException(draft.consentException);
  const normalizedUserId = normalizeString(userId);

  if (!uploadConsent || uploadConsent.version !== 1) {
    return {
      ok: false,
      status: 400,
      code: 'upload_consent_missing',
      error: 'Persisted publication requires upload consent proof',
    };
  }
  if (rawCredits.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'consent_credits_missing',
      error: 'Persisted publication requires consent credits',
    };
  }
  if (!rawCredits.every(isRecord)) {
    return {
      ok: false,
      status: 400,
      code: 'consent_credits_invalid',
      error: 'Persisted publication consent credits are invalid',
    };
  }
  const sanitizedCredits = rawCredits.map(sanitizePersistedPostCreditForWrite);
  for (const credit of sanitizedCredits) {
    const timestampResult = rehydrateTimestampFields(credit, PUBLIC_CREDIT_TIMESTAMP_FIELDS);
    if (!timestampResult.ok) return invalidConsentTimestamp(`credits.${timestampResult.field}`);
  }

  const makerCreditIndex = uploadConsent.makerCreditIndex;
  if (uploadConsent.hasMaker !== true
    || !Number.isInteger(makerCreditIndex)
    || makerCreditIndex < 0
    || makerCreditIndex >= sanitizedCredits.length
    || !isActualMakerCredit(sanitizedCredits[makerCreditIndex])) {
    return {
      ok: false,
      status: 400,
      code: 'consent_maker_invalid',
      error: 'Persisted publication requires a valid maker credit',
    };
  }

  if (!containsEvery(uploadConsent.makerRoles, MAKER_ROLE_IDS)) {
    return {
      ok: false,
      status: 400,
      code: 'consent_maker_roles_invalid',
      error: 'Persisted publication maker-role proof is incomplete',
    };
  }
  if (!containsEvery(uploadConsent.consentStatuses, CONSENT_STATUS_IDS)) {
    return {
      ok: false,
      status: 400,
      code: 'consent_statuses_invalid',
      error: 'Persisted publication consent-status proof is incomplete',
    };
  }

  if (rawConsentAudit.length === 0 || !rawConsentAudit.every(isRecord)) {
    return {
      ok: false,
      status: 400,
      code: 'consent_audit_missing',
      error: 'Persisted publication requires consent audit proof',
    };
  }

  const uploadConsentException = normalizeConsentException(uploadConsent.exception);
  if (!sameConsentException(uploadConsentException, consentException)) {
    return {
      ok: false,
      status: 409,
      code: 'consent_exception_mismatch',
      error: 'Persisted publication consent exception does not match upload consent proof',
    };
  }

  const sanitizedConsentAudit = [];
  for (const entry of rawConsentAudit) {
    const safeEntry = {
      ...pickPublicFields(entry, PUBLIC_CONSENT_AUDIT_FIELDS),
      actorUid: normalizedUserId || normalizeString(entry.actorUid) || null,
    };
    const timestampResult = rehydrateTimestampFields(safeEntry, PUBLIC_CONSENT_AUDIT_TIMESTAMP_FIELDS);
    if (!timestampResult.ok) return invalidConsentTimestamp(`consentAudit.${timestampResult.field}`);
    sanitizedConsentAudit.push(safeEntry);
  }
  const sanitizedUploadConsent = {
    ...pickPublicFields(uploadConsent, PUBLIC_UPLOAD_CONSENT_FIELDS),
    exception: consentException,
    audit: sanitizedConsentAudit,
  };
  const uploadConsentTimestampResult = rehydrateTimestampFields(
    sanitizedUploadConsent,
    PUBLIC_UPLOAD_CONSENT_TIMESTAMP_FIELDS,
  );
  if (!uploadConsentTimestampResult.ok) {
    return invalidConsentTimestamp(`uploadConsent.${uploadConsentTimestampResult.field}`);
  }

  const contributorIds = Array.from(new Set(
    sanitizedCredits
      .map((credit) => normalizeString(credit?.contributorId))
      .filter(Boolean),
  ));

  return {
    ok: true,
    credits: sanitizedCredits,
    contributorIds,
    uploadConsent: sanitizedUploadConsent,
    consentAudit: sanitizedConsentAudit,
    consentException,
  };
};
