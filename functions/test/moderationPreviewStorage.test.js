import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDeletedPublishedPostCleanupDecision,
  getModerationPendingMediaCleanupDecision,
  getModerationPreviewRetentionDecision,
  getOperationalModerationPreviewReviewCaseId,
  isOperationalModerationPreviewReviewCase,
  resolveModerationPreviewMediaState,
  resolveOwnedModerationPreviewStoragePath,
} from '../moderationPreviewStorage.js';

const basePreviewUpload = {
  userId: 'user-1',
  storagePath: 'moderation-previews/user-1/abc.jpg',
  imageRef: 'moderation-previews/user-1/abc.jpg',
};

test('owned moderation preview path resolves for canonical server upload state', () => {
  assert.equal(resolveOwnedModerationPreviewStoragePath(basePreviewUpload), 'moderation-previews/user-1/abc.jpg');
  assert.equal(resolveModerationPreviewMediaState(basePreviewUpload), 'legacy_ready');
  assert.equal(resolveModerationPreviewMediaState({ ...basePreviewUpload, mediaState: 'ready' }), 'ready');
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

test('pending media cleanup is bound to the upload document, deterministic path and due time', () => {
  const uploadData = {
    userId: 'user-1',
    mediaState: 'pending',
    storagePath: 'moderation-previews/user-1/upload-1.jpg',
    imageRef: 'moderation-previews/user-1/upload-1.jpg',
    mediaCleanupAfter: { seconds: 100 },
  };
  assert.deepEqual(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1',
    uploadData,
    nowMs: 100_000,
  }), {
    action: 'cleanup',
    reason: 'pending_upload_abandoned',
    storagePath: uploadData.storagePath,
  });
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData, nowMs: 99_999,
  }).reason, 'not_due');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-2', uploadData, nowMs: 100_000,
  }).reason, 'upload_storage_binding_mismatch');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...uploadData, mediaCleanupAfter: null }, nowMs: 100_000,
  }).reason, 'missing_cleanup_schedule');
});

test('ready/deleted media clears stray pending cleanup schedules while legacy media is not claimed', () => {
  const canonical = {
    userId: 'user-1',
    storagePath: 'moderation-previews/user-1/upload-1.jpg',
    imageRef: 'moderation-previews/user-1/upload-1.jpg',
    mediaCleanupAfter: { seconds: 1 },
  };
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...canonical, mediaState: 'ready' }, nowMs: 2_000,
  }).action, 'clear_schedule');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...canonical, mediaState: 'deleted' }, nowMs: 2_000,
  }).action, 'clear_schedule');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: canonical, nowMs: 2_000,
  }).action, 'skip');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...canonical, mediaState: 'future_state' }, nowMs: 2_000,
  }).reason, 'unknown_media_state');
});

test('retention expires abandoned initial, approved, rejected and fresh-evaluation ready attempts', () => {
  const cases = [
    { ...basePreviewUpload, mediaState: 'ready', outcome: 'allowed' },
    { ...basePreviewUpload, mediaState: 'ready', outcome: 'forbidden', publishBlocked: true },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'approved', publicationStatus: 'pending' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'approved', publicationStatus: 'correction_accepted' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'rejected', publicationStatus: 'blocked' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'needs_user_correction', publicationStatus: 'needs_user_correction' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'needs_user_correction', publicationStatus: 'user_disagreed' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'freshEvalQueued', publicationStatus: 'freshEvalQueued' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'closedNoFingerprint', publicationStatus: 'closedNoFingerprint' },
    { ...basePreviewUpload, reviewStatus: 'approved', publicationStatus: 'deleted_pending_cleanup' },
    { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'expired' },
  ];
  for (const uploadData of cases) {
    assert.equal(getModerationPreviewRetentionDecision({ uploadData }).action, 'expire');
  }
});

test('retention does not race media that is pending cleanup', () => {
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'cleanup_pending', publicationStatus: 'expired' },
  }).reason, 'media_not_ready');
});

