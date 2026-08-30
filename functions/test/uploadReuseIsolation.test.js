import test from 'node:test';
import assert from 'node:assert/strict';
import { findBestReusableAcrossPages, findFirstUploadReviewCaseAcrossPages, findReusableAcrossPages, isUploadReviewCaseData, resolveCachedReviewCaseIdForUploader, reviewCaseMatchesFingerprint, reviewCaseReferencesUpload, shouldCreateProductionReviewCase } from '../uploadReuseIsolation.js';

test('reasonless policy review creates a production review case', () => {
  assert.equal(shouldCreateProductionReviewCase({ isCodexActor: false, forbiddenReasons: [], shouldReview: true }), true);
});

test('ordinary forbidden reason still creates a production review case', () => {
  assert.equal(shouldCreateProductionReviewCase({ isCodexActor: false, forbiddenReasons: [{ reason: 'x' }], shouldReview: false }), true);
});

test('Codex actor never creates a production review case', () => {
  assert.equal(shouldCreateProductionReviewCase({ isCodexActor: true, forbiddenReasons: [{ reason: 'x' }], shouldReview: true }), false);
});

test('cached review case ids are never trusted as ownership proof', () => {
  const uploadData = { userId: 'uploader-a', reviewCaseId: 'case-a' };
  assert.equal(resolveCachedReviewCaseIdForUploader({ uploadData, userId: 'uploader-a' }), null);
  assert.equal(resolveCachedReviewCaseIdForUploader({ uploadData, userId: 'uploader-b' }), null);
  assert.equal(resolveCachedReviewCaseIdForUploader({ uploadData: { reviewCaseId: 'legacy-case' }, userId: 'uploader-a' }), null);
  assert.equal(resolveCachedReviewCaseIdForUploader({ uploadData, userId: 'uploader-a', isCodexActor: true }), null);
});

test('exact cache pagination skips unusable candidates and continues to a valid cache', async () => {
  const pages = [
    [{ id: 'stale', data: () => ({ prompt: 'stale' }) }],
    [{ id: 'valid', data: () => ({ prompt: 'current' }) }],
    [],
  ];
  let index = 0;
  const selected = await findReusableAcrossPages({
    isCodexActor: false,
    fetchPage: async () => pages[index++] || [],
    isReusable: (data) => data.prompt === 'current',
    select: (docs) => docs[0] || null,
  });
  assert.equal(selected?.id, 'valid');
  assert.equal(index, 2);
});

test('near cache pagination ignores an unusable closer candidate', async () => {
  const pages = [
    [{ id: 'stale-near', data: () => ({ reusable: false, distance: 0 }) }],
    [{ id: 'valid-near', data: () => ({ reusable: true, distance: 2 }) }],
    [],
  ];
  let index = 0;
  const selected = await findBestReusableAcrossPages({
    isCodexActor: false,
    fetchPage: async () => pages[index++] || [],
    isReusable: (data) => data.reusable === true,
    selectBest: (docs) => docs.length ? { id: docs[0].id, distance: docs[0].data().distance } : null,
  });
  assert.equal(selected?.id, 'valid-near');
  assert.equal(selected?.distance, 2);
});

test('an existing open review case is reused only for the same fingerprint', () => {
  const reviewCaseData = {
    fingerprints: [{ sha256: 'sha-a', dhash: '0000', dhashPrefix: '0000' }],
  };
  assert.equal(reviewCaseMatchesFingerprint({
    reviewCaseData,
    fingerprints: { sha256: 'sha-a', dhash: 'ffff', dhashPrefix: 'ffff' },
  }), true);
  assert.equal(reviewCaseMatchesFingerprint({
    reviewCaseData,
    fingerprints: { sha256: 'sha-b', dhash: '1111', dhashPrefix: '1111' },
    distanceBetween: () => 0,
    threshold: 8,
  }), false);
});

test('an open review case can match a near duplicate in the same dhash bucket', () => {
  const result = reviewCaseMatchesFingerprint({
    reviewCaseData: { fingerprints: [{ sha256: 'sha-a', dhash: '0001', dhashPrefix: '0000' }] },
    fingerprints: { sha256: 'sha-b', dhash: '0002', dhashPrefix: '0000' },
    distanceBetween: () => 2,
    threshold: 8,
  });
  assert.equal(result, true);
});


