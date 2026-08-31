import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

test('every persisted moderation preview receives a bounded retention deadline', () => {
  assert.ok(indexSource.includes('previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry()'));
  assert.ok(indexSource.includes("process.env.MODERATION_PREVIEW_RETENTION_DAYS || '30'"));
});

test('scheduled preview garbage collection queries only due retention records', () => {
  assert.ok(indexSource.includes("import { onSchedule } from 'firebase-functions/v2/scheduler';"));
  assert.ok(indexSource.includes('export const cleanupExpiredModerationPreviews = onSchedule({'));
  assert.ok(indexSource.includes(".where('previewRetentionExpiresAt', '<=', now)"));
  assert.ok(indexSource.includes(".orderBy('previewRetentionExpiresAt', 'asc')"));
  assert.ok(indexSource.includes('getModerationPreviewRetentionDecision({'));
});

test('garbage collection claims expiration transactionally before deleting media', () => {
  const claimIndex = indexSource.indexOf("publicationStatus: 'expired'");
  const deleteIndex = indexSource.indexOf('await cleanupModerationPreviewForUpload({', claimIndex);
  assert.ok(claimIndex >= 0);
  assert.ok(deleteIndex > claimIndex);
  assert.ok(indexSource.includes('previewExpiryClaimId: claimId'));
  assert.ok(indexSource.includes('previewExpiredFromPublicationStatus'));
  assert.ok(indexSource.includes('previewExpiredFromReviewStatus'));
});

test('active reviews and drafts are rechecked instead of blindly deleted', () => {
  assert.ok(indexSource.includes('getOperationalModerationPreviewReviewCaseId(uploadData)'));
  assert.ok(indexSource.includes('isOperationalModerationPreviewReviewCase({'));
  assert.ok(indexSource.includes("publicationStatus === 'draft'"));
  assert.ok(indexSource.includes("collection('drafts').doc(draftId)"));
  assert.ok(indexSource.includes('draftMatchesUpload'));
  assert.ok(indexSource.includes('previewRetentionDeferredReason: decision.reason'));
});

test('draft and publication lifecycle refresh or remove retention metadata deliberately', () => {
  assert.ok(indexSource.includes('draftId: draftRef.id'));
  assert.ok(indexSource.includes("publishStatus: 'draft'"));
  assert.ok(indexSource.includes("publishStatus: 'published'"));
  assert.ok(indexSource.includes('previewRetentionExpiresAt: FieldValue.delete()'));
  assert.ok(indexSource.includes('mediaCleanupAfter: Timestamp.fromMillis(Date.now())'));
});

test('published-race recovery keeps referenced media instead of deleting it', () => {
  assert.ok(indexSource.includes("cleanup.reason === 'published_media_still_referenced'"));
  assert.ok(indexSource.includes('previewExpiryRaceRecoveredAt: FieldValue.serverTimestamp()'));
  assert.ok(indexSource.includes('restorePublishedModerationPreviewClaim'));
});
