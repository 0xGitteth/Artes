import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/discoverAdultLabsAttributeFilters.js', import.meta.url), 'utf8');

test('AdultLabs attribute discovery uses real product attribute links instead of top navigation proximity', () => {
  assert.match(script, /collectProductAttributeAnchors/);
  assert.match(script, /searchParams\.getAll\('n\[\]'\)/);
  assert.match(script, /targetsForLabel/);
  assert.doesNotMatch(script, /index - 900|numericCandidates|nearby/i);
});

test('AdultLabs attribute discovery is bounded and can stop when missing relation facets are found', () => {
  assert.match(script, /MAX_PAGES = 80/);
  assert.match(script, /REQUIRED_FOR_STOP/);
  assert.match(script, /male_male/);
  assert.match(script, /male_female/);
  assert.match(script, /solo_male/);
});

test('facet filters are validated against changed products and repeated target attributes', () => {
  assert.match(script, /changedFromBaseline/);
  assert.match(script, /targetAttributeOccurrenceCount/);
  assert.match(script, /targetAttributeOccurrenceCount >= productIds\.length/);
  assert.match(script, /validated:/);
});

test('AdultLabs attribute discovery remains metadata-only research', () => {
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
