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
  const resumePublicationStatus = clean(resumeUpload?.publicationStatus || resumeUpload?.publishStatus);
  if (
    isResumeFlow
    && resumeUploadId
    && resumeUpload?.reviewStatus === 'approved'
    && PERSISTED_RESUME_PUBLICATION_STATUSES.has(resumePublicationStatus)
  ) {
    return resumeUploadId;
  }

  if (currentModerationAllowed && persistedReviewUploadId) return persistedReviewUploadId;

  return null;
}
