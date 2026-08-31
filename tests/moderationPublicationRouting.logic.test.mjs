import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePersistedModerationPublicationUploadId } from '../src/utils/moderationPublicationRouting.js';

test('resume publication uses persisted pending upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', reviewStatus: 'approved', publicationStatus: 'pending' },
  }), 'u1');
});

test('resume publication also finalizes accepted corrections', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', reviewStatus: 'approved', publicationStatus: 'correction_accepted' },
  }), 'u1');
});

test('fresh exact-match accepted correction publishes through persisted upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: false,
    reviewUploadId: 'exact-upload',
    acceptedModeratorCorrection: true,
  }), 'exact-upload');
});

test('ordinary fresh upload does not route through persisted upload endpoint', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: false,
    reviewUploadId: 'ordinary-upload',
    acceptedModeratorCorrection: false,
  }), null);
});

test('accepted moderator correction routes persisted publication even when resume state is stale', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: true,
    resumeUpload: { id: 'u1', reviewStatus: 'needs_user_correction', publicationStatus: 'needs_user_correction' },
    reviewUploadId: 'u1',
    acceptedModeratorCorrection: true,
    currentModerationAllowed: true,
  }), 'u1');
});

test('ordinary allowed moderation result routes through its persisted upload', () => {
  assert.equal(resolvePersistedModerationPublicationUploadId({
    isResumeFlow: false,
    reviewUploadId: 'moderated-upload',
    currentModerationAllowed: true,
  }), 'moderated-upload');
});


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
