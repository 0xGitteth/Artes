import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const script = await readFile(new URL('../scripts/inspectAdultLabsFacetControls.js', import.meta.url), 'utf8');

test('facet control diagnostic inspects exact AdultLabs top-level scene controls', () => {
  assert.match(script, /Boys Hardcore/);
  assert.match(script, /Boys Solo/);
  assert.match(script, /Girls Solo/);
  assert.match(script, /Lesbo/);
  assert.match(script, /Hardcore/);
  assert.match(script, /collectControls/);
  assert.match(script, /collectForms/);
});

test('facet control diagnostic can inspect public JavaScript without entering authenticated areas', () => {
  assert.match(script, /collectInlineScripts/);
  assert.match(script, /collectScriptUrls/);
  assert.match(script, /externalScripts/);
  assert.match(script, /ajax|fetch\\s\*\\\(/i);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /authenticationUsed: false/);
  assert.match(script, /purchasePerformed: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['\"]Cookie['\"]\s*:/i);
});

test('facet control diagnostic remains research-only and non-authoritative', () => {
  assert.match(script, /sourceIntentIsLabelAuthority: false/);
  assert.match(script, /researchOnly: true/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
