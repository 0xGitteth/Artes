import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/traceAdultLabsFacetRuntimeRoute.js', import.meta.url), 'utf8');

test('runtime route tracer binds exact top-level AdultLabs facet controls to script evidence', () => {
  assert.match(script, /Hardcore/);
  assert.match(script, /Girls Solo/);
  assert.match(script, /Lesbo/);
  assert.match(script, /Boys Solo/);
  assert.match(script, /Boys Hardcore/);
  assert.match(script, /collectTargetControls/);
  assert.match(script, /controlTokens/);
  assert.match(script, /tokenHits/);
  assert.match(script, /targetEvidence/);
});

test('runtime route tracer inspects BBQ and Yii listview state without browser authentication', () => {
  assert.match(script, /jquery\.ba-bbq\.js/);
  assert.match(script, /jquery\.yiilistview\.js/);
  assert.match(script, /content\.js/);
  assert.match(script, /pushState/);
  assert.match(script, /getState/);
  assert.match(script, /hashchange/);
  assert.match(script, /yiiListView/);
  assert.match(script, /candidateStateKeys/);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});

test('runtime route tracer remains metadata-only research and non-authoritative', () => {
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
