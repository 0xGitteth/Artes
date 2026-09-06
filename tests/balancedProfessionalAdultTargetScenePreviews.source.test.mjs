import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/fetchBalancedProfessionalAdultTargetScenePreviews.js', import.meta.url), 'utf8');

test('balanced target-scene preview fetcher requires the complete 78-ref manifest', () => {
  assert.match(script, /EXPECTED_REF_COUNT = 78/);
  assert.match(script, /EXPECTED_POOL_COUNT = 26/);
  assert.match(script, /poolsWithThreeRefs !== EXPECTED_POOL_COUNT/);
  assert.match(script, /selectedRefCount !== EXPECTED_REF_COUNT/);
  assert.match(script, /balanced_target_preview_flattened_count_mismatch/);
});

test('balanced target-scene preview fetcher allows only observed AdultLabs Pixboost samples and VideoBunch direct images', () => {
  assert.match(script, /host === 'pixboost\.com'/);
  assert.match(script, /\/api\\\/2\\\/img\\\/samples/);
  assert.match(script, /adultlabs_pixboost_sample/);
  assert.match(script, /videobunch\.com/);
  assert.match(script, /direct_image/);
  assert.match(script, /balanced_target_preview_asset_shape_not_allowed/);
});

test('balanced target-scene preview fetcher preserves provenance and screening-only status', () => {
  assert.match(script, /sourcePoolId/);
  assert.match(script, /targetFacet/);
  assert.match(script, /studio/);
  assert.match(script, /sha256/);
  assert.match(script, /exactByteDuplicate/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.match(script, /sessionAuthenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});
