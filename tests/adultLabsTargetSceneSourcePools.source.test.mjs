import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/discoverAdultLabsTargetSceneSourcePools.js', import.meta.url), 'utf8');

test('target scene discovery follows validated AdultLabs client-state routes', () => {
  assert.match(script, /t_bh/);
  assert.match(script, /t_b/);
  assert.match(script, /t_h/);
  assert.match(script, /scenePageUrl/);
  assert.match(script, /Product_page/);
  assert.match(script, /Boys Hardcore/);
  assert.match(script, /Boys Solo/);
});

test('target scene discovery requires product metadata support before accepting source pools', () => {
  assert.match(script, /targetFacetSupportedByMetadata/);
  assert.match(script, /male_male/);
  assert.match(script, /solo_male/);
  assert.match(script, /male_female/);
  assert.match(script, /sourcePoolId/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /detectorLabel: null/);
});

test('target scene discovery remains public metadata-only research', () => {
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});
