import test from 'node:test';
import assert from 'node:assert/strict';
import { ARTES_DETECTOR_LABEL_VERSION } from '../moderationLearningDataset.js';
import {
  GROUP_STRATIFIED_SPLIT_VERSION,
  buildGroupStratifiedDatasetManifest,
  detectorLabelStrata,
} from '../moderationDatasetManifest.js';

const makeItem = ({ id, cluster, nudity = 'none', sexualContext = 'none', sensitiveSignals = [], trainingReady = true, benchmarkOnly = false }) => ({
  sourceExampleId: id,
  labelVersion: ARTES_DETECTOR_LABEL_VERSION,
  trainingReady,
  benchmarkOnly,
  semanticEmbedding: { semanticClusterId: cluster },
  detectorLabel: {
    nudity,
    sexualContext,
    graphicInjury: 'none',
    sensitiveSignals,
    possibleMinorConcern: false,
    confidence: 1,
    uncertaintyFlags: [],
  },
});

test('detector strata expose the concrete detector semantics used for balancing', () => {
  const strata = detectorLabelStrata(makeItem({ id: 'x', cluster: 'c', nudity: 'genitalia', sexualContext: 'bdsm_kink', sensitiveSignals: ['violence'] }).detectorLabel);
  assert.ok(strata.includes('nudity:genitalia'));
  assert.ok(strata.includes('sexualContext:bdsm_kink'));
  assert.ok(strata.includes('sensitiveSignal:violence'));
});

test('related examples in the same semantic cluster never cross dataset splits', () => {
  const items = [
    makeItem({ id: 'a1', cluster: 'cluster-a', nudity: 'underwear_swimwear' }),
    makeItem({ id: 'a2', cluster: 'cluster-a', nudity: 'underwear_swimwear' }),
    makeItem({ id: 'b1', cluster: 'cluster-b', nudity: 'implied_nude' }),
    makeItem({ id: 'c1', cluster: 'cluster-c', nudity: 'genitalia', sexualContext: 'explicit_act' }),
  ];
  const manifest = buildGroupStratifiedDatasetManifest({ items, datasetVersion: 'dataset-poc-1' });
  const aAssignments = manifest.assignments.filter((item) => item.semanticClusterId === 'cluster-a');
  assert.equal(new Set(aAssignments.map((item) => item.split)).size, 1);
  assert.equal(manifest.splitVersion, GROUP_STRATIFIED_SPLIT_VERSION);
});

test('manifest generation is deterministic for the same immutable dataset version', () => {
  const items = Array.from({ length: 12 }, (_, index) => makeItem({
    id: `item-${index}`,
    cluster: `cluster-${index}`,
    nudity: index % 3 === 0 ? 'female_bare_breasts' : 'none',
    sexualContext: index % 4 === 0 ? 'suggestive' : 'none',
  }));
  const first = buildGroupStratifiedDatasetManifest({ items, datasetVersion: 'dataset-poc-1' });
  const second = buildGroupStratifiedDatasetManifest({ items, datasetVersion: 'dataset-poc-1' });
  assert.deepEqual(first.clusterAssignments, second.clusterAssignments);
  assert.deepEqual(first.assignments, second.assignments);
});

test('benchmark-only and non-training-ready items are excluded from model datasets', () => {
  const manifest = buildGroupStratifiedDatasetManifest({
    datasetVersion: 'dataset-poc-1',
    items: [
      makeItem({ id: 'trainable', cluster: 'cluster-a' }),
      makeItem({ id: 'golden', cluster: 'cluster-b', benchmarkOnly: true }),
      makeItem({ id: 'pending', cluster: 'cluster-c', trainingReady: false }),
    ],
  });
  assert.equal(manifest.eligibleItemCount, 1);
  assert.equal(manifest.excludedItemCount, 2);
  assert.deepEqual(manifest.assignments.map((item) => item.sourceExampleId), ['trainable']);
});

test('invalid ratios fail closed rather than silently creating a bad split', () => {
  assert.throws(() => buildGroupStratifiedDatasetManifest({
    items: [],
    datasetVersion: 'dataset-poc-1',
    ratios: { train: 0.9, validation: 0.2, test: 0 },
  }), /invalid_split_ratios/);
});
