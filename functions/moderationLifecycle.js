const clean = (value) => String(value || '').trim();

export const MODERATION_STATES = Object.freeze({
  allowed: 'allowed',
  reviewPending: 'review_pending',
  correctionPending: 'correction_pending',
  rejected: 'rejected',
  superseded: 'superseded',
});

export const PUBLICATION_STATES = Object.freeze({
  pending: 'pending',
  draft: 'draft',
  published: 'published',
  discarded: 'discarded',
  expired: 'expired',
});

const VALID_MODERATION_STATES = new Set(Object.values(MODERATION_STATES));
const VALID_PUBLICATION_STATES = new Set(Object.values(PUBLICATION_STATES));

const LEGACY_FRESH_EVALUATION_STATES = new Set(['freshEvalQueued', 'closedNoFingerprint']);
const LEGACY_DISCARDED_PUBLICATION_STATES = new Set(['discarded', 'deleted', 'deleted_pending_cleanup']);
const LEGACY_PENDING_PUBLICATION_STATES = new Set([
  '',
  'pending',
  'correction_accepted',
  'needs_user_correction',
  'user_disagreed',
  'blocked',
  'freshEvalQueued',
  'closedNoFingerprint',
]);

const hasForbiddenEvidence = (upload = {}) => {
  const outcome = clean(upload?.outcome).toLowerCase();
  const classification = clean(upload?.classification).toLowerCase();
  return outcome === 'forbidden'
    || outcome === 'explicit'
    || outcome === 'reported'
    || outcome === 'nocorrectionforbidden'
    || classification === 'reviewrequired'
    || classification === 'sensitivecorrection'
    || classification === 'review_required'
    || upload?.publishBlocked === true
    || (Array.isArray(upload?.forbiddenReasons) && upload.forbiddenReasons.length > 0);
};

