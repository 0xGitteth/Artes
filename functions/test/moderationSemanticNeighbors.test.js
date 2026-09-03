import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineDistance,
  rankModerationSemanticNeighbors,
  summarizeNeighborEvidence,
} from '../moderationSemanticNeighbors.js';

const label = {
  nudity: 'none',
  sexualContext: 'none',
  graphicInjury: 'none',
  sensitiveSignals: [],
  possibleMinorConcern: false,
  confidence: 0.9,
  uncertaintyFlags: [],
};

test('cosine distance is zero for equal vectors and one for orthogonal vectors', () => {
  assert.equal(cosineDistance([1, 0], [1, 0]), 0);
  assert.equal(cosineDistance([1, 0], [0, 1]), 1);
});

test('semantic ranking requires same model and label version', () => {
  const result = rankModerationSemanticNeighbors({
    queryVector: [1, 0],
    embeddingModel: 'dinov2_vitb14',
    labelVersion: 'artes_detector_v1',
    maxDistance: 1,
    candidates: [
      { exampleId: 'same', embeddingModel: 'dinov2_vitb14', labelVersion: 'artes_detector_v1', embedding: [1, 0], detectorLabel: label },
      { exampleId: 'wrong-model', embeddingModel: 'other', labelVersion: 'artes_detector_v1', embedding: [1, 0], detectorLabel: label },
      { exampleId: 'wrong-label-version', embeddingModel: 'dinov2_vitb14', labelVersion: 'v2', embedding: [1, 0], detectorLabel: label },
    ],
  });
  assert.deepEqual(result.map((item) => item.exampleId), ['same']);
});

test('semantic ranking sorts by distance then deterministic id and applies threshold', () => {
  const result = rankModerationSemanticNeighbors({
    queryVector: [1, 0],
    embeddingModel: 'dinov2_vitb14',
    labelVersion: 'artes_detector_v1',
    maxDistance: 0.4,
    candidates: [
      { exampleId: 'b', embeddingModel: 'dinov2_vitb14', labelVersion: 'artes_detector_v1', embedding: [0.98, 0.2], detectorLabel: label },
      { exampleId: 'a', embeddingModel: 'dinov2_vitb14', labelVersion: 'artes_detector_v1', embedding: [0.98, 0.2], detectorLabel: label },
      { exampleId: 'far', embeddingModel: 'dinov2_vitb14', labelVersion: 'artes_detector_v1', embedding: [0, 1], detectorLabel: label },
    ],
  });
  assert.deepEqual(result.map((item) => item.exampleId), ['a', 'b']);
  assert.ok(result.every((item) => item.distance <= 0.4));
});

test('neighbor evidence summary reports evidence without making policy claims', () => {
  const summary = summarizeNeighborEvidence([
    { distance: 0.1, detectorLabel: label, semanticClusterId: 'cluster-a' },
    { distance: 0.2, detectorLabel: null, semanticClusterId: 'cluster-b' },
  ]);
  assert.deepEqual(summary, {
    count: 2,
    nearestDistance: 0.1,
    detectorLabelsPresent: 1,
    semanticClusters: 2,
  });
  assert.equal(Object.hasOwn(summary, 'finalOutcome'), false);
  assert.equal(Object.hasOwn(summary, 'policyDecision'), false);
});
