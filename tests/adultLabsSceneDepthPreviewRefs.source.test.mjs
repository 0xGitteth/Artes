import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/discoverAdultLabsSceneDepthPreviewRefs.js', import.meta.url), 'utf8');

test('AdultLabs scene-depth sampling uses all 21 completed AdultLabs target pools', () => {
  assert.match(source, /EXPECTED_POOL_COUNT = 21/);
  assert.match(source, /male_male/);
  assert.match(source, /solo_male/);
  assert.match(source, /male_female/);
  assert.match(source, /targetFacetSupportedByMetadata === true/);
});

test('scene-depth sampling uses dispersed quantiles and avoids the first-three review batch', () => {
  assert.match(source, /QUANTILES = \[0\.35, 0\.65, 0\.9\]/);
  assert.match(source, /scene_depth_quantiles/);
  assert.match(source, /previouslySelected/);
  assert.match(source, /overlapWithFirstThreeBatchCount/);
  assert.match(source, /EXPECTED_SELECTED_COUNT/);
});

test('scene-depth discovery remains public reference-only research', () => {
  assert.match(source, /pixboost\.com/);
  assert.match(source, /\/content\/screenshots\//);
  assert.match(source, /imageBytesDownloaded: false/);
  assert.match(source, /authenticationUsed: false/);
  assert.match(source, /purchasePerformed: false/);
  assert.match(source, /sourceIntentIsLabelAuthority: false/);
  assert.match(source, /humanVisualScreeningRequired: true/);
  assert.match(source, /researchOnly: true/);
  assert.match(source, /trainingReady: false/);
  assert.match(source, /productionEligible: false/);
  assert.doesNotMatch(source, /arrayBuffer\s*\(/);
  assert.doesNotMatch(source, /Authorization|Bearer|['\"]Cookie['\"]\s*:/i);
});
