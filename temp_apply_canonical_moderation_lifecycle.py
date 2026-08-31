from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


lifecycle_source = r'''const clean = (value) => String(value || '').trim();

export const MODERATION_STATES = Object.freeze({
  allowed: 'allowed',
  reviewPending: 'review_pending',
  correctionPending: 'correction_pending',
  rejected: 'rejected',
  superseded: 'superseded',
});

export const PUBLICATION_STATES = Object.freeze({
  pending: 'pending',
  draft: 'draft',
  published: 'published',
  discarded: 'discarded',
  expired: 'expired',
});

const VALID_MODERATION_STATES = new Set(Object.values(MODERATION_STATES));
const VALID_PUBLICATION_STATES = new Set(Object.values(PUBLICATION_STATES));

const LEGACY_FRESH_EVALUATION_STATES = new Set(['freshEvalQueued', 'closedNoFingerprint']);
const LEGACY_DISCARDED_PUBLICATION_STATES = new Set(['discarded', 'deleted', 'deleted_pending_cleanup']);
const LEGACY_PENDING_PUBLICATION_STATES = new Set([
  '',
  'pending',
  'correction_accepted',
  'needs_user_correction',
  'user_disagreed',
  'blocked',
  'freshEvalQueued',
  'closedNoFingerprint',
]);

const hasForbiddenEvidence = (upload = {}) => {
  const outcome = clean(upload?.outcome).toLowerCase();
  const classification = clean(upload?.classification).toLowerCase();
  return outcome === 'forbidden'
    || outcome === 'explicit'
    || outcome === 'reported'
    || outcome === 'nocorrectionforbidden'
    || classification === 'reviewrequired'
    || classification === 'sensitivecorrection'
    || classification === 'review_required'
    || upload?.publishBlocked === true
    || (Array.isArray(upload?.forbiddenReasons) && upload.forbiddenReasons.length > 0);
};

const deriveLegacyModerationState = (upload = {}, { includeEvidence = true } = {}) => {
  const reviewStatus = clean(upload?.reviewStatus);
  const publicationStatus = clean(upload?.publicationStatus || upload?.publishStatus);
  const outcome = clean(upload?.outcome);
  const correctionNeedsReview = upload?.correction?.requiresModeratorReview === true;
  const correctionPending = upload?.requiresUploaderAcceptance === true
    || reviewStatus === 'needs_user_correction'
    || publicationStatus === 'needs_user_correction';

  if (LEGACY_FRESH_EVALUATION_STATES.has(reviewStatus)
    || LEGACY_FRESH_EVALUATION_STATES.has(publicationStatus)) {
    return MODERATION_STATES.superseded;
  }
  if (reviewStatus === 'inReview'
    || publicationStatus === 'user_disagreed'
    || correctionNeedsReview) {
    return MODERATION_STATES.reviewPending;
  }
  if (reviewStatus === 'rejected' || publicationStatus === 'blocked') {
    return MODERATION_STATES.rejected;
  }
  if (correctionPending) {
    if (includeEvidence && hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;
    return MODERATION_STATES.correctionPending;
  }
  if (reviewStatus === 'approved') {
    if (includeEvidence && hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;
    return MODERATION_STATES.allowed;
  }

  // Once a legacy lifecycle field exists, unknown or partial combinations do
  // not fall through to classifier evidence. This preserves the old fail-closed
  // precedence while canonical documents no longer depend on evidence fields.
  if (reviewStatus) return null;
  if (publicationStatus) {
    if (publicationStatus === 'published') return MODERATION_STATES.allowed;
    return null;
  }
  if (!includeEvidence) return null;

  if (upload?.shouldReview === true || outcome === 'review') return MODERATION_STATES.reviewPending;
  if (outcome === 'needsCorrection') return MODERATION_STATES.correctionPending;
  if (hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;
  if (outcome === 'allowed'
    && upload?.shouldReview !== true
    && upload?.publishBlocked !== true
    && (!Array.isArray(upload?.forbiddenReasons) || upload.forbiddenReasons.length === 0)) {
    return MODERATION_STATES.allowed;
  }
  return null;
};

const deriveLegacyPublicationState = (upload = {}) => {
  const raw = clean(upload?.publicationStatus || upload?.publishStatus);
  if (LEGACY_PENDING_PUBLICATION_STATES.has(raw)) return PUBLICATION_STATES.pending;
  if (raw === 'draft') return PUBLICATION_STATES.draft;
  if (raw === 'published') return PUBLICATION_STATES.published;
  if (LEGACY_DISCARDED_PUBLICATION_STATES.has(raw)) return PUBLICATION_STATES.discarded;
  if (raw === 'expired') return PUBLICATION_STATES.expired;
  return null;
};

export const resolveUploadModerationState = (upload = {}) => {
  const explicit = clean(upload?.moderationState);
  if (explicit) {
    if (!VALID_MODERATION_STATES.has(explicit)) {
      return { valid: false, state: null, canonical: true, reason: 'unknown_moderation_state' };
    }
    const legacyOperationalState = deriveLegacyModerationState(upload, { includeEvidence: false });
    if (legacyOperationalState && legacyOperationalState !== explicit) {
      return { valid: false, state: null, canonical: true, reason: 'moderation_state_conflict' };
    }
    return { valid: true, state: explicit, canonical: true, reason: 'canonical' };
  }

  const legacyState = deriveLegacyModerationState(upload, { includeEvidence: true });
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'moderation_state_unresolved' };
};

export const resolveUploadPublicationState = (upload = {}) => {
  const explicit = clean(upload?.publicationState);
  const legacyRaw = clean(upload?.publicationStatus || upload?.publishStatus);
  const legacyState = deriveLegacyPublicationState(upload);
  if (explicit) {
    if (!VALID_PUBLICATION_STATES.has(explicit)) {
      return { valid: false, state: null, canonical: true, reason: 'unknown_publication_state' };
    }
    if (legacyRaw && !legacyState) {
      return { valid: false, state: null, canonical: true, reason: 'unknown_legacy_publication_state' };
    }
    if (legacyRaw && legacyState !== explicit) {
      return { valid: false, state: null, canonical: true, reason: 'publication_state_conflict' };
    }
    return { valid: true, state: explicit, canonical: true, reason: 'canonical' };
  }
  return legacyState
    ? { valid: true, state: legacyState, canonical: false, reason: 'legacy' }
    : { valid: false, state: null, canonical: false, reason: 'publication_state_unresolved' };
};

export const resolveUploadLifecycle = (upload = {}) => {
  const moderation = resolveUploadModerationState(upload);
  const publication = resolveUploadPublicationState(upload);
  return {
    valid: moderation.valid && publication.valid,
    moderationState: moderation.state,
    publicationState: publication.state,
    moderationCanonical: moderation.canonical,
    publicationCanonical: publication.canonical,
    reason: !moderation.valid ? moderation.reason : !publication.valid ? publication.reason : 'resolved',
  };
};

export const resolveModerationStateForResult = ({
  outcome = '',
  shouldReview = false,
  publishBlocked = false,
  reviewCaseId = null,
  requiresUploaderAcceptance = false,
} = {}) => {
  if (requiresUploaderAcceptance || clean(outcome) === 'needsCorrection') {
    return MODERATION_STATES.correctionPending;
  }
  if (shouldReview === true || clean(reviewCaseId)) return MODERATION_STATES.reviewPending;
  if (clean(outcome) === 'forbidden' || publishBlocked === true) return MODERATION_STATES.rejected;
  return MODERATION_STATES.allowed;
};

export const isUploadLifecyclePublishable = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  if (!lifecycle.valid || lifecycle.moderationState !== MODERATION_STATES.allowed) return false;
  return lifecycle.publicationState === PUBLICATION_STATES.pending
    || lifecycle.publicationState === PUBLICATION_STATES.draft
    || lifecycle.publicationState === PUBLICATION_STATES.published;
};

export const isUploadLifecycleDraftable = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  if (!lifecycle.valid || lifecycle.moderationState !== MODERATION_STATES.allowed) return false;
  return lifecycle.publicationState === PUBLICATION_STATES.pending
    || lifecycle.publicationState === PUBLICATION_STATES.draft;
};

export const isUploadLifecyclePromptManageable = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === MODERATION_STATES.allowed
    && lifecycle.publicationState === PUBLICATION_STATES.pending;
};

export const isUploadLifecycleCorrectionPending = (upload = {}) => {
  const lifecycle = resolveUploadLifecycle(upload);
  return lifecycle.valid
    && lifecycle.moderationState === MODERATION_STATES.correctionPending
    && lifecycle.publicationState === PUBLICATION_STATES.pending;
};
'''
Path('functions/moderationLifecycle.js').write_text(lifecycle_source, encoding='utf-8')

