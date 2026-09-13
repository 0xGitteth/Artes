const clean = (value) => String(value || '').trim();

export const CLIENT_MODERATION_STATES = Object.freeze({
  allowed: 'allowed',
  reviewPending: 'review_pending',
  correctionPending: 'correction_pending',
  rejected: 'rejected',
  superseded: 'superseded',
});

export const CLIENT_PUBLICATION_STATES = Object.freeze({
  pending: 'pending',
  draft: 'draft',
  published: 'published',
  discarded: 'discarded',
  expired: 'expired',
});

const VALID_MODERATION_STATES = new Set(Object.values(CLIENT_MODERATION_STATES));
const VALID_PUBLICATION_STATES = new Set(Object.values(CLIENT_PUBLICATION_STATES));
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

const deriveLegacyModerationState = (upload = {}) => {
  const reviewStatus = clean(upload?.reviewStatus);
  const publicationStatus = clean(upload?.publicationStatus || upload?.publishStatus);
  const outcome = clean(upload?.outcome);
  const correctionNeedsReview = upload?.correction?.requiresModeratorReview === true;
  const correctionPending = upload?.requiresUploaderAcceptance === true
    || reviewStatus === 'needs_user_correction'
    || publicationStatus === 'needs_user_correction';

  if (LEGACY_FRESH_EVALUATION_STATES.has(reviewStatus)
    || LEGACY_FRESH_EVALUATION_STATES.has(publicationStatus)) return CLIENT_MODERATION_STATES.superseded;
  if (reviewStatus === 'inReview' || publicationStatus === 'user_disagreed' || correctionNeedsReview) {
    return CLIENT_MODERATION_STATES.reviewPending;
  }
  if (reviewStatus === 'rejected' || publicationStatus === 'blocked') return CLIENT_MODERATION_STATES.rejected;
  if (correctionPending && reviewStatus === 'approved') {
    return hasForbiddenEvidence(upload) ? CLIENT_MODERATION_STATES.rejected : CLIENT_MODERATION_STATES.allowed;
  }
  if (correctionPending) {
    return hasForbiddenEvidence(upload) ? CLIENT_MODERATION_STATES.rejected : CLIENT_MODERATION_STATES.correctionPending;
  }
  if (reviewStatus === 'approved') {
    return hasForbiddenEvidence(upload) ? CLIENT_MODERATION_STATES.rejected : CLIENT_MODERATION_STATES.allowed;
  }
  if (reviewStatus) return null;
  if (publicationStatus) return publicationStatus === 'published' ? CLIENT_MODERATION_STATES.allowed : null;
  if (upload?.shouldReview === true || outcome === 'review') return CLIENT_MODERATION_STATES.reviewPending;
  if (outcome === 'needsCorrection') return CLIENT_MODERATION_STATES.correctionPending;
  if (hasForbiddenEvidence(upload)) return CLIENT_MODERATION_STATES.rejected;
  if (outcome === 'allowed'
    && upload?.shouldReview !== true
    && upload?.publishBlocked !== true
    && (!Array.isArray(upload?.forbiddenReasons) || upload.forbiddenReasons.length === 0)) {
    return CLIENT_MODERATION_STATES.allowed;
  }
  return null;
};

const deriveLegacyPublicationState = (upload = {}) => {
  const raw = clean(upload?.publicationStatus || upload?.publishStatus);
  if (LEGACY_PENDING_PUBLICATION_STATES.has(raw)) return CLIENT_PUBLICATION_STATES.pending;
  if (raw === 'draft') return CLIENT_PUBLICATION_STATES.draft;
  if (raw === 'published') return CLIENT_PUBLICATION_STATES.published;
  if (LEGACY_DISCARDED_PUBLICATION_STATES.has(raw)) return CLIENT_PUBLICATION_STATES.discarded;
  if (raw === 'expired') return CLIENT_PUBLICATION_STATES.expired;
  return null;
};

export const resolveClientUploadModerationState = (upload = {}) => {
  const explicit = clean(upload?.moderationState);
  if (explicit) {
    return VALID_MODERATION_STATES.has(explicit)
      ? { valid: true, state: explicit, canonical: true, reason: 'canonical' }
      : { valid: false, state: null, canonical: true, reason: 'unknown_moderation_state' };
  }
  const legacyState = deriveLegacyModerationState(upload);
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'moderation_state_unresolved' };
};

export const resolveClientUploadPublicationState = (upload = {}) => {
  const explicit = clean(upload?.publicationState);
  if (explicit) {
    return VALID_PUBLICATION_STATES.has(explicit)
      ? { valid: true, state: explicit, canonical: true, reason: 'canonical' }
      : { valid: false, state: null, canonical: true, reason: 'unknown_publication_state' };
  }
  const legacyState = deriveLegacyPublicationState(upload);
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'publication_state_unresolved' };
};

export const resolveClientUploadLifecycle = (upload = {}) => {
  const moderation = resolveClientUploadModerationState(upload);
  const publication = resolveClientUploadPublicationState(upload);
  return {
    valid: moderation.valid && publication.valid,
    moderationState: moderation.state,
    publicationState: publication.state,
    moderationCanonical: moderation.canonical,
    publicationCanonical: publication.canonical,
    reason: !moderation.valid ? moderation.reason : !publication.valid ? publication.reason : 'resolved',
  };
};

export const isClientUploadAllowedPending = (upload = {}) => {
  const lifecycle = resolveClientUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === CLIENT_MODERATION_STATES.allowed
    && lifecycle.publicationState === CLIENT_PUBLICATION_STATES.pending;
};

export const isClientUploadCorrectionPending = (upload = {}) => {
  const lifecycle = resolveClientUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === CLIENT_MODERATION_STATES.correctionPending
    && lifecycle.publicationState === CLIENT_PUBLICATION_STATES.pending;
};

export const isClientUploadDiscarded = (upload = {}) => {
  const publication = resolveClientUploadPublicationState(upload);
  return publication.valid && publication.state === CLIENT_PUBLICATION_STATES.discarded;
};
