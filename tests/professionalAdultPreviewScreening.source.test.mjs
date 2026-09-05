import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/fetchProfessionalAdultPublicPreviewScreening.js', import.meta.url), 'utf8');

test('professional adult preview screening only accepts whitelisted publisher and photographer asset hosts', () => {
  assert.match(script, /fhg\.vivthomas\.com/);
  assert.match(script, /static-fhg\.vivthomas\.com/);
  assert.match(script, /static\.vivthomas\.com/);
  assert.match(script, /images\.squarespace-cdn\.com/);
  assert.match(script, /professional_preview_asset_host_not_allowed/);
});

test('professional preview fetch is bounded and image-only', () => {
  assert.match(script, /MAX_PREVIEW_BYTES = 2 \* 1024 \* 1024/);
  assert.match(script, /image\/jpeg/);
  assert.match(script, /image\/png/);
  assert.match(script, /image\/webp/);
  assert.match(script, /professional_preview_unsupported_mime/);
});

test('professional preview screening remains research-only and non-authoritative', () => {
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});
