export function requiresMessageIdForAction(action) {
  return action === 'publishNow' || action === 'saveDraft' || action === 'dismiss';
}

export function canPublishUpload(upload = {}) {
  if (upload?.requiresUploaderAcceptance === true) return false;
  const publicationStatus = String(upload?.publicationStatus || '').trim();
  if (publicationStatus === 'needs_user_correction' || publicationStatus === 'user_disagreed') return false;
  if (upload?.correctedTaxonomy) {
    const responseStatus = String(upload?.uploaderCorrectionResponse?.status || '').trim();
    if (responseStatus && responseStatus !== 'accepted') return false;
  }
  return upload?.reviewStatus === 'approved' || publicationStatus === 'published';
}
