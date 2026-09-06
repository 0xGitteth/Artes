import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/discoverVideoBunchMaleFemaleSourcePools.js', import.meta.url), 'utf8');

test('VideoBunch discovery fills the remaining male-female source-pool shortage from AdultLabs only', () => {
  assert.match(script, /TARGET_TOTAL_MALE_FEMALE_POOLS/);
  assert.match(script, /adultlabs-target-scene-source-pools\.json/);
  assert.match(script, /existingAdultLabsMaleFemale/);
  assert.match(script, /neededFromVideoBunch/);
  assert.match(script, /remainingShortage/);
  assert.doesNotMatch(script, /Photorama|photorama/);
  assert.doesNotMatch(script, /WeShootAdult|weshootadult/);
});

test('VideoBunch discovery requires product Content Info evidence and studio diversity', () => {
  assert.match(script, /product_content_info_only/);
  assert.match(script, /STRAIGHT/);
  assert.match(script, /EXPLICIT_ACT/);
  assert.match(script, /HIGHRES_HARDCORE/);
  assert.match(script, /COMPLIANT_2257/);
  assert.match(script, /MAX_ACCEPTED_PER_STUDIO/);
  assert.match(script, /youthCodedCandidatesExcludedFromPreferredShortlist: true/);
  assert.match(script, /humanVisualScreeningRequired: true/);
});

test('VideoBunch discovery stays public metadata-only and does not download preview images', () => {
  assert.match(script, /https:\/\/www\.videobunch\.com\//);
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
