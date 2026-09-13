import {
  isUploadLifecycleDraftable,
  isUploadLifecyclePromptManageable,
  isUploadLifecyclePublishable,
} from './moderationLifecycle.js';

export function requiresMessageIdForAction(action) {
  return action === 'publishNow' || action === 'saveDraft' || action === 'dismiss';
}

const hasReadyModerationMedia = (upload = {}) => {
  const mediaState = String(upload?.mediaState || '').trim();
  return !mediaState || mediaState === 'ready';
};

const hasAcceptedCorrectionWhenPresent = (upload = {}) => {
  if (!upload?.correctedTaxonomy) return true;
  const responseStatus = String(upload?.uploaderCorrectionResponse?.status || '').trim();
  return !responseStatus || responseStatus === 'accepted';
};

export function canPublishUpload(upload = {}) {
  if (!hasReadyModerationMedia(upload)) return false;
  if (upload?.requiresUploaderAcceptance === true) return false;
  if (!hasAcceptedCorrectionWhenPresent(upload)) return false;
  return isUploadLifecyclePublishable(upload);
}

export function canSaveDraftUpload(upload = {}) {
  return hasReadyModerationMedia(upload)
    && upload?.requiresUploaderAcceptance !== true
    && hasAcceptedCorrectionWhenPresent(upload)
    && isUploadLifecycleDraftable(upload);
}

export function canManageApprovedUploadPrompt(upload = {}) {
  return hasReadyModerationMedia(upload)
    && upload?.requiresUploaderAcceptance !== true
    && isUploadLifecyclePromptManageable(upload);
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

export function getServerPublicPostPublishDecision({ user = null, tokenClaims = null } = {}) {
  const userDecision = getUserPublicPostPublishDecision(user);
  if (!userDecision.allowed) return userDecision;
  if (!tokenClaims || typeof tokenClaims !== 'object') {
    return { allowed: false, code: 'adult_verification_required' };
  }
  if (tokenClaims.email_verified !== true
    || tokenClaims.idvVerified !== true
    || tokenClaims.isAdult !== true) {
    return { allowed: false, code: 'adult_verification_required' };
  }
  return { allowed: true, code: 'allowed' };
}

export function canUserPublishPublicPost(user = null) {
  return getUserPublicPostPublishDecision(user).allowed;
}
