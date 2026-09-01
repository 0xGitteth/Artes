import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeModerationLearningCandidates } from '../moderationLearningAudit.js';

const baseExample = {
  caseType: 'upload',
  learningStatus: 'resolved',
  finalOutcome: 'allowed',
  policyVersion: 'v2',
  fingerprints: { sha256: 'sha' },
  moderatorDecision: { action: 'approveAsIs' },
  analytics: { mismatchType: 'none' },
};

test('audit summary counts candidates and exclusions without exposing example contents', () => {
  const summary = summarizeModerationLearningCandidates([
    baseExample,
    {
      ...baseExample,
      fingerprints: { sha256: 'sha2' },
      moderatorDecision: { action: 'approveWithTaxonomyCorrection' },
      analytics: { mismatchType: 'none' },
    },
    {
      ...baseExample,
      caseType: 'report',
      fingerprints: { sha256: 'sha3' },
    },
    {
      ...baseExample,
      fingerprints: {},
    },
  ]);

  assert.equal(summary.totalExamples, 4);
  assert.equal(summary.candidateExamples, 2);
  assert.equal(summary.excludedExamples, 2);
  assert.equal(summary.candidateRate, 0.5);
  assert.equal(summary.exclusionReasons.not_upload_case, 1);
  assert.equal(summary.exclusionReasons.missing_sha256, 1);
  assert.equal(summary.mismatchTypes.wrong_taxonomy, 1);
  assert.equal(Object.hasOwn(summary, 'examples'), false);
});

test('audit summary accepts wrapped Firestore-style records', () => {
  const summary = summarizeModerationLearningCandidates([
    { id: 'example-1', data: baseExample },
  ]);
  assert.equal(summary.totalExamples, 1);
  assert.equal(summary.candidateExamples, 1);
});
