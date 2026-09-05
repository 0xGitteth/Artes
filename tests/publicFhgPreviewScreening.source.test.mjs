import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/fetchPublicFhgPreviewScreening.js', import.meta.url), 'utf8');

test('public FHG preview screening only accepts explicitly whitelisted publisher hosts', () => {
  assert.match(script, /ALLOWED_ASSET_HOSTS/);
  assert.match(script, /www\.mastasia\.com/);
  assert.match(script, /fhg\.metart\.com/);
  assert.match(script, /static-fhg\.metart\.com/);
  assert.match(script, /hosted\.met-art\.com/);
  assert.match(script, /public_fhg_preview_asset_host_not_allowed/);
});

test('public FHG previews are bounded research-only image fetches', () => {
  assert.match(script, /MAX_PREVIEW_BYTES = 2 \* 1024 \* 1024/);
  assert.match(script, /image\/jpeg/);
  assert.match(script, /image\/png/);
  assert.match(script, /image\/webp/);
  assert.match(script, /previewOnly: true/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});

test('public FHG preview fetcher never sends auth or cookies and preserves provenance', () => {
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
  assert.match(script, /galleryUrls/);
  assert.match(script, /ageContext/);
  assert.match(script, /rightsContext/);
  assert.match(script, /termsStatus/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
});

test('public FHG screening reads only the completed discovery output', () => {
  assert.match(script, /gallery-assets\.json/);
  assert.match(script, /research_public_fhg_gallery_asset_candidates_only/);
  assert.match(script, /discovery\.candidates\.length < 40/);
});
