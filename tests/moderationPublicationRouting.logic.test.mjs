import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePersistedModerationPublicationUploadId } from '../src/utils/moderationPublicationRouting.js';

test('legacy resume publication uses persisted pending upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', reviewStatus: 'approved', publicationStatus: 'pending' },
  }), 'u1');
});

test('legacy resume publication also finalizes accepted corrections', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', reviewStatus: 'approved', publicationStatus: 'correction_accepted' },
  }), 'u1');
});

test('fresh exact-match accepted correction publishes through persisted upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    reviewUploadId: 'exact-upload',
    acceptedModeratorCorrection: true,
  }), 'exact-upload');
});

test('ordinary fresh upload does not route through persisted upload endpoint', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({ reviewUploadId: 'ordinary-upload' }), null);
});

test('accepted moderator correction routes persisted publication even when resume state is stale', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', moderationState: 'correction_pending', publicationState: 'pending' },
    reviewUploadId: 'u1',
    acceptedModeratorCorrection: true,
    currentModerationAllowed: true,
  }), 'u1');
});

test('ordinary allowed moderation result routes through its persisted upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    reviewUploadId: 'moderated-upload',
    currentModerationAllowed: true,
  }), 'moderated-upload');
});

test('resume routing uses canonical lifecycle authority over stale mirrors', () => {
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
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: {
      id: 'unknown-upload',
      moderationState: 'future_state',
      publicationState: 'pending',
      reviewStatus: 'approved',
      publicationStatus: 'pending',
    },
  }), null);
});