test('post-deletion cleanup state overrides stale review metadata for legacy uploads', () => {
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
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'inReview', publicationStatus: 'user_disagreed' },
  }), {
    action: 'defer',
    reason: 'active_review',
    storagePath: basePreviewUpload.storagePath,
  });
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'needs_user_correction', publicationStatus: 'user_disagreed' },
    reviewCaseStatuses: ['inReview'],
  }).action, 'defer');
});

test('draft retention is bound to the exact persisted draft', () => {
  const uploadData = { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'draft', draftId: 'draft-1' };
  assert.equal(getModerationPreviewRetentionDecision({ uploadData, draftExists: true, draftMatchesUpload: true }).reason, 'draft_still_exists');
  assert.equal(getModerationPreviewRetentionDecision({ uploadData, draftExists: false, draftMatchesUpload: false }).reason, 'draft_missing');
  assert.equal(getModerationPreviewRetentionDecision({ uploadData, draftExists: true, draftMatchesUpload: false }).reason, 'draft_binding_mismatch');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'draft' },
  }).reason, 'legacy_draft_without_binding');
});

test('retention never expires published media or unknown future lifecycle states', () => {
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'published' },
  }).action, 'preserve');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'approved', publicationStatus: 'pending' },
    productionPostExists: true,
  }).action, 'preserve');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'future_review_state', publicationStatus: 'pending' },
  }).reason, 'unknown_lifecycle_state');
});

test('retention clears stale scheduling metadata when no owned preview remains', () => {
  assert.deepEqual(getModerationPreviewRetentionDecision({ uploadData: { userId: 'user-1', outcome: 'allowed' } }), {
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
  assert.deepEqual(getDeletedPublishedPostCleanupDecision(base), { ok: true, postId: 'upload-1', ownerUid: 'user-1' });
  assert.deepEqual(getDeletedPublishedPostCleanupDecision({
    ...base,
    uploadData: { ...base.uploadData, publicationStatus: 'deleted_pending_cleanup' },
  }), { ok: true, postId: 'upload-1', ownerUid: 'user-1' });
  const cases = [
    [{ ...base, postId: '' }, 'missing_post_id'],
    [{ ...base, uploadExists: false }, 'upload_missing'],
    [{ ...base, postData: { authorOwnerUid: 'user-2' } }, 'owner_mismatch'],
    [{ ...base, uploadData: { ...base.uploadData, postId: 'other' } }, 'not_matching_published_upload'],
    [{ ...base, uploadData: { ...base.uploadData, publicationStatus: 'discarded' } }, 'not_matching_published_upload'],
  ];
  for (const [input, reason] of cases) assert.deepEqual(getDeletedPublishedPostCleanupDecision(input), { ok: false, reason });
});

test('only a direct owned review case can hold preview retention', () => {
  const uploadData = { ...basePreviewUpload, reviewCaseId: 'case-direct', correctionReviewCaseId: 'case-provenance-only' };
  assert.equal(getOperationalModerationPreviewReviewCaseId(uploadData), 'case-direct');
  assert.equal(getOperationalModerationPreviewReviewCaseId({ ...basePreviewUpload, correctionReviewCaseId: 'case-provenance-only' }), null);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1', uploadData: { ...basePreviewUpload, userId: 'user-1' }, reviewCaseData: { userId: 'user-1', caseType: 'upload', linkedUploadIds: ['upload-1'] },
  }), true);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1', uploadData: { ...basePreviewUpload, userId: 'user-1' }, reviewCaseData: { userId: 'user-2', caseType: 'upload', linkedUploadIds: ['upload-1'] },
  }), false);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1', uploadData: { ...basePreviewUpload, userId: 'user-1' }, reviewCaseData: { userId: 'user-1', caseType: 'report', linkedUploadIds: ['upload-1'] },
  }), false);
});
