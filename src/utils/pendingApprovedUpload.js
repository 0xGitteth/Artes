const CLOSED_PUBLICATION_STATUSES = new Set([
  'published',
  'discarded',
  'draft',
  'blocked',
  'needs_user_correction',
  'user_disagreed',
  'expired',
  'deleted',
  'deleted_pending_cleanup',
]);

export function resolveUploadTimestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (typeof value === 'number') return value;
  return 0;
}

export function isPendingApprovedUploadCandidate(upload = {}, options = {}) {
  const uploadId = String(upload?.id || '').trim();
  if (!uploadId) return false;
  if (options.acknowledgedUploadIds?.has?.(uploadId)) return false;
  if (upload?.reviewStatus !== 'approved') return false;
  const publicationStatus = String(upload?.publicationStatus || upload?.publishStatus || '').trim();
  if (CLOSED_PUBLICATION_STATUSES.has(publicationStatus)) return false;
  if (upload?.publishedAt || upload?.postId) return false;
  if (upload?.discardedAt || upload?.discardedByUid) return false;
  if (upload?.publicationPromptOpenedAt || upload?.publicationPromptDismissedAt) return false;
  return true;
}

export function selectPendingApprovedUploadReminder(uploads = [], options = {}) {
  const candidates = (Array.isArray(uploads) ? uploads : [])
    .filter((upload) => isPendingApprovedUploadCandidate(upload, options))
    .sort((a, b) => {
      const left = resolveUploadTimestampMs(b.reviewDecisionAt) || resolveUploadTimestampMs(b.approvedAt) || resolveUploadTimestampMs(b.createdAt);
      const right = resolveUploadTimestampMs(a.reviewDecisionAt) || resolveUploadTimestampMs(a.approvedAt) || resolveUploadTimestampMs(a.createdAt);
      return left - right;
    });

  if (!candidates.length) return null;
  return {
    uploadId: candidates[0].id,
    count: candidates.length,
  };
}
