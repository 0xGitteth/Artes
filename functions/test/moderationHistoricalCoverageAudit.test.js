import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findDecidedUploadReviewCasesWithoutExamples,
  summarizeHistoricalModerationCoverage,
} from '../moderationHistoricalCoverageAudit.js';

test('historical coverage audit compares decided upload review cases with stored moderation examples', () => {
  const summary = summarizeHistoricalModerationCoverage({
    reviewCases: [
      { id: 'r1', data: { caseType: 'upload', uploadId: 'u1', status: 'approved', decidedAt: { seconds: 1 } } },
      { id: 'r2', data: { caseType: 'upload', uploadId: 'u2', status: 'rejected', decidedAt: { seconds: 2 } } },
      { id: 'r3', data: { caseType: 'upload', uploadId: 'u3', status: 'open' } },
      { id: 'r4', data: { caseType: 'report', status: 'approved', decidedAt: { seconds: 3 } } },
      { id: 'legacy-upload', data: { uploadId: 'u4', status: 'approved', decidedAt: { seconds: 4 } } },
    ],
    moderationExamples: [
      { id: 'r1_approve', data: { reviewCaseId: 'r1' } },
      { id: 'legacy-upload_approve', data: {} },
    ],
  });

  assert.equal(summary.totalReviewCases, 5);
  assert.equal(summary.uploadLikeReviewCases, 4);
  assert.equal(summary.nonUploadReviewCases, 1);
  assert.equal(summary.decidedUploadReviewCases, 3);
  assert.equal(summary.undecidedUploadReviewCases, 1);
  assert.equal(summary.decidedUploadWithModerationExample, 2);
  assert.equal(summary.decidedUploadWithoutModerationExample, 1);
  assert.equal(summary.decidedUploadExampleCoverageRate, 0.6667);
  assert.equal(summary.decidedUploadStatuses.approved, 2);
  assert.equal(summary.decidedUploadStatuses.rejected, 1);
});

test('missing decided upload cases can be selected internally without changing aggregate output', () => {
  const missing = findDecidedUploadReviewCasesWithoutExamples({
    reviewCases: [
      { id: 'r1', data: { caseType: 'upload', uploadId: 'u1', status: 'approved' } },
      { id: 'r2', data: { caseType: 'upload', uploadId: 'u2', status: 'rejected' } },
      { id: 'r3', data: { caseType: 'upload', uploadId: 'u3', status: 'open' } },
    ],
    moderationExamples: [
      { id: 'r1_approve', data: { reviewCaseId: 'r1' } },
    ],
  });

  assert.equal(missing.length, 1);
  assert.equal(missing[0].id, 'r2');
  assert.equal(missing[0].data.uploadId, 'u2');
});

test('historical coverage audit returns aggregate data only', () => {
  const summary = summarizeHistoricalModerationCoverage({
    reviewCases: [{ id: 'secret-review-id', data: { uploadId: 'secret-upload-id', status: 'approved', decidedAt: true } }],
    moderationExamples: [],
  });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('secret-review-id'), false);
  assert.equal(serialized.includes('secret-upload-id'), false);
});