lifecycle_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODERATION_STATES,
  PUBLICATION_STATES,
  isUploadLifecycleCorrectionPending,
  isUploadLifecycleDraftable,
  isUploadLifecyclePromptManageable,
  isUploadLifecyclePublishable,
  resolveModerationStateForResult,
  resolveUploadLifecycle,
} from '../moderationLifecycle.js';

const legacyAllowed = {
  outcome: 'allowed',
  shouldReview: false,
  publishBlocked: false,
  forbiddenReasons: [],
};

test('canonical lifecycle is authoritative over stale classifier evidence', () => {
  const lifecycle = resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'pending',
    outcome: 'forbidden',
    publishBlocked: true,
    forbiddenReasons: [{ reason: 'stale' }],
  });
  assert.equal(lifecycle.valid, true);
  assert.equal(lifecycle.moderationState, MODERATION_STATES.allowed);
  assert.equal(isUploadLifecyclePublishable({
    moderationState: 'allowed',
    publicationState: 'pending',
    outcome: 'forbidden',
    publishBlocked: true,
  }), true);
});

test('canonical lifecycle fails closed on conflicting legacy operational state', () => {
  assert.equal(resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'blocked',
  }).valid, false);
  assert.equal(resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'published',
    reviewStatus: 'approved',
    publicationStatus: 'discarded',
  }).valid, false);
});

