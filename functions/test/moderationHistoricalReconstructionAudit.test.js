import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessHistoricalModerationReconstruction,
  summarizeHistoricalReconstruction,
} from '../moderationHistoricalReconstructionAudit.js';

const strongRecord = () => ({
  reviewCase: {
    status: 'approved',
    uploadId: 'upload-1',
    moderatorDecision: {
      reasonCode: 'allowed_art_nude',
      correctedTaxonomy: { themes: ['Art Nude'], triggers: ['adultArtNude'] },
    },
  },
  upload: {
    policyVersion: 'v2',
    fingerprints: { sha256: 'sha-1' },
    aiResult: { outcome: 'review' },
  },
});

test('historical case with final decision, reason and fingerprint is strongly reconstructable', () => {
  const result = assessHistoricalModerationReconstruction(strongRecord());
  assert.equal(result.reconstructionTier, 'strong');
  assert.equal(result.requiresHumanRelabel, false);
  assert.equal(result.inferred.action, 'approveWithTaxonomyCorrection');
  assert.equal(result.inferred.finalOutcome, 'allowed');
  assert.equal(result.inferred.reasonCode, 'allowed_art_nude');
  assert.equal(result.inferred.hasSha256, true);
});

test('missing reason code remains partial rather than inventing a reason', () => {
  const record = strongRecord();
  delete record.reviewCase.moderatorDecision.reasonCode;
  const result = assessHistoricalModerationReconstruction(record);
  assert.equal(result.reconstructionTier, 'partial');
  assert.equal(result.requiresHumanRelabel, true);
  assert.ok(result.evidenceGaps.includes('missing_reason_code'));
  assert.equal(result.inferred.reasonCode, null);
});

test('missing policy version is provenance debt but does not block strong reconstruction', () => {
  const record = strongRecord();
  delete record.upload.policyVersion;
  const result = assessHistoricalModerationReconstruction(record);
  assert.equal(result.reconstructionTier, 'strong');
  assert.ok(result.evidenceGaps.includes('missing_policy_version'));
});

test('rejected historical case infers rejectForbidden without inventing taxonomy', () => {
  const record = strongRecord();
  record.reviewCase.status = 'rejected';
  record.reviewCase.moderatorDecision.reasonCode = 'forbidden_explicit_sexual';
  record.reviewCase.moderatorDecision.correctedTaxonomy = { themes: [], triggers: [] };
  const result = assessHistoricalModerationReconstruction(record);
  assert.equal(result.reconstructionTier, 'strong');
  assert.equal(result.inferred.action, 'rejectForbidden');
  assert.equal(result.inferred.finalOutcome, 'forbidden');
});

test('summary exposes aggregate reconstruction quality only', () => {
  const strong = strongRecord();
  const partial = strongRecord();
  delete partial.reviewCase.moderatorDecision.reasonCode;
  const weak = {
    reviewCase: { status: 'approved', uploadId: 'upload-3' },
    upload: {},
  };
  const summary = summarizeHistoricalReconstruction([strong, partial, weak]);
  assert.equal(summary.missingExampleCasesAssessed, 3);
  assert.equal(summary.strongReconstruction, 1);
  assert.equal(summary.partialReconstruction, 1);
  assert.equal(summary.weakReconstruction, 1);
  assert.equal(summary.requiresHumanRelabel, 2);
  assert.equal(summary.recordsWithReasonCode, 1);
  assert.equal(Object.hasOwn(summary, 'records'), false);
});
