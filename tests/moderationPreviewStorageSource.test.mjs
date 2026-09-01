import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const rulesSource = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('moderation preview lifecycle cleans failed persistence, upload deletion and user discard', () => {
  assert.ok(indexSource.includes("mediaState: 'pending'"));
  assert.ok(indexSource.includes("mediaState: 'cleanup_pending'"));
  assert.ok(indexSource.includes("mediaState: 'ready'"));
  assert.ok(indexSource.includes("document: 'uploads/{uploadId}'"));
  assert.ok(indexSource.includes('export const onModerationUploadDeleted = onDocumentDeleted'));
  assert.ok(indexSource.includes('export const onModerationUploadDiscarded = onDocumentUpdated'));
  assert.ok(indexSource.includes('afterPublication = resolveUploadPublicationState(after)'));
  assert.ok(indexSource.includes('afterPublication.state !== PUBLICATION_STATES.discarded'));
  assert.ok(indexSource.includes("afterMediaState && afterMediaState !== 'ready'"));
});

test('preview deletion preserves media while a deterministic post still references the upload id', () => {
  assert.ok(indexSource.includes("db.collection('posts').doc(normalizedUploadId).get()"));
  assert.ok(indexSource.includes("db.collection('codexDevPosts').doc(normalizedUploadId).get()"));
  assert.ok(indexSource.includes("reason: 'published_media_still_referenced'"));
});

test('successful discard cleanup removes dead media references from the retained upload audit record', () => {
  assert.ok(indexSource.includes('previewCleanedAt: FieldValue.serverTimestamp()'));
  for (const field of ['imageUrl', 'previewUrl', 'imageRef', 'storagePath']) {
    assert.ok(indexSource.includes(`${field}: FieldValue.delete()`), `missing cleanup for ${field}`);
  }
});

test('post deletion finalizes matching published upload media without cross-owner cleanup', () => {
  assert.ok(indexSource.includes('export const onProductionPostDeleted = onDocumentDeleted'));
  assert.ok(indexSource.includes('export const onCodexDevPostDeleted = onDocumentDeleted'));
  assert.ok(indexSource.includes('getDeletedPublishedPostCleanupDecision({'));
  assert.ok(indexSource.includes('if (!decision.ok) return { cleaned: false, reason: decision.reason };'));
  assert.ok(indexSource.includes("publicationStatus: 'deleted'"));
});

test('a deleted published post cannot be resurrected from stale upload state', () => {
  assert.ok(indexSource.includes('latestPublicationLifecycle = resolveUploadPublicationState(latestUpload)'));
  assert.ok(indexSource.includes('latestPublicationLifecycle.state === PUBLICATION_STATES.published'));
  assert.ok(indexSource.includes('&& !latestPostSnap?.exists'));
  assert.ok(indexSource.includes("error.code = 'published_post_deleted'"));
});

test('modern production post updates are presentation-metadata-only', () => {
  assert.match(rulesSource, /!isLegacyPostWithoutModerationProof\(resource\.data\)[\s\S]{0,180}?!isPreConsentModeratedPost\(resource\.data\)[\s\S]{0,180}?isLegacyPostMetadataOnlyUpdate\(\)/);
});
