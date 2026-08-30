const APPROVED_PUBLICATION_STATUSES = new Set([
  '',
  'pending',
  'correction_accepted',
  'draft',
  'published',
]);

export function requiresMessageIdForAction(action) {
  return action === 'publishNow' || action === 'saveDraft' || action === 'dismiss';
}

export function canPublishUpload(upload = {}) {
  if (upload?.requiresUploaderAcceptance === true) return false;

  const reviewStatus = String(upload?.reviewStatus || '').trim();
  const publicationStatus = String(upload?.publicationStatus || upload?.publishStatus || '').trim();

  if (upload?.correctedTaxonomy) {
    const responseStatus = String(upload?.uploaderCorrectionResponse?.status || '').trim();
    if (responseStatus && responseStatus !== 'accepted') return false;
  }

  // Once an upload has entered the persisted review/publication lifecycle,
  // only explicitly approved states may publish. This prevents stale
  // `outcome: allowed` data from bypassing later queue/review/closed states.
  if (reviewStatus || publicationStatus) {
    if (reviewStatus === 'approved') {
      return APPROVED_PUBLICATION_STATUSES.has(publicationStatus);
    }

    // Preserve compatibility with already-published legacy uploads that do
    // not carry a reviewStatus, while still failing closed for every other
    // non-empty lifecycle combination.
    return !reviewStatus && publicationStatus === 'published';
  }

  // The outcome fallback is only for the initial moderation result before
  // any persisted review/publication lifecycle state has been assigned.
  return upload?.outcome === 'allowed'
    && upload?.shouldReview !== true
    && upload?.publishBlocked !== true
    && (!Array.isArray(upload?.forbiddenReasons) || upload.forbiddenReasons.length === 0);
}

export function getUserPublicPostPublishDecision(user = null) {
  if (!user || typeof user !== 'object') {
    return { allowed: false, code: 'adult_verification_required' };
  }
  if (user?.didit?.status === 'underage' || user?.idv?.status === 'underage') {
    return { allowed: false, code: 'underage' };
  }
  if (user.ageVerified !== true || user.isAdult !== true) {
    return { allowed: false, code: 'adult_verification_required' };
  }
  return { allowed: true, code: 'allowed' };
}

export function canUserPublishPublicPost(user = null) {
  return getUserPublicPostPublishDecision(user).allowed;
}
