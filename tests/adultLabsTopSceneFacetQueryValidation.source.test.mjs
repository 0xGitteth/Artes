import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/validateAdultLabsTopSceneFacetQueries.js', import.meta.url), 'utf8');

test('top scene facet validator uses the exact client-state control parameters', () => {
  assert.match(script, /t_h/);
  assert.match(script, /t_g/);
  assert.match(script, /t_l/);
  assert.match(script, /t_b/);
  assert.match(script, /t_bh/);
  assert.match(script, /sceneUrl/);
  assert.match(script, /parameter === activeParameter \? '1' : ''/);
  assert.match(script, /Boys Solo/);
  assert.match(script, /Boys Hardcore/);
});

test('top scene facet validator proves filtered product-set and metadata differences', () => {
  assert.match(script, /collectPhotoProducts/);
  assert.match(script, /detailProbe/);
  assert.match(script, /inferDiscoveryFacets/);
  assert.match(script, /overlapWithBaseline/);
  assert.match(script, /changedFromBaseline/);
  assert.match(script, /expectedEvidenceCount/);
  assert.match(script, /metadataValidated/);
  assert.match(script, /targetPairOverlap/);
});

test('top scene facet validator remains public metadata-only research', () => {
  assert.match(script, /Accept: 'text\/html/);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
  assert.doesNotMatch(script, /collectImageRefs|previewReferences/);
});
