import {
  CLIENT_MODERATION_STATES,
  CLIENT_PUBLICATION_STATES,
  resolveClientUploadLifecycle,
} from './moderationUploadLifecycle.js';

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
  const resumeLifecycle = resolveClientUploadLifecycle(resumeUpload || {});
  if (
    isResumeFlow
    && resumeUploadId
    && resumeLifecycle.valid
    && resumeLifecycle.moderationState === CLIENT_MODERATION_STATES.allowed
    && resumeLifecycle.publicationState === CLIENT_PUBLICATION_STATES.pending
  ) {
    return resumeUploadId;
  }

  if (currentModerationAllowed && persistedReviewUploadId) return persistedReviewUploadId;

  return null;
}