test('fingerprintless upload review cases can be matched by linked upload id', () => {
  const legacyCase = { uploadId: 'upload-a', status: 'inReview' };
  assert.equal(isUploadReviewCaseData(legacyCase), true);
  assert.equal(reviewCaseReferencesUpload({ reviewCaseData: legacyCase, uploadId: 'upload-a' }), true);
  assert.equal(reviewCaseReferencesUpload({ reviewCaseData: legacyCase, uploadId: 'upload-b' }), false);
});

test('report review cases never count as upload review cases', () => {
  const reportCase = {
    caseType: 'report',
    userId: 'u1',
    reportedFingerprints: { sha256: 'sha-a' },
    uploadId: 'misleading-legacy-field',
  };
  assert.equal(isUploadReviewCaseData(reportCase), false);
  assert.equal(reviewCaseReferencesUpload({ reviewCaseData: reportCase, uploadId: 'misleading-legacy-field' }), false);
});


test('open upload review lookup paginates past a full page of report cases', async () => {
  const reportPage = Array.from({ length: 20 }, (_, index) => ({ id: `report-${index}`, data: () => ({ caseType: 'report' }) }));
  const pages = [reportPage, [{ id: 'upload-case', data: () => ({ caseType: 'upload', uploadId: 'upload-a' }) }], []];
  let calls = 0;
  const selected = await findFirstUploadReviewCaseAcrossPages({ fetchPage: async () => pages[calls++] || [] });
  assert.equal(selected?.id, 'upload-case');
  assert.equal(calls, 2);
});

test('open upload review lookup scans past unrelated upload cases for a target', async () => {
  const pages = [
    [{ id: 'other', data: () => ({ caseType: 'upload', uploadId: 'other' }) }],
    [{ id: 'target', data: () => ({ uploadId: 'target-upload' }) }],
    [],
  ];
  let calls = 0;
  const selected = await findFirstUploadReviewCaseAcrossPages({
    fetchPage: async () => pages[calls++] || [],
    matches: (data) => data.uploadId === 'target-upload',
  });
  assert.equal(selected?.id, 'target');
  assert.equal(calls, 2);
});

test('open upload review lookup exhausts report-only pages safely', async () => {
  const pages = [[{ id: 'report', data: () => ({ caseType: 'report' }) }], []];
  let calls = 0;
  const selected = await findFirstUploadReviewCaseAcrossPages({ fetchPage: async () => pages[calls++] || [] });
  assert.equal(selected, null);
  assert.equal(calls, 2);
});

test('exact cache pagination can skip a valid-provenance cache with the wrong taxonomy', async () => {
  const pages = [
    [{ id: 'taxonomy-a', data: () => ({ reusable: true, taxonomy: 'A' }) }],
    [{ id: 'taxonomy-b', data: () => ({ reusable: true, taxonomy: 'B' }) }],
    [],
  ];
  let index = 0;
  const selected = await findReusableAcrossPages({
    isCodexActor: false,
    fetchPage: async () => pages[index++] || [],
    isReusable: (data) => data.reusable === true && data.taxonomy === 'B',
    select: (docs) => docs[0] || null,
  });
  assert.equal(selected?.id, 'taxonomy-b');
  assert.equal(index, 2);
});

test('near cache pagination excludes the closest wrong-taxonomy candidate before distance ranking', async () => {
  const pages = [[
    { id: 'wrong-taxonomy-close', data: () => ({ reusable: true, taxonomy: 'A', distance: 0 }) },
    { id: 'right-taxonomy-near', data: () => ({ reusable: true, taxonomy: 'B', distance: 3 }) },
  ], []];
  let index = 0;
  const selected = await findBestReusableAcrossPages({
    isCodexActor: false,
    fetchPage: async () => pages[index++] || [],
    isReusable: (data) => data.reusable === true && data.taxonomy === 'B',
    selectBest: (docs) => docs.length ? { id: docs[0].id, distance: docs[0].data().distance } : null,
  });
  assert.equal(selected?.id, 'right-taxonomy-near');
  assert.equal(selected?.distance, 3);
});