test('unknown canonical lifecycle values fail closed', () => {
  assert.equal(resolveUploadLifecycle({ moderationState: 'future_state', publicationState: 'pending' }).valid, false);
  assert.equal(resolveUploadLifecycle({ moderationState: 'allowed', publicationState: 'future_state' }).valid, false);
});

test('legacy lifecycle remains compatible but keeps lifecycle precedence over evidence', () => {
  assert.equal(isUploadLifecyclePublishable(legacyAllowed), true);
  assert.equal(isUploadLifecyclePublishable({ ...legacyAllowed, reviewStatus: 'approved', publicationStatus: 'pending' }), true);
  assert.equal(isUploadLifecyclePublishable({ ...legacyAllowed, publicationStatus: 'pending' }), false);
  assert.equal(isUploadLifecyclePublishable({ ...legacyAllowed, reviewStatus: 'rejected', publicationStatus: 'blocked' }), false);
  assert.equal(isUploadLifecyclePublishable({ publicationStatus: 'published' }), true);
});

test('fresh evaluation legacy states resolve to superseded and cannot publish', () => {
  for (const state of ['freshEvalQueued', 'closedNoFingerprint']) {
    const lifecycle = resolveUploadLifecycle({ reviewStatus: state, publicationStatus: state, ...legacyAllowed });
    assert.equal(lifecycle.valid, true);
    assert.equal(lifecycle.moderationState, MODERATION_STATES.superseded);
    assert.equal(isUploadLifecyclePublishable({ reviewStatus: state, publicationStatus: state, ...legacyAllowed }), false);
  }
});

test('correction rejection with active review resolves review-pending', () => {
  const lifecycle = resolveUploadLifecycle({
    reviewStatus: 'inReview',
    publicationStatus: 'user_disagreed',
    correction: { requiresModeratorReview: true },
  });
  assert.equal(lifecycle.valid, true);
  assert.equal(lifecycle.moderationState, MODERATION_STATES.reviewPending);
  assert.equal(lifecycle.publicationState, PUBLICATION_STATES.pending);
});

test('correction pending is a distinct non-publishable state', () => {
  const upload = {
    moderationState: 'correction_pending',
    publicationState: 'pending',
    reviewStatus: 'needs_user_correction',
    publicationStatus: 'needs_user_correction',
    requiresUploaderAcceptance: true,
  };
  assert.equal(isUploadLifecycleCorrectionPending(upload), true);
  assert.equal(isUploadLifecyclePublishable(upload), false);
});

test('draft and publication prompt actions use canonical publication lifecycle', () => {
  const pending = { moderationState: 'allowed', publicationState: 'pending' };
  assert.equal(isUploadLifecycleDraftable(pending), true);
  assert.equal(isUploadLifecyclePromptManageable(pending), true);
  assert.equal(isUploadLifecycleDraftable({ moderationState: 'allowed', publicationState: 'draft' }), true);
  assert.equal(isUploadLifecyclePromptManageable({ moderationState: 'allowed', publicationState: 'draft' }), false);
  assert.equal(isUploadLifecycleDraftable({ moderationState: 'allowed', publicationState: 'published' }), false);
  assert.equal(isUploadLifecyclePromptManageable({ moderationState: 'allowed', publicationState: 'published' }), false);
});

