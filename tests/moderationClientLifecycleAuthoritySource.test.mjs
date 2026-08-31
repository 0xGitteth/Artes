import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const pendingSource = fs.readFileSync(new URL('../src/utils/pendingApprovedUpload.js', import.meta.url), 'utf8');
const routingSource = fs.readFileSync(new URL('../src/utils/moderationPublicationRouting.js', import.meta.url), 'utf8');
const lifecycleSource = fs.readFileSync(new URL('../src/utils/moderationUploadLifecycle.js', import.meta.url), 'utf8');

test('client lifecycle decisions share one canonical-first projection', () => {
  assert.match(pendingSource, /isClientUploadAllowedPending/);
  assert.match(routingSource, /resolveClientUploadLifecycle/);
  assert.match(appSource, /isClientUploadCorrectionPending/);
  assert.match(appSource, /isClientUploadDiscarded/);
  assert.match(lifecycleSource, /if \(explicit\)/);
  assert.match(lifecycleSource, /reason: 'canonical'/);
});

test('pending reminder discovery covers canonical uploads and bounded legacy fallback', () => {
  const start = appSource.indexOf('const loadPendingApprovedUpload = async');
  const end = appSource.indexOf('loadPendingApprovedUpload();', start);
  const body = appSource.slice(start, end);
  assert.match(body, /where\('moderationState', '==', 'allowed'\)/);
  assert.match(body, /where\('publicationState', '==', 'pending'\)/);
  assert.match(body, /where\('reviewStatus', '==', 'approved'\)/);
  assert.match(body, /pendingDocs = Array\.from\(new Map/);
});

test('resume UI no longer makes direct legacy lifecycle decisions', () => {
  assert.doesNotMatch(appSource, /String\(uploadData\.publicationStatus \|\| uploadData\.publishStatus/);
  assert.doesNotMatch(appSource, /uploadData\.requiresUploaderAcceptance === true && uploadData\.publicationStatus/);
  assert.match(appSource, /isClientUploadDiscarded\(uploadData\)/);
  assert.match(appSource, /isClientUploadCorrectionPending\(uploadData\)/);
});
