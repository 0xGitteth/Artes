import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTES_DETECTOR_LABEL_VERSION,
  assignDatasetSplit,
  assessModerationExampleCandidate,
  buildModerationLearningItem,
  validateArtesDetectorLabel,
} from '../moderationLearningDataset.js';

const validExample = () => ({
  caseType: 'upload',
  learningStatus: 'resolved',
  finalOutcome: 'allowed',
  policyVersion: 'v2',
  fingerprints: { sha256: 'abc123' },
  moderatorDecision: { action: 'approveWithTaxonomyCorrection' },
  analytics: { mismatchType: 'wrong_taxonomy' },
});

const validLabel = () => ({
  nudity: 'implied_nude',
  sexualContext: 'suggestive',
  graphicInjury: 'none',
  sensitiveSignals: [],
  possibleMinorConcern: false,
  confidence: 1,
  uncertaintyFlags: [],
});

test('resolved upload moderator decisions become learning candidates without changing runtime authority', () => {
  const result = assessModerationExampleCandidate(validExample());
  assert.equal(result.candidate, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.qualityWarnings, []);
  assert.equal(result.sourceEvidence.mismatchType, 'wrong_taxonomy');
});

test('legacy examples without a policy version remain candidates with an explicit provenance warning', () => {
  const legacy = validExample();
  delete legacy.policyVersion;
  const result = assessModerationExampleCandidate(legacy);
  assert.equal(result.candidate, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.qualityWarnings, ['missing_policy_version']);
  assert.equal(result.sourceEvidence.policyVersion, null);
  assert.equal(result.sourceEvidence.policyVersionKnown, false);
});

test('taxonomy-correction actions remain visible even when legacy mismatch analytics says none', () => {
  const result = assessModerationExampleCandidate({
    ...validExample(),
    analytics: { mismatchType: 'none' },
  });
  assert.equal(result.candidate, true);
  assert.equal(result.sourceEvidence.mismatchType, 'wrong_taxonomy');
});

test('report cases and unresolved correction flows are excluded from the candidate pool', () => {
  const report = assessModerationExampleCandidate({ ...validExample(), caseType: 'report' });
  const correction = assessModerationExampleCandidate({
    ...validExample(),
    learningStatus: 'active',
    finalOutcome: 'needs_user_correction',
    moderatorDecision: { action: 'requestUserCorrection' },
  });
  assert.equal(report.candidate, false);
  assert.ok(report.reasons.includes('not_upload_case'));
  assert.equal(correction.candidate, false);
  assert.ok(correction.reasons.includes('not_resolved'));
  assert.ok(correction.reasons.includes('unsupported_moderator_action'));
});

test('detector labels follow the Artes policy detector schema', () => {
  assert.equal(validateArtesDetectorLabel(validLabel()).valid, true);
  const invalid = validateArtesDetectorLabel({ ...validLabel(), sexualContext: 'erotic-ish', confidence: 2 });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes('invalid_sexual_context'));
  assert.ok(invalid.errors.includes('invalid_confidence'));
});

test('training readiness requires explicit curation, durable approved media, and a semantic cluster', () => {
  const pending = buildModerationLearningItem({ exampleId: 'ex1', example: validExample() });
  assert.equal(pending.candidate, true);
  assert.equal(pending.trainingReady, false);
  assert.ok(pending.trainingReadinessReasons.includes('curation_not_approved'));
  assert.ok(pending.trainingReadinessReasons.includes('missing_training_asset'));

  const ready = buildModerationLearningItem({
    exampleId: 'ex1',
    example: validExample(),
    curation: { status: 'approved', detectorLabel: validLabel() },
    embedding: { model: 'multimodalembedding@001', dimension: 512, semanticClusterId: 'cluster-a' },
    trainingAsset: { uri: 'gs://artes-staging-moderation-training/ex1.webp', approvedForTraining: true, retentionClass: 'curated' },
  });
  assert.equal(ready.trainingReady, true);
  assert.equal(ready.labelVersion, ARTES_DETECTOR_LABEL_VERSION);
  assert.ok(['train', 'validation', 'test'].includes(ready.datasetSplit));
});

test('a missing legacy policy version does not block training readiness once all detector-specific requirements are met', () => {
  const legacy = validExample();
  delete legacy.policyVersion;
  const item = buildModerationLearningItem({
    exampleId: 'legacy-1',
    example: legacy,
    curation: { status: 'approved', detectorLabel: validLabel() },
    embedding: { model: 'dinov2-vitb14', dimension: 768, semanticClusterId: 'cluster-legacy' },
    trainingAsset: { uri: 'gs://bucket/legacy-1.webp', approvedForTraining: true },
  });
  assert.equal(item.trainingReady, true);
  assert.equal(item.policyVersionKnown, false);
  assert.deepEqual(item.sourceQualityWarnings, ['missing_policy_version']);
});

test('semantic cluster splitting is deterministic and keeps related examples in one split', () => {
  const first = assignDatasetSplit('cluster-near-duplicate-family');
  const second = assignDatasetSplit('cluster-near-duplicate-family');
  assert.equal(first, second);
  assert.ok(['train', 'validation', 'test'].includes(first));
});

test('benchmark examples are never training ready', () => {
  const item = buildModerationLearningItem({
    exampleId: 'golden-1',
    example: validExample(),
    curation: { status: 'approved', detectorLabel: validLabel(), benchmarkOnly: true },
    embedding: { model: 'multimodalembedding@001', dimension: 512, semanticClusterId: 'cluster-golden' },
    trainingAsset: { uri: 'gs://artes-staging-moderation-benchmark/golden-1.webp', approvedForTraining: true, retentionClass: 'benchmark' },
  });
  assert.equal(item.trainingReady, false);
  assert.ok(item.trainingReadinessReasons.includes('benchmark_only'));
});

test('learning items contain media references only and never inline image bytes', () => {
  const item = buildModerationLearningItem({
    exampleId: 'ex1',
    example: validExample(),
    curation: { status: 'approved', detectorLabel: validLabel() },
    embedding: { model: 'multimodalembedding@001', dimension: 512, semanticClusterId: 'cluster-a' },
    trainingAsset: { uri: 'gs://bucket/ex1.webp', approvedForTraining: true },
  });
  assert.equal(Object.hasOwn(item, 'buffer'), false);
  assert.equal(Object.hasOwn(item, 'imageData'), false);
  assert.deepEqual(Object.keys(item.trainingAsset).sort(), ['approvedForTraining', 'retentionClass', 'uri']);
});
