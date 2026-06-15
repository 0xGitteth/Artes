export function requiresMessageIdForAction(action) {
  return action === 'publishNow' || action === 'saveDraft' || action === 'dismiss';
}

export function canPublishUpload(upload = {}) {
  if (upload?.requiresUploaderAcceptance === true) return false;
  const publicationStatus = String(upload?.publicationStatus || upload?.publishStatus || '').trim();
  if (publicationStatus === 'needs_user_correction' || publicationStatus === 'user_disagreed' || publicationStatus === 'discarded') return false;
  if (upload?.correctedTaxonomy) {
    const responseStatus = String(upload?.uploaderCorrectionResponse?.status || '').trim();
    if (responseStatus && responseStatus !== 'accepted') return false;
  }
  return upload?.reviewStatus === 'approved' || publicationStatus === 'published';
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
