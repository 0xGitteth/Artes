import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-creative-explicit-discovery-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/discoverCreativeExplicitFlickrCandidates.js', import.meta.url), 'utf8');

test('explicit discovery is large-scale before another user download run', () => {
  assert.ok(config.minimumDiscoveryTarget >= 200);
  assert.ok(config.desiredShortlistTarget >= 120);
  assert.ok(config.tags.length >= 15);
});

test('discovery remains metadata-only and non-authoritative', () => {
  assert.equal(config.rules.metadataDiscoveryOnly, true);
  assert.equal(config.rules.downloadImageBytes, false);
  assert.equal(config.rules.discoveryIsLabelAuthority, false);
  assert.equal(config.rules.humanVisualScreeningRequiredBeforeManifest, true);
  assert.equal(config.rules.trainingReady, false);
  assert.equal(config.rules.productionEligible, false);
});

test('discovery stays on public Flickr tag/photo pages without auth or cookies', () => {
  assert.match(script, /https:\/\/www\.flickr\.com\/photos\/tags\//);
  assert.match(script, /EXACT_PHOTO_PATH/);
  assert.match(script, /metadataDiscoveryOnly/);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.doesNotMatch(script, /Authorization|Bearer|Cookie/);
});

test('obvious virtual and AI signals are filtered before human screening', () => {
  const signals = new Set(config.obviousNonPhotoTextSignals.map((value) => String(value).toLowerCase()));
  assert.ok(signals.has('second life'));
  assert.ok(signals.has('maps.secondlife.com'));
  assert.ok(signals.has('midjourney'));
  assert.ok(signals.has('ai generated'));
  assert.match(script, /obviousNonPhotoSignal/);
});
