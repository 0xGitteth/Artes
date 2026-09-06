import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/discoverProfessionalAdultB2bSetCandidates.js', import.meta.url), 'utf8');

test('B2B discovery groups previews by photographic set for leakage-aware source pools', () => {
  assert.match(script, /sourcePoolId: `adultlabs-set-\$\{item\.setId\}`/);
  assert.match(script, /MAX_PREVIEW_REFS_PER_SET = 8/);
  assert.match(script, /sourcePoolCount/);
  assert.match(script, /setCount: records\.length/);
});

test('B2B set discovery preserves scene diversity evidence without turning metadata into labels', () => {
  assert.match(script, /inferSceneFacets/);
  assert.match(script, /male_male/);
  assert.match(script, /male_female/);
  assert.match(script, /female_female/);
  assert.match(script, /group/);
  assert.match(script, /solo/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /detectorLabel: null/);
});

test('B2B discovery reports facet shortages instead of filling them with the dominant scene type', () => {
  assert.match(script, /preferredFacetFloor/);
  assert.match(script, /facetShortages/);
  assert.match(script, /male_male: 6/);
  assert.match(script, /male_female: 10/);
  assert.match(script, /female_female: 8/);
});

test('youth-coded adult marketing remains review context and never becomes age proof', () => {
  assert.match(script, /youthCodedMarketingContext/);
  assert.match(script, /youthCodedMarketingIsNotAgeProof: true/);
  assert.match(script, /sourceAdultAgeContext/);
  assert.match(script, /humanAgeSafetyReviewRequired: true/);
});

test('set discovery remains metadata-only local research', () => {
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /arrayBuffer\(/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});
