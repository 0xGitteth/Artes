import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDeletedPublishedPostCleanupDecision,
  getModerationPreviewCleanupTaskDecision,
  getModerationPreviewRetentionDecision,
  getOperationalModerationPreviewReviewCaseId,
  isOperationalModerationPreviewReviewCase,
  resolveOwnedModerationPreviewStoragePath,
} from '../moderationPreviewStorage.js';

const basePreviewUpload = {
  userId: 'user-1',
  storagePath: 'moderation-previews/user-1/abc.jpg',
  imageRef: 'moderation-previews/user-1/abc.jpg',
};

test('owned moderation preview path resolves for canonical server upload state', () => {
  assert.equal(resolveOwnedModerationPreviewStoragePath(basePreviewUpload), 'moderation-previews/user-1/abc.jpg');
});

test('preview cleanup path fails closed for cross-owner, traversal, disagreement and unrelated storage', () => {
  for (const upload of [
    { userId: 'user-1', storagePath: 'moderation-previews/user-2/abc.jpg' },
    { userId: 'user-1', storagePath: 'moderation-previews/user-1/../abc.jpg' },
    { userId: 'user-1', storagePath: 'public-posts/user-1/abc.jpg' },
    { userId: 'user-1', storagePath: 'moderation-previews/user-1/abc.jpg', imageRef: 'moderation-previews/user-1/other.jpg' },
    { userId: 'user/1', storagePath: 'moderation-previews/user/1/abc.jpg' },
    { storagePath: 'moderation-previews/user-1/abc.jpg' },
  ]) {
    assert.equal(resolveOwnedModerationPreviewStoragePath(upload), null);
  }
});

test('retention expires abandoned initial, approved, rejected and fresh-evaluation attempts', () => {
  const cases = [
    { ...basePreviewUpload, outcome: 'allowed' },
    { ...basePreviewUpload, outcome: 'forbidden', publishBlocked: true },
    { ...basePreviewUpload, reviewStatus: 'approved', publicationStatus: 'pending' },
    { ...basePreviewUpload, reviewStatus: 'approved', publicationStatus: 'correction_accepted' },
    { ...basePreviewUpload, reviewStatus: 'rejected', publicationStatus: 'blocked' },
    { ...basePreviewUpload, reviewStatus: 'needs_user_correction', publicationStatus: 'needs_user_correction' },
    { ...basePreviewUpload, reviewStatus: 'needs_user_correction', publicationStatus: 'user_disagreed' },
    { ...basePreviewUpload, reviewStatus: 'freshEvalQueued', publicationStatus: 'freshEvalQueued' },
    { ...basePreviewUpload, reviewStatus: 'closedNoFingerprint', publicationStatus: 'closedNoFingerprint' },
    { ...basePreviewUpload, reviewStatus: 'approved', publicationStatus: 'deleted_pending_cleanup' },
    { ...basePreviewUpload, publicationStatus: 'expired' },
  ];

  for (const uploadData of cases) {
    assert.equal(getModerationPreviewRetentionDecision({ uploadData }).action, 'expire');
  }
});

test('post-deletion cleanup state overrides stale review metadata', () => {
  assert.deepEqual(getModerationPreviewRetentionDecision({
    uploadData: {
      ...basePreviewUpload,
      reviewStatus: 'inReview',
      publicationStatus: 'deleted_pending_cleanup',
    },
    reviewCaseStatuses: ['inReview'],
  }), {
    action: 'expire',
    reason: 'post_deleted_cleanup_pending',
    storagePath: basePreviewUpload.storagePath,
  });
});

test('retention defers active review even when the upload state itself looks terminal', () => {
  assert.deepEqual(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, reviewStatus: 'inReview', publicationStatus: 'user_disagreed' },
  }), {
    action: 'defer',
    reason: 'active_review',
    storagePath: basePreviewUpload.storagePath,
  });

  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, reviewStatus: 'needs_user_correction', publicationStatus: 'user_disagreed' },
    reviewCaseStatuses: ['inReview'],
  }).action, 'defer');
});

test('draft retention is bound to the exact persisted draft', () => {
  const uploadData = { ...basePreviewUpload, publicationStatus: 'draft', draftId: 'draft-1' };
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData,
    draftExists: true,
    draftMatchesUpload: true,
  }).reason, 'draft_still_exists');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData,
    draftExists: false,
    draftMatchesUpload: false,
  }).reason, 'draft_missing');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData,
    draftExists: true,
    draftMatchesUpload: false,
  }).reason, 'draft_binding_mismatch');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, publicationStatus: 'draft' },
  }).reason, 'legacy_draft_without_binding');
});

