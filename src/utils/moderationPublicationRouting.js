const PERSISTED_RESUME_PUBLICATION_STATUSES = new Set(['pending', 'correction_accepted']);

const clean = (value) => String(value || '').trim();

export function resolvePersistedModerationPublicationUploadId({
  isResumeFlow = false,
  resumeUpload = null,
  reviewUploadId = null,
  acceptedModeratorCorrection = false,
  currentModerationAllowed = false,
} = {}) {
  const persistedReviewUploadId = clean(reviewUploadId);
  if (acceptedModeratorCorrection && persistedReviewUploadId) return persistedReviewUploadId;

  const resumeUploadId = clean(resumeUpload?.id);
  const resumeModerationAllowed = resumeUpload?.moderationState
    ? clean(resumeUpload.moderationState) === 'allowed'
    : resumeUpload?.reviewStatus === 'approved';
  const canonicalPublicationState = clean(resumeUpload?.publicationState);
  const resumePublicationPending = canonicalPublicationState
    ? canonicalPublicationState === 'pending'
    : PERSISTED_RESUME_PUBLICATION_STATUSES.has(clean(resumeUpload?.publicationStatus || resumeUpload?.publishStatus));
  if (
    isResumeFlow
    && resumeUploadId
    && resumeModerationAllowed
    && resumePublicationPending
  ) {
    return resumeUploadId;
  }

  if (currentModerationAllowed && persistedReviewUploadId) return persistedReviewUploadId;

  return null;
}
