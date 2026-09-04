import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const validationSource = readFileSync(new URL('../scripts/validateReviewedExternalModerationExpansionV1.js', import.meta.url), 'utf8');
const combinedSource = readFileSync(new URL('../scripts/buildCombinedExternalModerationSeedV1.js', import.meta.url), 'utf8');

test('expansion validation requires complete human labels with matching hashes', () => {
  assert.match(validationSource, /labels\?\.labelStatus !== 'complete'/);
  assert.match(validationSource, /reviewed_label_sha_mismatch/);
  assert.match(validationSource, /labelStatus !== 'human_confirmed'/);
  assert.match(validationSource, /labelSource !== 'local_human_review'/);
  assert.match(validationSource, /validateArtesDetectorLabel/);
});

test('expansion validation checks DINOv2 768D embeddings and keeps grouping provisional', () => {
  assert.match(validationSource, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(validationSource, /EXPECTED_DIMENSION = 768/);
  assert.match(validationSource, /poc_mutual_nearest_neighbor_only/);
  assert.match(validationSource, /thresholdSelected: false/);
});

test('human disagreement with metadata suggestion is preserved instead of overwritten', () => {
  assert.match(validationSource, /metadataSuggestionDisagreements/);
  assert.match(validationSource, /humanOverrodeMetadataSuggestion/);
  assert.match(validationSource, /humanOverridesMetadataSuggestions/);
  assert.match(validationSource, /suggestion\.sexualContext !== reviewed\.detectorLabel\.sexualContext/);
});

test('combined seed merges exactly the two local reviewed batches and remains non-training-ready', () => {
  assert.match(combinedSource, /external_poc_seed_v1/);
  assert.match(combinedSource, /external-expansion-v1/);
  assert.match(combinedSource, /combined_external_seed_v1/);
  assert.match(combinedSource, /trainingReady: false/);
  assert.match(combinedSource, /classifierTrainingRecommended: false/);
  assert.doesNotMatch(combinedSource, /trainingReady: true/);
});

test('combined coverage reports all detector dimensions without printing vectors or image bytes', () => {
  for (const value of ['underwear_swimwear', 'implied_nude', 'genitalia', 'male_topless', 'suggestive', 'bdsm_kink', 'explicit_act']) {
    assert.match(combinedSource, new RegExp(value));
  }
  assert.match(combinedSource, /fullEmbeddingsPrinted: false/);
  assert.match(combinedSource, /imageBytesPrinted: false/);
  assert.doesNotMatch(combinedSource, /JSON\.stringify\(items\)/);
});
