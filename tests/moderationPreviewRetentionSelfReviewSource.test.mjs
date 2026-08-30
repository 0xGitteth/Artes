import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const helperSource = fs.readFileSync(new URL('../functions/moderationPreviewStorage.js', import.meta.url), 'utf8');
const pendingSource = fs.readFileSync(new URL('../src/utils/pendingApprovedUpload.js', import.meta.url), 'utf8');

test('published-post cleanup failures durably enter scheduled cleanup lifecycle', () => {
  const start = indexSource.indexOf('const finalizeDeletedPublishedPostMedia = async');
  assert.ok(start >= 0);
  const end = indexSource.indexOf('export const onModerationUploadDeleted', start);
  const body = indexSource.slice(start, end);
  assert.ok(body.includes("publicationStatus: 'deleted_pending_cleanup'"));
  assert.ok(body.includes("publishStatus: 'deleted_pending_cleanup'"));
  assert.ok(body.includes('previewRetentionExpiresAt: Timestamp.fromMillis(Date.now())'));
  assert.ok(body.includes("cleanup.reason !== 'no_owned_preview'"));
  assert.ok(helperSource.includes("'deleted_pending_cleanup'"));
});

test('all preview-deleting Firestore event handlers retry transient failures', () => {
  for (const exportName of [
    'onModerationUploadDeleted',
    'onModerationUploadDiscarded',
    'onProductionPostDeleted',
    'onCodexDevPostDeleted',
  ]) {
    const start = indexSource.indexOf(`export const ${exportName} =`);
    assert.ok(start >= 0, `missing ${exportName}`);
    const body = indexSource.slice(start, start + 260);
    assert.ok(body.includes('retry: true'), `${exportName} must retry`);
  }
});

test('expired cleanup states cannot reappear as pending approved uploads', () => {
  for (const status of ['expired', 'deleted', 'deleted_pending_cleanup']) {
    assert.ok(pendingSource.includes(`'${status}'`));
  }
});
