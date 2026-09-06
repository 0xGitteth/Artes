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

test('facet resolver proves candidate filters with real product pages instead of trusting labels alone', () => {
  assert.match(script, /productCount/);
  assert.match(script, /containsFacetEvidence/);
  assert.match(script, /resolvedCandidates/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
});
