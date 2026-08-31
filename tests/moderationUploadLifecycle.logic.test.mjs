import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIENT_MODERATION_STATES,
  CLIENT_PUBLICATION_STATES,
  isClientUploadAllowedPending,
  isClientUploadCorrectionPending,
  isClientUploadDiscarded,
  resolveClientUploadLifecycle,
} from '../src/utils/moderationUploadLifecycle.js';

test('client canonical lifecycle wins over stale legacy mirrors', () => {
  const lifecycle = resolveClientUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'blocked',
  });
  assert.equal(lifecycle.valid, true);
  assert.equal(lifecycle.moderationState, CLIENT_MODERATION_STATES.allowed);
  assert.equal(lifecycle.publicationState, CLIENT_PUBLICATION_STATES.pending);
  assert.equal(isClientUploadAllowedPending({
    moderationState: 'allowed',
    publicationState: 'pending',
    reviewStatus: 'rejected',
    publicationStatus: 'discarded',
  }), true);
});

test('unknown canonical values fail closed even when legacy mirrors look approved', () => {
  assert.equal(resolveClientUploadLifecycle({
    moderationState: 'future_state',
    publicationState: 'pending',
    reviewStatus: 'approved',
    publicationStatus: 'pending',
  }).valid, false);
  assert.equal(resolveClientUploadLifecycle({
    moderationState: 'allowed',
    publicationState: 'future_state',
    reviewStatus: 'approved',
    publicationStatus: 'pending',
  }).valid, false);
});

test('legacy-only uploads retain bounded lifecycle compatibility', () => {
  assert.equal(isClientUploadAllowedPending({ reviewStatus: 'approved', publicationStatus: 'pending' }), true);
  assert.equal(isClientUploadAllowedPending({ reviewStatus: 'approved' }), true);
  assert.equal(isClientUploadCorrectionPending({
    reviewStatus: 'needs_user_correction',
    publicationStatus: 'needs_user_correction',
    requiresUploaderAcceptance: true,
  }), true);
  assert.equal(isClientUploadDiscarded({ reviewStatus: 'approved', publishStatus: 'deleted' }), true);
});

test('canonical correction and discard states drive UI predicates', () => {
  assert.equal(isClientUploadCorrectionPending({
    moderationState: 'correction_pending',
    publicationState: 'pending',
    reviewStatus: 'approved',
    publicationStatus: 'pending',
  }), true);
  assert.equal(isClientUploadDiscarded({
    moderationState: 'allowed',
    publicationState: 'discarded',
    publicationStatus: 'pending',
  }), true);
});
