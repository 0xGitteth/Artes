import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

const moderateStart = indexSource.indexOf('export const moderateImage');
const moderateEnd = indexSource.indexOf('export const isModerator', moderateStart);
const moderateSource = indexSource.slice(moderateStart, moderateEnd);

test('automatic review cases are never persisted before durable upload finalization', () => {
  const uploadRefIndex = moderateSource.indexOf("const uploadRef = db.collection('uploads').doc()");
  const storageIndex = moderateSource.indexOf('persistModerationPreview({');
  const finalizationIndex = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const reviewCreateIndex = moderateSource.indexOf('transaction.create(automaticReviewRef, {');
  assert.ok(uploadRefIndex >= 0 && uploadRefIndex < storageIndex);
  assert.ok(storageIndex < finalizationIndex);
  assert.ok(finalizationIndex < reviewCreateIndex);
  assert.doesNotMatch(moderateSource.slice(0, finalizationIndex), /transaction\.create\([^\n]*review/i);
});

test('automatic review linkage, quota and ready media commit in the same transaction', () => {
  const start = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const end = moderateSource.indexOf("if (finalizationOutcome === 'ready')", start);
  const body = moderateSource.slice(start, end);
  assert.match(body, /transaction\.create\(automaticReviewRef, \{/);
  assert.match(body, /linkedUploadIds: \[uploadRef\.id\]/);
  assert.match(body, /openReviewCount: 1/);
  assert.match(body, /transaction\.set\(uploadRef, \{/);
  assert.match(body, /mediaState: 'ready'/);
  assert.match(body, /reviewCaseId: transactionReviewCaseId \|\| null/);
});

test('finalization rereads generation, upload anchor, review access and open-case identity before review writes', () => {
  const start = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const end = moderateSource.indexOf("if (finalizationOutcome === 'ready')", start);
  const body = moderateSource.slice(start, end);
  const reviewCreate = body.indexOf('transaction.create(automaticReviewRef, {');
  for (const requiredRead of [
    'const uploadSnap = await transaction.get(uploadRef)',
    'readModerationScopeGeneration({ db, fingerprints, transaction })',
    'freshUserModerationSnap = await transaction.get(automaticReviewUserModerationRef)',
    'findOpenReviewCaseInTransaction({',
  ]) {
    const readIndex = body.indexOf(requiredRead);
    assert.ok(readIndex >= 0 && readIndex < reviewCreate, `missing pre-write read: ${requiredRead}`);
  }
  assert.match(body, /freshModerationScope\.generation !== requestModerationGeneration/);
  assert.match(body, /stubMediaState !== 'pending'/);
});

test('fresh open review lookup is transactional, paginated and upload-case-only', () => {
  const start = indexSource.indexOf('const findOpenReviewCaseInTransaction = async');
  const end = indexSource.indexOf('const findExactUpload = async', start);
  const body = indexSource.slice(start, end);
  assert.match(body, /findFirstUploadReviewCaseAcrossPages/);
  assert.match(body, /await transaction\.get\(query\)/);
  assert.match(body, /reviewCaseMatchesCurrentUploadEvidence/);
  assert.match(body, /expectedOwnerUid: userId/);
  assert.match(body, /linkedUploadSnap = await transaction\.get/);
});


test('automatic review capacity follows the transactionally observed case, not a stale counter', () => {
  const start = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const end = moderateSource.indexOf("if (finalizationOutcome === 'ready')", start);
  const body = moderateSource.slice(start, end);
  assert.match(body, /const effectiveOpenReviewCount = transactionOpenReviewCase \? 1 : 0/);
  assert.match(body, /openReviewCount: effectiveOpenReviewCount/);
  assert.match(body, /if \(transactionOpenReviewCase && Number\(freshUserModerationData\.openReviewCount \|\| 0\) < 1\)/);
  assert.match(body, /else if \(!transactionOpenReviewCase && freshReviewAccess\.allowed\)/);
});

test('storage or finalization failure is surfaced and leaves cleanup on the upload anchor', () => {
  assert.match(moderateSource, /reason: 'storage_write_failed'/);
  assert.match(moderateSource, /reason: error\?\.code \|\| 'upload_finalization_failed'/);
  assert.match(moderateSource, /const durablePersistenceError = new Error/);
  assert.match(moderateSource, /throw durablePersistenceError/);
});

test('there is no post-finalization best-effort review-case linking path', () => {
  assert.doesNotMatch(moderateSource, /if \(reviewCaseId && uploadId\)/);
  assert.doesNotMatch(moderateSource, /Review case koppelen mislukt/);
  assert.match(moderateSource, /response\.reviewCaseId = reviewCaseId/);
  assert.match(moderateSource, /response\.canRequestReview = canRequestReview/);
});
