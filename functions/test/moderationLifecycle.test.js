import test from 'node:test';
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

test('canonical lifecycle ignores stale legacy mirrors on modern uploads', () => {
  const pending = resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'blocked',
  });
  assert.equal(pending.valid, true);
  assert.equal(pending.moderationState, MODERATION_STATES.allowed);
  assert.equal(pending.publicationState, PUBLICATION_STATES.pending);

  const published = resolveUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'published',
    reviewStatus: 'rejected',
    publicationStatus: 'future_legacy_state',
  });
  assert.equal(published.valid, true);
  assert.equal(published.moderationState, MODERATION_STATES.allowed);
  assert.equal(published.publicationState, PUBLICATION_STATES.published);
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