test('retention never expires published media or unknown future lifecycle states', () => {
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, publicationStatus: 'published' },
  }).action, 'preserve');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, reviewStatus: 'approved', publicationStatus: 'pending' },
    productionPostExists: true,
  }).action, 'preserve');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, reviewStatus: 'future_review_state', publicationStatus: 'pending' },
  }).reason, 'unknown_lifecycle_state');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, reviewStatus: 'approved', publicationStatus: 'future_publication_state' },
  }).reason, 'unknown_lifecycle_state');
});

test('retention clears stale scheduling metadata when no owned preview remains', () => {
  assert.deepEqual(getModerationPreviewRetentionDecision({
    uploadData: { userId: 'user-1', outcome: 'allowed' },
  }), {
    action: 'clear_retention',
    reason: 'no_owned_preview',
  });
});

test('post-delete cleanup requires the exact published upload and same owner', () => {
  const base = {
    postId: 'upload-1',
    postData: { authorOwnerUid: 'user-1' },
    uploadExists: true,
    uploadData: { userId: 'user-1', postId: 'upload-1', publicationStatus: 'published' },
  };
  assert.deepEqual(getDeletedPublishedPostCleanupDecision(base), {
    ok: true,
    postId: 'upload-1',
    ownerUid: 'user-1',
  });
  assert.deepEqual(getDeletedPublishedPostCleanupDecision({
    ...base,
    uploadData: { ...base.uploadData, publicationStatus: 'deleted_pending_cleanup' },
  }), {
    ok: true,
    postId: 'upload-1',
    ownerUid: 'user-1',
  });

  const cases = [
    [{ ...base, postId: '' }, 'missing_post_id'],
    [{ ...base, uploadExists: false }, 'upload_missing'],
    [{ ...base, postData: { authorOwnerUid: 'user-2' } }, 'owner_mismatch'],
    [{ ...base, uploadData: { ...base.uploadData, postId: 'other' } }, 'not_matching_published_upload'],
    [{ ...base, uploadData: { ...base.uploadData, publicationStatus: 'discarded' } }, 'not_matching_published_upload'],
  ];
  for (const [input, reason] of cases) {
    assert.deepEqual(getDeletedPublishedPostCleanupDecision(input), { ok: false, reason });
  }
});


test('only a direct owned review case can hold preview retention', () => {
  const uploadData = {
    ...basePreviewUpload,
    reviewCaseId: 'case-direct',
    correctionReviewCaseId: 'case-provenance-only',
  };
  assert.equal(getOperationalModerationPreviewReviewCaseId(uploadData), 'case-direct');
  assert.equal(getOperationalModerationPreviewReviewCaseId({
    ...basePreviewUpload,
    correctionReviewCaseId: 'case-provenance-only',
  }), null);

  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1',
    uploadData: { ...basePreviewUpload, userId: 'user-1' },
    reviewCaseData: { userId: 'user-1', caseType: 'upload', linkedUploadIds: ['upload-1'] },
  }), true);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1',
    uploadData: { ...basePreviewUpload, userId: 'user-1' },
    reviewCaseData: { userId: 'user-2', caseType: 'upload', linkedUploadIds: ['upload-1'] },
  }), false);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1',
    uploadData: { ...basePreviewUpload, userId: 'user-1' },
    reviewCaseData: { userId: 'user-1', caseType: 'upload', linkedUploadIds: ['other-upload'] },
  }), false);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1',
    uploadData: { ...basePreviewUpload, userId: 'user-1' },
    reviewCaseData: { userId: 'user-1', caseType: 'report', linkedUploadIds: ['upload-1'] },
  }), false);
});

test('orphan cleanup anchors preserve bound uploads and delete only unbound owned previews', () => {
  const task = {
    taskId: 'upload-1',
    taskData: {
      uploadId: 'upload-1',
      ownerUid: 'user-1',
      storagePath: 'moderation-previews/user-1/upload-1.jpg',
    },
  };
  assert.deepEqual(getModerationPreviewCleanupTaskDecision({
    ...task,
    uploadExists: false,
  }), {
    action: 'delete_orphan',
    reason: 'upload_missing',
    storagePath: 'moderation-previews/user-1/upload-1.jpg',
  });
  assert.deepEqual(getModerationPreviewCleanupTaskDecision({
    ...task,
    uploadExists: true,
    uploadData: {
      userId: 'user-1',
      storagePath: 'moderation-previews/user-1/upload-1.jpg',
    },
  }), {
    action: 'preserve_upload',
    reason: 'upload_owns_preview',
    storagePath: 'moderation-previews/user-1/upload-1.jpg',
  });
  assert.equal(getModerationPreviewCleanupTaskDecision({
    ...task,
    uploadExists: true,
    uploadData: {
      userId: 'user-1',
      storagePath: 'moderation-previews/user-1/other.jpg',
    },
  }).action, 'defer');
  assert.equal(getModerationPreviewCleanupTaskDecision({
    ...task,
    taskData: { ...task.taskData, ownerUid: 'user-2' },
    uploadExists: false,
  }).action, 'drop_task');
});
