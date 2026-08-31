import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageApprovedUploadPrompt, canPublishUpload, canSaveDraftUpload, canUserPublishPublicPost, getUserPublicPostPublishDecision, requiresMessageIdForAction } from '../userModerationActionPolicy.js';

const safeAllowedState = {
  outcome: 'allowed',
  shouldReview: false,
  publishBlocked: false,
  forbiddenReasons: [],
};

test('explicit moderation media must be ready before publication', () => {
  for (const mediaState of ['pending', 'cleanup_pending', 'deleted']) {
    assert.equal(canPublishUpload({ ...safeAllowedState, mediaState }), false);
  }
  assert.equal(canPublishUpload({ ...safeAllowedState, mediaState: 'ready' }), true);
  assert.equal(canPublishUpload(safeAllowedState), true, 'legacy uploads without mediaState remain compatible');
});

test('publishNow is denied when requiresUploaderAcceptance is true', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', requiresUploaderAcceptance: true }), false);
});

test('publishNow is denied when publicationStatus is needs_user_correction', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'needs_user_correction' }), false);
});

test('publishNow is denied when publicationStatus is user_disagreed', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'user_disagreed' }), false);
});

test('publishNow is denied when correction response is not accepted', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', correctedTaxonomy: { themes: ['A'], triggers: [] }, uploaderCorrectionResponse: { status: 'rejected' } }), false);
});

test('publishNow allowed after accepted correction in safe state', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', correctedTaxonomy: { themes: ['A'], triggers: [] }, uploaderCorrectionResponse: { status: 'accepted' }, requiresUploaderAcceptance: false, publicationStatus: 'correction_accepted' }), true);
});

test('server-created ordinary allowed moderation uploads are publishable only before lifecycle assignment', () => {
  assert.equal(canPublishUpload(safeAllowedState), true);
  assert.equal(canPublishUpload({ ...safeAllowedState, shouldReview: true }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, publishBlocked: true }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, forbiddenReasons: [{ reason: 'x' }] }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, publicationStatus: 'pending' }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, reviewStatus: 'pending' }), false);
});

test('stale allowed outcome cannot bypass review lifecycle states', () => {
  const blockedReviewStatuses = [
    'inReview',
    'needs_user_correction',
    'rejected',
    'freshEvalQueued',
    'closedNoFingerprint',
  ];

  blockedReviewStatuses.forEach((reviewStatus) => {
    assert.equal(
      canPublishUpload({ ...safeAllowedState, reviewStatus }),
      false,
      `expected reviewStatus=${reviewStatus} to block publication`,
    );
  });
});

test('stale allowed outcome cannot bypass publication lifecycle states', () => {
  const blockedPublicationStatuses = [
    'needs_user_correction',
    'user_disagreed',
    'discarded',
    'blocked',
    'freshEvalQueued',
    'closedNoFingerprint',
    'deleted',
  ];

  blockedPublicationStatuses.forEach((publicationStatus) => {
    assert.equal(
      canPublishUpload({ ...safeAllowedState, publicationStatus }),
      false,
      `expected publicationStatus=${publicationStatus} to block publication`,
    );
  });

  assert.equal(canPublishUpload({ ...safeAllowedState, publishStatus: 'freshEvalQueued' }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, publishStatus: 'closedNoFingerprint' }), false);
});

test('fresh-evaluation states override every stale publishable field combination', () => {
  assert.equal(canPublishUpload({ ...safeAllowedState, reviewStatus: 'freshEvalQueued', publicationStatus: 'freshEvalQueued' }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, reviewStatus: 'freshEvalQueued', publicationStatus: 'published' }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, reviewStatus: 'approved', publicationStatus: 'freshEvalQueued' }), false);
  assert.equal(canPublishUpload({ ...safeAllowedState, reviewStatus: 'closedNoFingerprint', publicationStatus: 'published' }), false);
});

test('approved uploads publish only through known approved publication states', () => {
  ['', 'pending', 'correction_accepted', 'draft', 'published'].forEach((publicationStatus) => {
    assert.equal(
      canPublishUpload({ reviewStatus: 'approved', publicationStatus }),
      true,
      `expected approved/${publicationStatus || '<empty>'} to be publishable`,
    );
  });

  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'blocked' }), false);
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'future_unknown_state' }), false);
});

test('legacy published uploads without reviewStatus remain publishable but conflicting review states fail closed', () => {
  assert.equal(canPublishUpload({ publicationStatus: 'published' }), true);
  assert.equal(canPublishUpload({ publishStatus: 'published' }), true);
  assert.equal(canPublishUpload({ reviewStatus: 'rejected', publicationStatus: 'published' }), false);
  assert.equal(canPublishUpload({ reviewStatus: 'inReview', publicationStatus: 'published' }), false);
});

test('messageId required only for publishNow/saveDraft/dismiss', () => {
  assert.equal(requiresMessageIdForAction('publishNow'), true);
  assert.equal(requiresMessageIdForAction('saveDraft'), true);
  assert.equal(requiresMessageIdForAction('dismiss'), true);
  assert.equal(requiresMessageIdForAction('acceptCorrection'), false);
  assert.equal(requiresMessageIdForAction('rejectCorrection'), false);
  assert.equal(requiresMessageIdForAction('repairPublished'), false);
  assert.equal(requiresMessageIdForAction('markPublicationPromptOpened'), false);
  assert.equal(requiresMessageIdForAction('discardApprovedUpload'), false);
});

test('publishNow is denied after an approved upload is discarded', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'discarded' }), false);
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publishStatus: 'discarded' }), false);
});

test('public post publishing requires adult user document state', () => {
  assert.equal(canUserPublishPublicPost({ ageVerified: true, isAdult: true }), true);
  assert.equal(canUserPublishPublicPost({ ageVerified: false, isAdult: true }), false);
  assert.equal(canUserPublishPublicPost({ ageVerified: true, isAdult: false }), false);
  assert.equal(getUserPublicPostPublishDecision(null).code, 'adult_verification_required');
});

test('public post publishing denies underage Didit or IDV status with safe code', () => {
  assert.deepEqual(getUserPublicPostPublishDecision({ ageVerified: true, isAdult: true, didit: { status: 'underage' } }), {
    allowed: false,
    code: 'underage',
  });
  assert.deepEqual(getUserPublicPostPublishDecision({ ageVerified: true, isAdult: true, idv: { status: 'underage' } }), {
    allowed: false,
    code: 'underage',
  });
});


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
