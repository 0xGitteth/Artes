import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const validationSource = readFileSync(new URL('../scripts/validateReviewedExternalMaleToplessV1.js', import.meta.url), 'utf8');
const combinedSource = readFileSync(new URL('../scripts/buildCombinedExternalModerationSeedV2.js', import.meta.url), 'utf8');

test('male-topless review validation requires one complete human-confirmed hashed item', () => {
  assert.match(validationSource, /expected_exactly_one_item/);
  assert.match(validationSource, /labelStatus !== 'human_confirmed'/);
  assert.match(validationSource, /labelSource !== 'local_human_review'/);
  assert.match(validationSource, /hash_or_file_mismatch/);
  assert.match(validationSource, /validateArtesDetectorLabel/);
});

test('male-topless review validation requires DINOv2 768D and source-pool provenance', () => {
  assert.match(validationSource, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(validationSource, /EXPECTED_DIMENSION = 768/);
  assert.match(validationSource, /missing_source_pool/);
  assert.match(validationSource, /humanOverrodeMetadataSuggestion/);
  assert.match(validationSource, /trainingReady: false/);
  assert.doesNotMatch(validationSource, /trainingReady: true/);
});

test('combined seed v2 adds exactly one reviewed batch to the eight-item base without promotion', () => {
  assert.match(combinedSource, /baseSeed\.items\.length !== 8/);
  assert.match(combinedSource, /maleIntake\.items\.length !== 1/);
  assert.match(combinedSource, /combined_external_seed_v2/);
  assert.match(combinedSource, /external-male-topless-v1/);
  assert.match(combinedSource, /trainingReady: false/);
  assert.match(combinedSource, /classifierTrainingRecommended: false/);
  assert.match(combinedSource, /sourcePoolLeakageGuardRequired: true/);
  assert.doesNotMatch(combinedSource, /trainingReady: true/);
});

test('combined v2 reports source pools per nudity class and does not print vectors or image bytes', () => {
  assert.match(combinedSource, /sourcePoolsPerNudity/);
  assert.match(combinedSource, /fullEmbeddingsPrinted: false/);
  assert.match(combinedSource, /imageBytesPrinted: false/);
  assert.doesNotMatch(combinedSource, /JSON\.stringify\(items\)/);
});
