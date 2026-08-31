const pickString = (...values) => values
  .map((value) => String(value || '').trim())
  .find(Boolean) || null;

const normalizeStatus = (value) => String(value || '').trim();

const KNOWN_EXPIRABLE_REVIEW_STATUSES = new Set([
  '',
  'approved',
  'rejected',
  'needs_user_correction',
  'freshEvalQueued',
  'closedNoFingerprint',
]);

const KNOWN_EXPIRABLE_PUBLICATION_STATUSES = new Set([
  '',
  'pending',
  'correction_accepted',
  'needs_user_correction',
  'user_disagreed',
  'blocked',
  'discarded',
  'deleted',
  'deleted_pending_cleanup',
  'freshEvalQueued',
  'closedNoFingerprint',
  'expired',
]);

const KNOWN_MEDIA_STATES = new Set(['pending', 'ready', 'cleanup_pending', 'deleted']);

const timestampToMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return (seconds * 1000) + Math.floor(nanoseconds / 1_000_000);
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

export const resolveOwnedModerationPreviewStoragePath = (upload = {}) => {
  const ownerUid = pickString(upload?.userId, upload?.uploaderUid, upload?.ownerUid, upload?.userUid);
  if (!ownerUid || ownerUid.includes('/')) return null;

  const storagePath = pickString(upload?.storagePath, upload?.imageRef);
  if (!storagePath) return null;
  const explicitStoragePath = String(upload?.storagePath || '').trim();
  const explicitImageRef = String(upload?.imageRef || '').trim();
  if (explicitStoragePath && explicitImageRef && explicitStoragePath !== explicitImageRef) return null;

  const parts = storagePath.split('/');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'moderation-previews' || parts[1] !== ownerUid) return null;
  if (!parts[2] || parts[2] === '.' || parts[2] === '..') return null;
  return storagePath;
};

export const resolveModerationPreviewMediaState = (uploadData = {}) => {
  const explicitState = normalizeStatus(uploadData?.mediaState);
  if (explicitState) return KNOWN_MEDIA_STATES.has(explicitState) ? explicitState : 'unknown';
  return resolveOwnedModerationPreviewStoragePath(uploadData) ? 'legacy_ready' : 'none';
};

export const getModerationPendingMediaCleanupDecision = ({
  uploadId,
  uploadData = {},
  nowMs = Date.now(),
} = {}) => {
  const normalizedUploadId = pickString(uploadId);
  if (!normalizedUploadId || normalizedUploadId.includes('/')) {
    return { action: 'defer', reason: 'invalid_upload_id' };
  }

  const mediaState = resolveModerationPreviewMediaState(uploadData);
  if (mediaState === 'ready' || mediaState === 'deleted') {
    return { action: 'clear_schedule', reason: 'media_state_terminal_or_ready' };
  }
  if (mediaState === 'legacy_ready' || mediaState === 'none') {
    return { action: 'skip', reason: 'not_pending_media' };
  }
  if (mediaState === 'unknown') {
    return { action: 'defer', reason: 'unknown_media_state' };
  }
  if (mediaState !== 'pending' && mediaState !== 'cleanup_pending') {
    return { action: 'defer', reason: 'unsupported_media_state' };
  }

  const storagePath = resolveOwnedModerationPreviewStoragePath(uploadData);
  if (!storagePath) return { action: 'defer', reason: 'invalid_owned_preview' };
  const filename = storagePath.split('/')[2] || '';
  if (!filename.startsWith(`${normalizedUploadId}.`)) {
    return { action: 'defer', reason: 'upload_storage_binding_mismatch', storagePath };
  }

  const cleanupAfterMs = timestampToMillis(uploadData?.mediaCleanupAfter);
  if (!Number.isFinite(cleanupAfterMs)) {
    return { action: 'defer', reason: 'missing_cleanup_schedule', storagePath };
  }
  if (cleanupAfterMs > Number(nowMs)) {
    return { action: 'skip', reason: 'not_due', storagePath };
  }

  return {
    action: 'cleanup',
    reason: mediaState === 'pending' ? 'pending_upload_abandoned' : 'cleanup_retry_due',
    storagePath,
  };
};

export const getOperationalModerationPreviewReviewCaseId = (uploadData = {}) => (
  pickString(uploadData?.reviewCaseId)
);

