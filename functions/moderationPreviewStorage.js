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

export const getModerationPreviewCleanupTaskDecision = ({
  taskId,
  taskData = {},
  uploadExists = false,
  uploadData = {},
} = {}) => {
  const normalizedTaskId = pickString(taskId);
  const uploadId = pickString(taskData?.uploadId);
  const ownerUid = pickString(taskData?.ownerUid);
  const storagePath = resolveOwnedModerationPreviewStoragePath({
    userId: ownerUid,
    storagePath: taskData?.storagePath,
  });
  if (!normalizedTaskId || !uploadId || normalizedTaskId !== uploadId || !ownerUid || !storagePath) {
    return { action: 'drop_task', reason: 'invalid_cleanup_anchor' };
  }

  if (!uploadExists) {
    return { action: 'delete_orphan', reason: 'upload_missing', storagePath };
  }

  const uploadOwnerUid = pickString(uploadData?.userId, uploadData?.uploaderUid, uploadData?.ownerUid, uploadData?.userUid);
  const uploadStoragePath = resolveOwnedModerationPreviewStoragePath(uploadData);
  if (uploadOwnerUid === ownerUid && uploadStoragePath === storagePath) {
    return { action: 'preserve_upload', reason: 'upload_owns_preview', storagePath };
  }

  // A server-owned task that disagrees with an existing upload is not enough
  // proof to delete media. Keep it for operator inspection rather than risking
  // a valid upload object.
  return { action: 'defer', reason: 'upload_binding_mismatch', storagePath };
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

  // A post-deletion cleanup failure is an explicit terminal media state. Do not
  // let stale review metadata defer cleanup once the post itself is gone.
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
