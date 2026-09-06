import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/inspectAdultLabsPreviewReferenceMarkup.js', import.meta.url), 'utf8');

test('AdultLabs preview diagnostic inspects representative accepted target-scene sets', () => {
  assert.match(script, /1233407700/);
  assert.match(script, /1236628938/);
  assert.match(script, /1326651498/);
  assert.match(script, /content\/screenshots/);
});

test('AdultLabs preview diagnostic inspects markup, script and CSS reference shapes', () => {
  assert.match(script, /data-src/);
  assert.match(script, /srcset/);
  assert.match(script, /css_url/);
  assert.match(script, /quoted_image_string/);
  assert.match(script, /inlineScriptSnippets/);
  assert.match(script, /markupMarkers/);
});

test('AdultLabs preview diagnostic remains reference-only public research', () => {
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
  assert.doesNotMatch(script, /arrayBuffer\s*\(/);
});
