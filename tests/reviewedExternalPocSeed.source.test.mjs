import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/buildReviewedExternalPocSeed.js', import.meta.url), 'utf8');

test('seed builder requires complete human labels and matching hashes', () => {
  assert.match(source, /seed_requires_complete_human_labels/);
  assert.match(source, /seed_label_hash_mismatch/);
  assert.match(source, /validateArtesDetectorLabel/);
  assert.match(source, /labelStatus: 'human_confirmed'/);
});

test('seed builder validates DINOv2 768D embeddings and retains vectors only in local output', () => {
  assert.match(source, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(source, /EXPECTED_DIMENSION = 768/);
  assert.match(source, /embedding\.vector\.length !== EXPECTED_DIMENSION/);
  assert.match(source, /\.tmp.*moderation-test-set.*external-poc/s);
  assert.doesNotMatch(source, /fetch\(/);
});

test('seed builder keeps provisional groups distinct from real semantic clusters', () => {
  assert.match(source, /provisionalNeighborGroupId/);
  assert.match(source, /semanticClusterId: null/);
  assert.match(source, /thresholdSelected: false/);
  assert.match(source, /semanticClustersPromoted: false/);
});

test('seed builder reports detector coverage without promoting classifier training', () => {
  assert.match(source, /classifierTrainingRecommended: false/);
  assert.match(source, /trainingReady: false/);
  assert.match(source, /underwear_swimwear/);
  assert.match(source, /implied_nude/);
  assert.match(source, /bdsm_kink/);
  assert.match(source, /possibleMinorConcernTrue/);
  assert.match(source, /fullEmbeddingsPrinted: false/);
  assert.match(source, /imageBytesPrinted: false/);
});
