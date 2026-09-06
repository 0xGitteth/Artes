import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/discoverPhotoramaMaleFemaleSourcePools.js', import.meta.url), 'utf8');

test('Photorama discovery fills only the remaining male-female source-pool shortage', () => {
  assert.match(script, /TARGET_TOTAL_MALE_FEMALE_POOLS/);
  assert.match(script, /existingAdultLabsMaleFemale/);
  assert.match(script, /neededFromPhotorama/);
  assert.match(script, /remainingShortage/);
});

test('Photorama discovery requires product-specific male-female and explicit-act metadata support', () => {
  assert.match(script, /MALE_FEMALE/);
  assert.match(script, /EXPLICIT_ACT/);
  assert.match(script, /extractHeadings/);
  assert.match(script, /primaryEvidenceText/);
  assert.match(script, /anchor_title_meta_headings_only/);
  assert.match(script, /maleFemaleSupportedByMetadata = MALE_FEMALE\.test\(primaryEvidenceText\)/);
  assert.match(script, /explicitActSupportedByMetadata = EXPLICIT_ACT\.test\(primaryEvidenceText\)/);
  assert.match(script, /acceptedForMaleFemaleDiscovery: maleFemaleSupportedByMetadata && explicitActSupportedByMetadata/);
  assert.match(script, /humanVisualScreeningRequired: true/);
});

test('Photorama discovery remains public metadata-only research', () => {
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
