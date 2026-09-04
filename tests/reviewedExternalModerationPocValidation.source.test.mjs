import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/validateReviewedExternalModerationPoc.js', import.meta.url), 'utf8');

test('reviewed POC validation requires complete human-confirmed labels with matching hashes', () => {
  assert.match(source, /labels\.reviewed\.json/);
  assert.match(source, /labelStatus !== 'complete'/);
  assert.match(source, /labelStatus !== 'human_confirmed'/);
  assert.match(source, /labelSource !== 'local_human_review'/);
  assert.match(source, /reviewed_label_sha_mismatch/);
  assert.match(source, /validateArtesDetectorLabel/);
});

test('reviewed POC validation checks stored DINOv2 embedding metadata and 768D vectors', () => {
  assert.match(source, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(source, /EXPECTED_DIMENSION = 768/);
  assert.match(source, /embedding\?\.vector/);
  assert.match(source, /invalid_embedding_metadata/);
  assert.match(source, /invalid_embedding_vector/);
});

test('reviewed POC validation creates only provisional mutual-nearest-neighbor groups', () => {
  assert.match(source, /poc_mnn_/);
  assert.match(source, /poc_mutual_nearest_neighbor_only/);
  assert.match(source, /thresholdSelected: false/);
  assert.doesNotMatch(source, /semanticClusterId:/);
});

test('reviewed POC validation never promotes training readiness or prints raw embeddings/images', () => {
  assert.match(source, /trainingReady: false/);
  assert.match(source, /fullEmbeddingsPrinted: false/);
  assert.match(source, /imageBytesPrinted: false/);
  assert.match(source, /fullEmbeddingsIncluded: false/);
  assert.match(source, /imageBytesIncluded: false/);
  assert.doesNotMatch(source, /JSON\.stringify\(intake\)/);
});
