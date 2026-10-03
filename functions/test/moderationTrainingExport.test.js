import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModerationTrainingExport } from '../moderationTrainingExport.js';

const revision = 'a'.repeat(40);
const fixture = () => {
  const items = ['train', 'validation', 'test'].map((split, index) => ({ sourceExampleId: `item${index}`, sourcePoolId: `pool${index}`, sourceFingerprintSha256: String(index).repeat(64), labelVersion: 'artes_detector_v1', candidate: true, curationStatus: 'approved', trainingReady: true, detectorLabel: { nudity: 'none', sexualContext: 'none', graphicInjury: 'none', sensitiveSignals: [], possibleMinorConcern: false, confidence: 1, uncertaintyFlags: [] }, trainingAsset: { uri: `gs://approved/item${index}`, approvedForTraining: true }, semanticEmbedding: { semanticClusterId: `cluster${index}`, semanticClusterApproved: true }, split }));
  return { revision, learningItems: items, manifest: { datasetVersion: 'frozen1', labelVersion: 'artes_detector_v1', assignments: items.map(item => ({ sourceExampleId: item.sourceExampleId, sourcePoolId: item.sourcePoolId, semanticClusterId: item.semanticEmbedding.semanticClusterId, leakageGroupId: item.sourcePoolId, split: item.split })) }, embeddings: items.map(item => ({ sourceExampleId: item.sourceExampleId, sha256: item.sourceFingerprintSha256, modelId: 'facebook/dinov2-base', revision, vector: [1, ...Array(767).fill(0)] })) };
};

test('training export binds approved labels, frozen source groups and pinned embeddings', () => {
  const input = fixture();
  const result = buildModerationTrainingExport(input);
  assert.deepEqual(result.items.map(item => item.datasetSplit), ['train', 'validation', 'test']);
  assert.equal(result.items[0].datasetSplitFinal, true);
  assert.equal(input.learningItems[0].datasetSplitFinal, undefined);
});

test('research, benchmark, revoked assets and changed embedding bytes are rejected', () => {
  for (const change of ['research', 'benchmark', 'revoked', 'hash', 'revision', 'missing-split']) {
    const input = fixture();
    if (change === 'research') input.learningItems[0].researchOnly = true;
    if (change === 'benchmark') input.learningItems[0].benchmarkOnly = true;
    if (change === 'revoked') input.learningItems[0].trainingAsset.revokedAt = '2026-10-03';
    if (change === 'hash') input.embeddings[0].sha256 = 'different';
    if (change === 'revision') input.embeddings[0].revision = 'b'.repeat(40);
    if (change === 'missing-split') input.manifest.assignments.pop();
    assert.throws(() => buildModerationTrainingExport(input));
  }
});

test('identical bytes cannot appear on opposite sides of the benchmark', () => {
  const input = fixture();
  input.learningItems[1].sourceFingerprintSha256 = input.learningItems[0].sourceFingerprintSha256;
  input.embeddings[1].sha256 = input.embeddings[0].sha256;
  assert.throws(() => buildModerationTrainingExport(input), /dataset_split_leakage:sha256/);
});
