import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/discoverBalancedProfessionalAdultPreviewRefs.js', import.meta.url), 'utf8');

test('balanced preview discovery uses the completed target-scene source pools with a hard per-pool cap', () => {
  assert.match(script, /adultlabs-target-scene-source-pools\.json/);
  assert.match(script, /videobunch-male-female-source-pools\.json/);
  assert.match(script, /MAX_REFS_PER_POOL = 3/);
  assert.match(script, /male_male:\s*10/);
  assert.match(script, /solo_male:\s*6/);
  assert.match(script, /male_female:\s*10/);
  assert.match(script, /balanced_preview_pool_shortage/);
});

test('balanced preview discovery preserves source-pool and studio provenance for review', () => {
  assert.match(script, /sourcePoolId/);
  assert.match(script, /targetFacet/);
  assert.match(script, /studio/);
  assert.match(script, /selectedAssetRefs/);
  assert.match(script, /refsByFacet/);
  assert.match(script, /studioCounts/);
  assert.match(script, /humanVisualScreeningRequired: true/);
});

test('balanced preview discovery is reference-only and does not download image bytes', () => {
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /arrayBuffer\s*\(/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});
