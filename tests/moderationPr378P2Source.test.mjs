import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const persistedSource = readFileSync(new URL('../functions/persistedPublication.js', import.meta.url), 'utf8');
const firestoreRulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('upload document is the durable preview anchor before Storage is touched', () => {
  const start = indexSource.indexOf("const uploadRef = db.collection('uploads').doc();");
  const end = indexSource.indexOf('if (reviewCaseId && uploadId)', start);
  const source = indexSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.indexOf("mediaState: 'pending'") < source.indexOf('persistedPreview = await persistModerationPreview({'));
  assert.ok(source.indexOf('transaction.create(uploadRef, {') < source.indexOf('persistedPreview = await persistModerationPreview({'));
  assert.ok(source.includes("mediaState: 'ready'"));
  assert.ok(source.includes('mediaCleanupAfter: FieldValue.delete()'));
  assert.ok(source.includes("mediaCleanupReason: 'moderation_generation_superseded'"));
});

test('preview cleanup has one upload-owned authority rather than a parallel cleanup-task collection', () => {
  assert.equal(indexSource.includes('moderationPreviewCleanupTasks'), false);
  assert.equal(firestoreRulesSource.includes('moderationPreviewCleanupTasks'), false);
  assert.ok(indexSource.includes(".where('mediaCleanupAfter', '<=', now)"));
  assert.ok(indexSource.includes('processPendingModerationPreviewMedia({'));
  assert.ok(indexSource.includes('mediaCleanupClaimId'));
});

test('preview retention ignores correction provenance and validates operational case ownership/reference', () => {
  const start = indexSource.indexOf('const claimExpiredModerationPreview = async');
  const end = indexSource.indexOf('const finalizeExpiredModerationPreviewClaim', start);
  const source = indexSource.slice(start, end);
  assert.ok(source.includes('getOperationalModerationPreviewReviewCaseId(uploadData)'));
  assert.ok(source.includes('isOperationalModerationPreviewReviewCase({'));
  assert.equal(source.includes('correctionReviewCaseId'), false);
});

test('persisted publication has one timestamp rehydration boundary for consent and correction data', () => {
  assert.ok(persistedSource.includes("import { Timestamp } from 'firebase-admin/firestore';"));
  assert.ok(persistedSource.includes('rehydratePersistedPublicationTimestamp'));
  assert.ok(persistedSource.includes("code: 'consent_timestamp_invalid'"));
  assert.ok(persistedSource.includes('PUBLIC_CONSENT_AUDIT_TIMESTAMP_FIELDS'));
  assert.ok(persistedSource.includes('PUBLIC_UPLOAD_CONSENT_TIMESTAMP_FIELDS'));
  assert.ok(persistedSource.includes('PUBLIC_CREDIT_TIMESTAMP_FIELDS'));
  assert.ok(persistedSource.includes('PUBLIC_CORRECTION_TIMESTAMP_FIELDS'));
});
