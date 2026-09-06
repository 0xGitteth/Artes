import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/resolveAdultLabsCatalogFacetFilters.js', import.meta.url), 'utf8');

test('facet resolver targets the missing AdultLabs scene categories', () => {
  assert.match(script, /Boys Hardcore/);
  assert.match(script, /Boys Solo/);
  assert.match(script, /Girls Solo/);
  assert.match(script, /Lesbo/);
  assert.match(script, /Hardcore/);
});

test('facet resolver remains public metadata-only research', () => {
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});

test('facet ids must be bound to exact UI controls rather than nearby navigation numbers', () => {
  assert.match(script, /collectExactFacetControls/);
  assert.match(script, /label_wrapped_input/);
  assert.match(script, /for_label_input/);
  assert.match(script, /exact_anchor_text/);
  assert.doesNotMatch(script, /index - 900/);
  assert.doesNotMatch(script, /numericCandidates/);
});

test('facet validation requires the filtered product set to differ from the baseline', () => {
  assert.match(script, /baseProducts/);
  assert.match(script, /jaccard/);
  assert.match(script, /overlapWithBase/);
  assert.match(script, /changedProductSet/);
  assert.match(script, /overlapWithBase < 0\.95/);
  assert.match(script, /exactFacetControlStillPresent/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
});