const deriveLegacyModerationState = (upload = {}, { includeEvidence = true } = {}) => {
  const reviewStatus = clean(upload?.reviewStatus);
  const publicationStatus = clean(upload?.publicationStatus || upload?.publishStatus);
  const outcome = clean(upload?.outcome);
  const correctionNeedsReview = upload?.correction?.requiresModeratorReview === true;
  const correctionPending = upload?.requiresUploaderAcceptance === true
    || reviewStatus === 'needs_user_correction'
    || publicationStatus === 'needs_user_correction';

  if (LEGACY_FRESH_EVALUATION_STATES.has(reviewStatus)
    || LEGACY_FRESH_EVALUATION_STATES.has(publicationStatus)) {
    return MODERATION_STATES.superseded;
  }
  if (reviewStatus === 'inReview'
    || publicationStatus === 'user_disagreed'
    || correctionNeedsReview) {
    return MODERATION_STATES.reviewPending;
  }
  if (reviewStatus === 'rejected' || publicationStatus === 'blocked') {
    return MODERATION_STATES.rejected;
  }
  if (correctionPending && reviewStatus === 'approved') {
    return includeEvidence ? null : MODERATION_STATES.allowed;
  }
  if (correctionPending) {
    if (includeEvidence && hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;
    return MODERATION_STATES.correctionPending;
  }
  if (reviewStatus === 'approved') {
    if (includeEvidence && hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;
    return MODERATION_STATES.allowed;
  }

  // Once a legacy lifecycle field exists, unknown or partial combinations do
  // not fall through to classifier evidence. This preserves the old fail-closed
  // precedence while canonical documents no longer depend on evidence fields.
  if (reviewStatus) return null;
  if (publicationStatus) {
    if (publicationStatus === 'published') return MODERATION_STATES.allowed;
    return null;
  }
  if (!includeEvidence) return null;

  if (upload?.shouldReview === true || outcome === 'review') return MODERATION_STATES.reviewPending;
  if (outcome === 'needsCorrection') return MODERATION_STATES.correctionPending;
  if (hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;
  if (outcome === 'allowed'
    && upload?.shouldReview !== true
    && upload?.publishBlocked !== true
    && (!Array.isArray(upload?.forbiddenReasons) || upload.forbiddenReasons.length === 0)) {
    return MODERATION_STATES.allowed;
  }
  return null;
};

const deriveLegacyPublicationState = (upload = {}) => {
  const raw = clean(upload?.publicationStatus || upload?.publishStatus);
  if (LEGACY_PENDING_PUBLICATION_STATES.has(raw)) return PUBLICATION_STATES.pending;
  if (raw === 'draft') return PUBLICATION_STATES.draft;
  if (raw === 'published') return PUBLICATION_STATES.published;
  if (LEGACY_DISCARDED_PUBLICATION_STATES.has(raw)) return PUBLICATION_STATES.discarded;
  if (raw === 'expired') return PUBLICATION_STATES.expired;
  return null;
};

export const resolveUploadModerationState = (upload = {}) => {
  const explicit = clean(upload?.moderationState);
  if (explicit) {
    if (!VALID_MODERATION_STATES.has(explicit)) {
      return { valid: false, state: null, canonical: true, reason: 'unknown_moderation_state' };
    }
    const legacyOperationalState = deriveLegacyModerationState(upload, { includeEvidence: false });
    if (legacyOperationalState && legacyOperationalState !== explicit) {
      return { valid: false, state: null, canonical: true, reason: 'moderation_state_conflict' };
    }
    return { valid: true, state: explicit, canonical: true, reason: 'canonical' };
  }

  const legacyState = deriveLegacyModerationState(upload, { includeEvidence: true });
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'moderation_state_unresolved' };
};

export const resolveUploadPublicationState = (upload = {}) => {
  const explicit = clean(upload?.publicationState);
  const legacyRaw = clean(upload?.publicationStatus || upload?.publishStatus);
  const legacyState = deriveLegacyPublicationState(upload);
  if (explicit) {
    if (!VALID_PUBLICATION_STATES.has(explicit)) {
      return { valid: false, state: null, canonical: true, reason: 'unknown_publication_state' };
    }
    if (legacyRaw && !legacyState) {
      return { valid: false, state: null, canonical: true, reason: 'unknown_legacy_publication_state' };
    }
    if (legacyRaw && legacyState !== explicit) {
      return { valid: false, state: null, canonical: true, reason: 'publication_state_conflict' };
    }
    return { valid: true, state: explicit, canonical: true, reason: 'canonical' };
  }
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'publication_state_unresolved' };
};

export const resolveUploadLifecycle = (upload = {}) => {
  const moderation = resolveUploadModerationState(upload);
  const publication = resolveUploadPublicationState(upload);
  return {
    valid: moderation.valid && publication.valid,
    moderationState: moderation.state,
    publicationState: publication.state,
    moderationCanonical: moderation.canonical,
    publicationCanonical: publication.canonical,
    reason: !moderation.valid ? moderation.reason : !publication.valid ? publication.reason : 'resolved',
  };
};

export const resolveModerationStateForResult = ({
  outcome = '',
  shouldReview = false,
  publishBlocked = false,
  reviewCaseId = null,
  requiresUploaderAcceptance = false,
} = {}) => {
  if (requiresUploaderAcceptance || clean(outcome) === 'needsCorrection') {
    return MODERATION_STATES.correctionPending;
  }
  if (shouldReview === true || clean(reviewCaseId)) return MODERATION_STATES.reviewPending;
  if (clean(outcome) === 'forbidden' || publishBlocked === true) return MODERATION_STATES.rejected;
  return MODERATION_STATES.allowed;
};

export const isUploadLifecyclePublishable = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  if (!lifecycle.valid || lifecycle.moderationState !== MODERATION_STATES.allowed) return false;
  return lifecycle.publicationState === PUBLICATION_STATES.pending
    || lifecycle.publicationState === PUBLICATION_STATES.draft
    || lifecycle.publicationState === PUBLICATION_STATES.published;
};

export const isUploadLifecycleDraftable = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  if (!lifecycle.valid || lifecycle.moderationState !== MODERATION_STATES.allowed) return false;
  return lifecycle.publicationState === PUBLICATION_STATES.pending
    || lifecycle.publicationState === PUBLICATION_STATES.draft;
};

export const isUploadLifecyclePromptManageable = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === MODERATION_STATES.allowed
    && lifecycle.publicationState === PUBLICATION_STATES.pending;
};

export const isUploadLifecycleCorrectionPending = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === MODERATION_STATES.correctionPending
    && lifecycle.publicationState === PUBLICATION_STATES.pending;
};