test('initial result state distinguishes review, correction, rejection and allowed', () => {
  assert.equal(resolveModerationStateForResult({ outcome: 'allowed' }), MODERATION_STATES.allowed);
  assert.equal(resolveModerationStateForResult({ outcome: 'forbidden', publishBlocked: true }), MODERATION_STATES.rejected);
  assert.equal(resolveModerationStateForResult({ outcome: 'forbidden', publishBlocked: true, reviewCaseId: 'case-a' }), MODERATION_STATES.reviewPending);
  assert.equal(resolveModerationStateForResult({ outcome: 'review', shouldReview: true }), MODERATION_STATES.reviewPending);
  assert.equal(resolveModerationStateForResult({ outcome: 'needsCorrection', requiresUploaderAcceptance: true }), MODERATION_STATES.correctionPending);
});
'''
Path('functions/test/moderationLifecycle.test.js').write_text(lifecycle_test, encoding='utf-8')

# Server publication gate now consumes canonical lifecycle authority. Legacy state
# interpretation is isolated in moderationLifecycle.js instead of being repeated.
policy_path = Path('functions/userModerationActionPolicy.js')
policy = policy_path.read_text(encoding='utf-8')
policy = replace_once(
    policy,
    "const APPROVED_PUBLICATION_STATUSES = new Set([\n  '',\n  'pending',\n  'correction_accepted',\n  'draft',\n  'published',\n]);\n",
    "import {\n  isUploadLifecycleDraftable,\n  isUploadLifecyclePromptManageable,\n  isUploadLifecyclePublishable,\n} from './moderationLifecycle.js';\n",
    'replace publication status authority import',
)
old_can_publish = '''export function canPublishUpload(upload = {}) {
  const mediaState = String(upload?.mediaState || '').trim();
  if (mediaState && mediaState !== 'ready') return false;
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
'''
new_can_publish = '''const hasReadyModerationMedia = (upload = {}) => {
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
'''
policy = replace_once(policy, old_can_publish, new_can_publish, 'canonical publication gate')
policy_path.write_text(policy, encoding='utf-8')

# Correction response validity uses the same lifecycle resolver. Classifier
# evidence remains a legacy fallback only; it cannot overrule canonical server state.
correction_path = Path('functions/uploaderCorrection.js')
correction = correction_path.read_text(encoding='utf-8')
correction = "import { isUploadLifecycleCorrectionPending } from './moderationLifecycle.js';\n\n" + correction
correction = correction.replace("const BLOCKED_OUTCOMES = new Set(['forbidden', 'explicit', 'reported', 'nocorrectionforbidden']);\nconst BLOCKED_CLASSIFICATIONS = new Set(['reviewrequired', 'sensitivecorrection', 'review_required']);\n", '', 1)
correction = replace_once(
    correction,
    "  if (upload?.requiresUploaderAcceptance !== true\n    || upload?.publicationStatus !== 'needs_user_correction'\n    || upload?.reviewStatus !== 'needs_user_correction') {\n    return { ok: false, error: 'Upload does not require uploader correction acceptance', status: 409 };\n  }\n",
    "  if (upload?.requiresUploaderAcceptance !== true\n    || !isUploadLifecycleCorrectionPending(upload)) {\n    return { ok: false, error: 'Upload does not require uploader correction acceptance', status: 409 };\n  }\n",
    'canonical correction lifecycle gate',
)
correction = replace_once(
    correction,
    "  const outcome = String(upload?.outcome || '').trim().toLowerCase();\n  const classification = String(upload?.classification || '').trim().toLowerCase();\n  const shouldReview = upload?.shouldReview === true;\n  if (BLOCKED_OUTCOMES.has(outcome) || BLOCKED_CLASSIFICATIONS.has(classification) || shouldReview) {\n    return { ok: false, error: 'Upload is blocked by moderation policy', status: 409 };\n  }\n\n",
    '',
    'remove duplicate classifier authority from correction response',
)
correction_path.write_text(correction, encoding='utf-8')

# Media retention uses publicationState as authority when present. The review case,
# not correction provenance or a mirrored upload review flag, determines active review.
preview_path = Path('functions/moderationPreviewStorage.js')
preview = preview_path.read_text(encoding='utf-8')
preview = "import { PUBLICATION_STATES, resolveUploadLifecycle } from './moderationLifecycle.js';\n\n" + preview
preview = preview.replace("const KNOWN_EXPIRABLE_REVIEW_STATUSES = new Set([\n  '',\n  'approved',\n  'rejected',\n  'needs_user_correction',\n  'freshEvalQueued',\n  'closedNoFingerprint',\n]);\n\nconst KNOWN_EXPIRABLE_PUBLICATION_STATUSES = new Set([\n  '',\n  'pending',\n  'correction_accepted',\n  'needs_user_correction',\n  'user_disagreed',\n  'blocked',\n  'discarded',\n  'deleted',\n  'deleted_pending_cleanup',\n  'freshEvalQueued',\n  'closedNoFingerprint',\n  'expired',\n]);\n\n", '', 1)
old_retention_lifecycle = '''  const publicationStatus = normalizeStatus(uploadData?.publicationStatus || uploadData?.publishStatus);
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
'''
new_retention_lifecycle = '''  const lifecycle = resolveUploadLifecycle(uploadData);
  const normalizedReviewCaseStatuses = Array.isArray(reviewCaseStatuses)
    ? reviewCaseStatuses.map(normalizeStatus).filter(Boolean)
    : [];
  if (!lifecycle.valid) {
    return { action: 'defer', reason: 'unknown_lifecycle_state', storagePath };
  }

  if (lifecycle.publicationState === PUBLICATION_STATES.published) {
    return { action: 'preserve', reason: 'published_state', storagePath };
  }

  // Legacy post-deletion retry state maps to canonical discarded. It remains
  // explicitly cleanup-eligible while older documents are phased out.
  const legacyPublicationStatus = normalizeStatus(uploadData?.publicationStatus || uploadData?.publishStatus);
  if (legacyPublicationStatus === 'deleted_pending_cleanup') {
    return { action: 'expire', reason: 'post_deleted_cleanup_pending', storagePath };
  }

  const legacyActiveReview = lifecycle.moderationCanonical !== true
    && normalizeStatus(uploadData?.reviewStatus) === 'inReview';
  if (legacyActiveReview || normalizedReviewCaseStatuses.includes('inReview')) {
    return { action: 'defer', reason: 'active_review', storagePath };
  }

  if (lifecycle.publicationState === PUBLICATION_STATES.draft) {
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

  return { action: 'expire', reason: 'retention_elapsed', storagePath };
'''
preview = replace_once(preview, old_retention_lifecycle, new_retention_lifecycle, 'canonical preview retention lifecycle')
old_deleted_cleanup = '''  const persistedPostId = pickString(uploadData?.postId);
  const publicationStatus = pickString(uploadData?.publicationStatus, uploadData?.publishStatus);
  const cleanupEligibleStatus = publicationStatus === 'published' || publicationStatus === 'deleted_pending_cleanup';
  if (persistedPostId !== normalizedPostId || !cleanupEligibleStatus) {
    return { ok: false, reason: 'not_matching_published_upload' };
  }
'''
new_deleted_cleanup = '''  const persistedPostId = pickString(uploadData?.postId);
  const lifecycle = resolveUploadLifecycle(uploadData);
  const legacyPublicationStatus = pickString(uploadData?.publicationStatus, uploadData?.publishStatus);
  const cleanupEligibleStatus = lifecycle.valid
    && (lifecycle.publicationState === PUBLICATION_STATES.published
      || legacyPublicationStatus === 'deleted_pending_cleanup');
  if (persistedPostId !== normalizedPostId || !cleanupEligibleStatus) {
    return { ok: false, reason: 'not_matching_published_upload' };
  }
'''
preview = replace_once(preview, old_deleted_cleanup, new_deleted_cleanup, 'canonical deleted-post cleanup lifecycle')
preview_path.write_text(preview, encoding='utf-8')

# Main server transitions persist canonical authority while mirroring legacy fields.
index_path = Path('functions/index.js')
index = index_path.read_text(encoding='utf-8')
index = replace_once(
    index,
    "import { canPublishUpload, getUserPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';",
    "import { canManageApprovedUploadPrompt, canPublishUpload, canSaveDraftUpload, getUserPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';",
    'publication action policy imports',
)
index = replace_once(
    index,
    "import { getOpenReviewCountAfterCaseExit, getReviewAccessDecision } from './reviewLifecycle.js';",
    "import { getOpenReviewCountAfterCaseExit, getReviewAccessDecision } from './reviewLifecycle.js';\nimport { MODERATION_STATES, PUBLICATION_STATES, resolveModerationStateForResult, resolveUploadLifecycle } from './moderationLifecycle.js';",
    'canonical lifecycle import',
)
index = replace_once(
    index,
    "        moderationScopeKey: requestModerationScope.scopeKey,\n        ...(isCodexActor ? { testActor: CODEX_DEV_ACTOR } : {}),\n        outcome,",
    "        moderationScopeKey: requestModerationScope.scopeKey,\n        moderationState: resolveModerationStateForResult({\n          outcome,\n          shouldReview: effectiveShouldReview,\n          publishBlocked,\n          reviewCaseId,\n          requiresUploaderAcceptance: routedUserCorrection,\n        }),\n        publicationState: PUBLICATION_STATES.pending,\n        ...(isCodexActor ? { testActor: CODEX_DEV_ACTOR } : {}),\n        outcome,",
    'initial canonical moderation lifecycle',
)
index = replace_once(
    index,
    "        reviewCaseId,\n        reviewStatus: 'inReview',\n        reviewRequestedAt: FieldValue.serverTimestamp(),",
    "        reviewCaseId,\n        moderationState: MODERATION_STATES.reviewPending,\n        publicationState: PUBLICATION_STATES.pending,\n        reviewStatus: 'inReview',\n        reviewRequestedAt: FieldValue.serverTimestamp(),",
    'manual review canonical lifecycle',
)
index = replace_once(
    index,
    "          reviewStatus: uploadReviewStatus,\n          ...moderatorLifecycleState,",
    "          moderationState: !isApproved\n            ? MODERATION_STATES.rejected\n            : requiresUploaderAcceptance\n              ? MODERATION_STATES.correctionPending\n              : MODERATION_STATES.allowed,\n          publicationState: PUBLICATION_STATES.pending,\n          reviewStatus: uploadReviewStatus,\n          ...moderatorLifecycleState,",
    'moderator decision canonical lifecycle',
)
index = replace_once(
    index,
    "        transaction.set(linkedUpload.ref, {\n          reviewStatus: nextStatus,\n          publicationStatus: nextStatus,",
    "        transaction.set(linkedUpload.ref, {\n          moderationState: MODERATION_STATES.superseded,\n          publicationState: PUBLICATION_STATES.pending,\n          reviewStatus: nextStatus,\n          publicationStatus: nextStatus,",
    'fresh evaluation canonical lifecycle',
)
index = replace_once(
    index,
    "        if (action === 'saveDraft' && latestUpload?.reviewStatus !== 'approved') {\n          const error = new Error('Upload is not approved');\n          error.status = 409;\n          throw error;\n        }\n        if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && latestUpload?.reviewStatus !== 'approved') {\n          const error = new Error('Upload is not approved');\n          error.status = 409;\n          throw error;\n        }\n        if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && latestPublicationStatus === 'published') {\n          const error = new Error('Upload is already published');\n          error.status = 409;\n          throw error;\n        }",
    "        if (action === 'saveDraft' && !canSaveDraftUpload(latestUpload)) {\n          const error = new Error('Upload is not approved for draft persistence');\n          error.status = 409;\n          throw error;\n        }\n        if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload')\n          && !canManageApprovedUploadPrompt(latestUpload)) {\n          const error = new Error('Upload publication prompt is no longer actionable');\n          error.status = 409;\n          throw error;\n        }",
    'canonical user action lifecycle gates',
)
index = replace_once(
    index,
    "            publicationStatus: 'discarded',\n            publishStatus: 'discarded',",
    "            publicationState: PUBLICATION_STATES.discarded,\n            publicationStatus: 'discarded',\n            publishStatus: 'discarded',",
    'discard canonical publication state',
)
index = replace_once(
    index,
    "            publicationStatus: action === 'acceptCorrection' ? 'correction_accepted' : 'user_disagreed',\n            reviewStatus: action === 'acceptCorrection' ? 'approved' : 'needs_user_correction',",
    "            moderationState: action === 'acceptCorrection'\n              ? MODERATION_STATES.allowed\n              : MODERATION_STATES.reviewPending,\n            publicationState: PUBLICATION_STATES.pending,\n            publicationStatus: action === 'acceptCorrection' ? 'correction_accepted' : 'user_disagreed',\n            reviewStatus: action === 'acceptCorrection' ? 'approved' : 'inReview',",
    'correction canonical lifecycle',
)
index = replace_once(
    index,
    "            publicationStatus: 'published',\n            publishStatus: 'published',\n            publishedAt: FieldValue.serverTimestamp(),",
    "            publicationState: PUBLICATION_STATES.published,\n            publicationStatus: 'published',\n            publishStatus: 'published',\n            publishedAt: FieldValue.serverTimestamp(),",
    'publication canonical state',
)
index = replace_once(
    index,
    "            publicationStatus: 'draft',\n            publishStatus: 'draft',\n            draftId: draftRef.id,",
    "            publicationState: PUBLICATION_STATES.draft,\n            publicationStatus: 'draft',\n            publishStatus: 'draft',\n            draftId: draftRef.id,",
    'draft canonical publication state',
)
# Retention expiry and recovery paths.
index = replace_once(
    index,
    "    const publicationStatus = String(uploadData?.publicationStatus || uploadData?.publishStatus || '').trim();\n    const draftId = String(uploadData?.draftId || '').trim();",
    "    const lifecycle = resolveUploadLifecycle(uploadData);\n    const publicationStatus = lifecycle.valid ? lifecycle.publicationState : null;\n    const draftId = String(uploadData?.draftId || '').trim();",
    'retention canonical publication read',
)
index = replace_once(
    index,
    "    if (publicationStatus === 'draft'\n",
    "    if (publicationStatus === PUBLICATION_STATES.draft\n",
    'retention draft canonical comparison',
)
index = replace_once(
    index,
    "      publicationStatus: 'expired',\n      publishStatus: 'expired',",
    "      publicationState: PUBLICATION_STATES.expired,\n      publicationStatus: 'expired',\n      publishStatus: 'expired',",
    'retention expired canonical publication state',
)
index = replace_once(
    index,
    "      previewExpiredFromPublicationStatus: publicationStatus || null,",
    "      previewExpiredFromPublicationStatus: String(uploadData?.publicationStatus || uploadData?.publishStatus || publicationStatus || '').trim() || null,",
    'retain legacy expiry audit state',
)
index = replace_once(
    index,
    "      publicationStatus: 'published',\n      publishStatus: 'published',\n      postId: uploadRef.id,\n      mediaState: 'ready',",
    "      publicationState: PUBLICATION_STATES.published,\n      publicationStatus: 'published',\n      publishStatus: 'published',\n      postId: uploadRef.id,\n      mediaState: 'ready',",
    'expiry race canonical published recovery',
)
# Published post deletion paths: publication is discarded immediately even while media cleanup retries.
index = replace_once(
    index,
    "        publicationStatus: 'deleted_pending_cleanup',\n        publishStatus: 'deleted_pending_cleanup',",
    "        publicationState: PUBLICATION_STATES.discarded,\n        publicationStatus: 'deleted_pending_cleanup',\n        publishStatus: 'deleted_pending_cleanup',",
    'deleted post cleanup pending canonical state',
)
index = replace_once(
    index,
    "    publicationStatus: 'deleted',\n    publishStatus: 'deleted',\n    deletedPostAt: FieldValue.serverTimestamp(),",
    "    publicationState: PUBLICATION_STATES.discarded,\n    publicationStatus: 'deleted',\n    publishStatus: 'deleted',\n    deletedPostAt: FieldValue.serverTimestamp(),",
    'deleted post canonical state',
)
# Cleanup finalization may transition legacy deleted_pending_cleanup to deleted; keep canonical discarded.
index = replace_once(
    index,
    "        ...(publicationStatus === 'deleted_pending_cleanup' ? {\n          publicationStatus: 'deleted',\n          publishStatus: 'deleted',\n        } : {}),",
    "        ...(publicationStatus === 'deleted_pending_cleanup' ? {\n          publicationState: PUBLICATION_STATES.discarded,\n          publicationStatus: 'deleted',\n          publishStatus: 'deleted',\n        } : {}),",
    'cleanup final canonical discarded state',
)
index_path.write_text(index, encoding='utf-8')

# Client routing reads canonical fields first for resume behavior, but never becomes
# an authority: the server publication endpoint revalidates the persisted upload.
client_routing_path = Path('src/utils/moderationPublicationRouting.js')
client_routing = client_routing_path.read_text(encoding='utf-8')
client_routing = replace_once(
    client_routing,
    "  const resumeUploadId = clean(resumeUpload?.id);\n  const resumePublicationStatus = clean(resumeUpload?.publicationStatus || resumeUpload?.publishStatus);\n  if (\n    isResumeFlow\n    && resumeUploadId\n    && resumeUpload?.reviewStatus === 'approved'\n    && PERSISTED_RESUME_PUBLICATION_STATUSES.has(resumePublicationStatus)\n  ) {",
    "  const resumeUploadId = clean(resumeUpload?.id);\n  const resumeModerationAllowed = resumeUpload?.moderationState\n    ? clean(resumeUpload.moderationState) === 'allowed'\n    : resumeUpload?.reviewStatus === 'approved';\n  const canonicalPublicationState = clean(resumeUpload?.publicationState);\n  const resumePublicationPending = canonicalPublicationState\n    ? canonicalPublicationState === 'pending'\n    : PERSISTED_RESUME_PUBLICATION_STATUSES.has(clean(resumeUpload?.publicationStatus || resumeUpload?.publishStatus));\n  if (\n    isResumeFlow\n    && resumeUploadId\n    && resumeModerationAllowed\n    && resumePublicationPending\n  ) {",
    'client canonical resume routing',
)
client_routing_path.write_text(client_routing, encoding='utf-8')

# Local correction-success UI mirrors canonical fields as hints only; the server
# remains authoritative on every publication mutation.
app_path = Path('src/ArtesApp.jsx')
app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "          ? { ...previous, reviewStatus: 'approved', publicationStatus: 'correction_accepted', requiresUploaderAcceptance: false }",
    "          ? { ...previous, moderationState: 'allowed', publicationState: 'pending', reviewStatus: 'approved', publicationStatus: 'correction_accepted', requiresUploaderAcceptance: false }",
    'client correction lifecycle hint',
)
app_path.write_text(app, encoding='utf-8')

# Existing policy tests gain canonical authority coverage and the stricter draft/prompt gates.
policy_test_path = Path('functions/test/userModerationActionPolicy.test.js')
policy_test = policy_test_path.read_text(encoding='utf-8')
policy_test = replace_once(
    policy_test,
    "import { canPublishUpload, canUserPublishPublicPost, getUserPublicPostPublishDecision, requiresMessageIdForAction } from '../userModerationActionPolicy.js';",
    "import { canManageApprovedUploadPrompt, canPublishUpload, canSaveDraftUpload, canUserPublishPublicPost, getUserPublicPostPublishDecision, requiresMessageIdForAction } from '../userModerationActionPolicy.js';",
    'policy test imports',
)
policy_test += r'''

test('canonical allowed state is publication authority rather than stale evidence', () => {
  assert.equal(canPublishUpload({
    moderationState: 'allowed',
    publicationState: 'pending',
    mediaState: 'ready',
    outcome: 'forbidden',
    publishBlocked: true,
    forbiddenReasons: [{ reason: 'stale evidence' }],
  }), true);
});

test('draft and publication-prompt actions are lifecycle scoped', () => {
  const pending = { moderationState: 'allowed', publicationState: 'pending', mediaState: 'ready' };
  assert.equal(canSaveDraftUpload(pending), true);
  assert.equal(canManageApprovedUploadPrompt(pending), true);
  assert.equal(canSaveDraftUpload({ ...pending, publicationState: 'draft' }), true);
  assert.equal(canManageApprovedUploadPrompt({ ...pending, publicationState: 'draft' }), false);
  assert.equal(canSaveDraftUpload({ ...pending, publicationState: 'published' }), false);
  assert.equal(canManageApprovedUploadPrompt({ ...pending, publicationState: 'discarded' }), false);
});
'''
policy_test_path.write_text(policy_test, encoding='utf-8')

# Correction tests cover canonical state overriding stale evidence while preserving
# legacy fail-closed behavior.
correction_test_path = Path('functions/test/uploaderCorrection.test.js')
correction_test = correction_test_path.read_text(encoding='utf-8')
correction_test += r'''

test('canonical correction-pending state is authoritative over stale classifier evidence', () => {
  const result = validateUploaderCorrectionAction({
    action: 'acceptCorrection',
    userId: 'u1',
    upload: {
      ...baseUpload,
      moderationState: 'correction_pending',
      publicationState: 'pending',
      outcome: 'forbidden',
      publishBlocked: true,
      forbiddenReasons: [{ reason: 'stale evidence' }],
    },
  });
  assert.equal(result.ok, true);
});

test('canonical non-correction lifecycle cannot accept a stale correction prompt', () => {
  for (const moderationState of ['allowed', 'review_pending', 'rejected', 'superseded']) {
    const result = validateUploaderCorrectionAction({
      action: 'acceptCorrection',
      userId: 'u1',
      upload: {
        ...baseUpload,
        moderationState,
        publicationState: 'pending',
      },
    });
    assert.equal(result.ok, false, moderationState);
  }
});
'''
correction_test_path.write_text(correction_test, encoding='utf-8')

# Client routing regression for canonical resume state.
client_test_path = Path('tests/moderationPublicationRouting.logic.test.mjs')
client_test = client_test_path.read_text(encoding='utf-8')
client_test += r'''

test('resume routing prefers canonical lifecycle fields when present', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: {
      id: 'canonical-upload',
      moderationState: 'allowed',
      publicationState: 'pending',
      reviewStatus: 'rejected',
      publicationStatus: 'blocked',
    },
  }), 'canonical-upload');
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: {
      id: 'stale-upload',
      moderationState: 'superseded',
      publicationState: 'pending',
      reviewStatus: 'approved',
      publicationStatus: 'pending',
    },
  }), null);
});
'''
client_test_path.write_text(client_test, encoding='utf-8')

# Source-level architecture regression: canonical fields must be persisted at every
# authoritative transition and user actions must not gate directly on reviewStatus.
source_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const policySource = fs.readFileSync(new URL('../functions/userModerationActionPolicy.js', import.meta.url), 'utf8');
const correctionSource = fs.readFileSync(new URL('../functions/uploaderCorrection.js', import.meta.url), 'utf8');
const retentionSource = fs.readFileSync(new URL('../functions/moderationPreviewStorage.js', import.meta.url), 'utf8');

test('server publication and correction decisions use the canonical lifecycle resolver', () => {
  assert.match(policySource, /isUploadLifecyclePublishable/);
  assert.match(policySource, /isUploadLifecycleDraftable/);
  assert.match(policySource, /isUploadLifecyclePromptManageable/);
  assert.doesNotMatch(policySource, /const reviewStatus =/);
  assert.doesNotMatch(policySource, /APPROVED_PUBLICATION_STATUSES/);
  assert.match(correctionSource, /isUploadLifecycleCorrectionPending/);
  assert.doesNotMatch(correctionSource, /BLOCKED_OUTCOMES/);
  assert.doesNotMatch(correctionSource, /BLOCKED_CLASSIFICATIONS/);
});

test('authoritative upload transitions persist canonical moderation and publication states', () => {
  assert.match(indexSource, /moderationState: resolveModerationStateForResult\(/);
  assert.match(indexSource, /moderationState: MODERATION_STATES\.reviewPending/);
  assert.match(indexSource, /moderationState: MODERATION_STATES\.superseded/);
  assert.match(indexSource, /MODERATION_STATES\.correctionPending/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.pending/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.draft/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.published/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.discarded/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.expired/);
});

test('user actions no longer make direct reviewStatus approval decisions', () => {
  const start = indexSource.indexOf('export const userModerationAction');
  const end = indexSource.indexOf('export const getContributorByAliasCallable', start);
  const actionSource = indexSource.slice(start, end);
  assert.match(actionSource, /canPublishUpload\(latestUpload\)/);
  assert.match(actionSource, /canSaveDraftUpload\(latestUpload\)/);
  assert.match(actionSource, /canManageApprovedUploadPrompt\(latestUpload\)/);
  assert.doesNotMatch(actionSource, /latestUpload\?\.reviewStatus !== 'approved'/);
});

test('correction rejection mirrors its newly active operational review case', () => {
  const start = indexSource.indexOf('if (correctionPlan)');
  const end = indexSource.indexOf('if (publicationPlan)', start);
  const correctionMutation = indexSource.slice(start, end);
  assert.match(correctionMutation, /MODERATION_STATES\.reviewPending/);
  assert.match(correctionMutation, /reviewStatus: action === 'acceptCorrection' \? 'approved' : 'inReview'/);
  assert.match(correctionMutation, /status: 'inReview'/);
});

test('media retention consumes canonical lifecycle while active-review retention stays case-owned', () => {
  assert.match(retentionSource, /resolveUploadLifecycle\(uploadData\)/);
  assert.match(retentionSource, /lifecycle\.publicationState === PUBLICATION_STATES\.published/);
  assert.match(retentionSource, /normalizedReviewCaseStatuses\.includes\('inReview'\)/);
  assert.match(retentionSource, /lifecycle\.moderationCanonical !== true/);
});
'''
Path('tests/moderationCanonicalLifecycleSource.test.mjs').write_text(source_test, encoding='utf-8')

# Update the architecture contract to record that canonical fields are now runtime
# authority and legacy aliases are compatibility mirrors only.
doc_path = Path('docs/moderation-state-machine.md')
doc = doc_path.read_text(encoding='utf-8')
doc = replace_once(
    doc,
    "During compatibility with existing documents, legacy `reviewStatus`, `publicationStatus` and `publishStatus` may be mirrored, but all server decisions should go through one lifecycle helper rather than reimplementing precedence rules.",
    "Canonical `moderationState` and `publicationState` are runtime authority on new writes. During compatibility with existing documents, legacy `reviewStatus`, `publicationStatus` and `publishStatus` are mirrored for existing clients and are interpreted only by the central lifecycle resolver when canonical state is absent. Canonical state wins over stale classifier evidence; malformed or conflicting lifecycle aliases fail closed. Server publication, correction, draft/prompt and media-retention decisions go through the shared lifecycle resolver rather than reimplementing precedence rules.",
    'document canonical lifecycle authority',
)
doc_path.write_text(doc, encoding='utf-8')

print('canonical moderation lifecycle refactor applied')
