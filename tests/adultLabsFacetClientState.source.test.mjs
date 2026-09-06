import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/resolveAdultLabsFacetClientState.js', import.meta.url), 'utf8');

test('client-state resolver traces exact AdultLabs facet control ids and shared handlers', () => {
  assert.match(script, /Hardcore/);
  assert.match(script, /Girls Solo/);
  assert.match(script, /Lesbo/);
  assert.match(script, /Boys Solo/);
  assert.match(script, /Boys Hardcore/);
  assert.match(script, /collectTargetControls/);
  assert.match(script, /exactIdEvidence/);
  assert.match(script, /classEvidence/);
  assert.match(script, /this\.id/);
});

test('client-state resolver traces BBQ and Yii state construction from public scripts only', () => {
  assert.match(script, /content\.js/);
  assert.match(script, /adultlabs\.js/);
  assert.match(script, /\$\.bbq/);
  assert.match(script, /pushState/);
  assert.match(script, /getState/);
  assert.match(script, /yiiListView/);
  assert.match(script, /Product_page/);
  assert.match(script, /genericRouteEvidence/);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});

test('client-state resolver remains metadata-only and non-authoritative', () => {
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