export const isOperationalModerationPreviewReviewCase = ({
  uploadId,
  uploadData = {},
  reviewCaseData = {},
} = {}) => {
  const normalizedUploadId = pickString(uploadId);
  const uploadOwnerUid = pickString(uploadData?.userId, uploadData?.uploaderUid, uploadData?.ownerUid, uploadData?.userUid);
  const reviewOwnerUid = pickString(reviewCaseData?.userId, reviewCaseData?.uploaderUid, reviewCaseData?.ownerUid);
  if (!normalizedUploadId || !uploadOwnerUid || !reviewOwnerUid || uploadOwnerUid !== reviewOwnerUid) return false;
  if (normalizeStatus(reviewCaseData?.caseType) === 'report') return false;

  const referencedUploadIds = new Set([
    pickString(reviewCaseData?.uploadId),
    pickString(reviewCaseData?.linkedUploadId),
    ...(Array.isArray(reviewCaseData?.linkedUploadIds)
      ? reviewCaseData.linkedUploadIds.map((value) => pickString(value))
      : []),
  ].filter(Boolean));
  return referencedUploadIds.has(normalizedUploadId);
};

export const getModerationPreviewRetentionDecision = ({
  uploadData = {},
  productionPostExists = false,
  codexDevPostExists = false,
  reviewCaseStatuses = [],
  draftExists = false,
  draftMatchesUpload = false,
} = {}) => {
  const storagePath = resolveOwnedModerationPreviewStoragePath(uploadData);
  if (!storagePath) {
    return { action: 'clear_retention', reason: 'no_owned_preview' };
  }

  const mediaState = resolveModerationPreviewMediaState(uploadData);
  if (mediaState === 'deleted') {
    return { action: 'clear_retention', reason: 'media_already_deleted' };
  }
  if (mediaState === 'pending' || mediaState === 'cleanup_pending' || mediaState === 'unknown') {
    return { action: 'defer', reason: 'media_not_ready', storagePath };
  }

  if (productionPostExists || codexDevPostExists) {
    return { action: 'preserve', reason: 'published_media_still_referenced', storagePath };
  }

  const publicationStatus = normalizeStatus(uploadData?.publicationStatus || uploadData?.publishStatus);
  const reviewStatus = normalizeStatus(uploadData?.reviewStatus);
  const normalizedReviewCaseStatuses = Array.isArray(reviewCaseStatuses)
    ? reviewCaseStatuses.map(normalizeStatus).filter(Boolean)
    : [];

  if (publicationStatus === 'published') {
    return { action: 'preserve', reason: 'published_state', storagePath };
  }

  // Legacy recovery path. New media cleanup uses mediaState/mediaCleanupAfter.
  if (publicationStatus === 'deleted_pending_cleanup') {
    return { action: 'expire', reason: 'post_deleted_cleanup_pending', storagePath };
  }

  if (reviewStatus === 'inReview' || normalizedReviewCaseStatuses.includes('inReview')) {
    return { action: 'defer', reason: 'active_review', storagePath };
  }

  if (publicationStatus === 'draft') {
    const draftId = pickString(uploadData?.draftId);
    if (!draftId) {
      return { action: 'defer', reason: 'legacy_draft_without_binding', storagePath };
    }
    if (!draftExists) {
      return { action: 'expire', reason: 'draft_missing', storagePath };
    }
    if (!draftMatchesUpload) {
      return { action: 'defer', reason: 'draft_binding_mismatch', storagePath };
    }
    return { action: 'defer', reason: 'draft_still_exists', storagePath };
  }

  if (!KNOWN_EXPIRABLE_REVIEW_STATUSES.has(reviewStatus)
    || !KNOWN_EXPIRABLE_PUBLICATION_STATUSES.has(publicationStatus)) {
    return { action: 'defer', reason: 'unknown_lifecycle_state', storagePath };
  }

  return { action: 'expire', reason: 'retention_elapsed', storagePath };
};

export const getDeletedPublishedPostCleanupDecision = ({
  postId,
  postData = {},
  uploadExists = false,
  uploadData = {},
} = {}) => {
  const normalizedPostId = pickString(postId);
  if (!normalizedPostId) return { ok: false, reason: 'missing_post_id' };
  if (!uploadExists) return { ok: false, reason: 'upload_missing' };

  const uploadOwnerUid = pickString(uploadData?.userId, uploadData?.uploaderUid, uploadData?.ownerUid, uploadData?.userUid);
  const postOwnerUid = pickString(postData?.authorOwnerUid, postData?.authorUid, postData?.authorId);
  if (!uploadOwnerUid || !postOwnerUid || uploadOwnerUid !== postOwnerUid) {
    return { ok: false, reason: 'owner_mismatch' };
  }

  const persistedPostId = pickString(uploadData?.postId);
  const publicationStatus = pickString(uploadData?.publicationStatus, uploadData?.publishStatus);
  const cleanupEligibleStatus = publicationStatus === 'published' || publicationStatus === 'deleted_pending_cleanup';
  if (persistedPostId !== normalizedPostId || !cleanupEligibleStatus) {
    return { ok: false, reason: 'not_matching_published_upload' };
  }
  return { ok: true, postId: normalizedPostId, ownerUid: uploadOwnerUid };
};
