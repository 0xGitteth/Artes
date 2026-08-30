import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const persistedSource = readFileSync(new URL('../functions/persistedPublication.js', import.meta.url), 'utf8');
const firestoreRulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('preview persistence creates durable cleanup anchor before Storage write and clears it after durable upload persistence', () => {
  const start = indexSource.indexOf('const persistModerationPreview = async');
  const end = indexSource.indexOf('const ensureJsonBody', start);
  const source = indexSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.indexOf('await cleanupTaskRef.create({') < source.indexOf('await bucket.file(storagePath).save(buffer'));
  assert.ok(indexSource.includes('if (persistedUpload) await clearModerationPreviewCleanupAnchor(uploadRef.id);'));
  assert.ok(indexSource.includes("db.collection('moderationPreviewCleanupTasks')"));
  assert.ok(indexSource.includes('getModerationPreviewCleanupTaskDecision({'));
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


test('preview cleanup anchors are explicitly server-only in Firestore rules', () => {
  assert.match(firestoreRulesSource, /match \/moderationPreviewCleanupTasks\/\{taskId\} \{\s*allow read, write: if false;\s*\}/);
});
