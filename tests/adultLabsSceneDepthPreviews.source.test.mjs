import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/fetchAdultLabsSceneDepthPreviews.js', import.meta.url), 'utf8');

test('scene-depth preview fetcher requires the complete 63-ref, 21-pool manifest', () => {
  assert.match(script, /EXPECTED_REF_COUNT = 63/);
  assert.match(script, /EXPECTED_POOL_COUNT = 21/);
  assert.match(script, /research_adultlabs_scene_depth_preview_refs_only/);
  assert.match(script, /overlapWithFirstThreeBatchCount !== 0/);
  assert.match(script, /adultlabs_scene_depth_flattened_count_mismatch/);
});

test('scene-depth preview fetcher only downloads observed AdultLabs Pixboost sample images', () => {
  assert.match(script, /hostname\.toLowerCase\(\) !== 'pixboost\.com'/);
  assert.match(script, /\/api\\\/2\\\/img\\\/samples/);
  assert.match(script, /asset_set_mismatch/);
  assert.match(script, /image\/jpeg,image\/png,image\/webp/);
  assert.doesNotMatch(script, /image\/avif/);
  assert.match(script, /application\/octet-stream/);
  assert.match(script, /sniffSupportedImage/);
  assert.match(script, /MAX_PREVIEW_BYTES = 4 \* 1024 \* 1024/);
});

test('scene-depth preview screening preserves quantile provenance and cross-batch duplicate evidence', () => {
  assert.match(script, /quantile/);
  assert.match(script, /screenshotOrdinal/);
  assert.match(script, /totalScreenshots/);
  assert.match(script, /exactByteDuplicateOfFirstBatch/);
  assert.match(script, /firstBatchByteDuplicateCount/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.match(script, /sessionAuthenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});
