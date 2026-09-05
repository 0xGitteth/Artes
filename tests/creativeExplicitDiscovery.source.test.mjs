import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-creative-explicit-discovery-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/discoverCreativeExplicitFlickrCandidates.js', import.meta.url), 'utf8');

test('explicit discovery is large-scale before another user download run', () => {
  assert.ok(config.minimumDiscoveryTarget >= 200);
  assert.ok(config.metadataShortlistTarget >= 180);
  assert.ok(config.desiredShortlistTarget >= 120);
  assert.ok(config.tags.length >= 30);
  assert.ok(config.minimumMetadataShortlistOwners >= 60);
  assert.ok(config.maxMetadataShortlistPerOwner <= 3);
});

test('discovery includes hard explicit gaps instead of only mild nude and kink tags', () => {
  const tags = new Set(config.tags.map((value) => String(value).toLowerCase()));
  for (const required of ['fullfrontal', 'genitalia', 'vulva', 'penis', 'masturbation', 'oralsex', 'sexualintercourse']) {
    assert.ok(tags.has(required), `missing hard-explicit discovery tag ${required}`);
  }
  const explicitTags = new Set(config.bucketTags.explicit_act.map((value) => String(value).toLowerCase()));
  for (const required of ['masturbation', 'masturbazione', 'masturbationmonday', 'oralsex', 'orally', 'cunniligus', 'sexualintercourse', 'intercourse', 'couplesex']) {
    assert.ok(explicitTags.has(required), `missing broadened explicit-act tag ${required}`);
  }
  assert.ok(explicitTags.size >= 10);
  assert.ok(config.bucketTargets.full_frontal_genitalia >= 40);
  assert.ok(config.bucketTargets.explicit_act >= 40);
});

test('discovery remains metadata-only and non-authoritative', () => {
  assert.equal(config.rules.metadataDiscoveryOnly, true);
  assert.equal(config.rules.downloadImageBytes, false);
  assert.equal(config.rules.discoveryIsLabelAuthority, false);
  assert.equal(config.rules.humanVisualScreeningRequiredBeforeManifest, true);
  assert.equal(config.rules.hardExplicitCandidatesRequireHumanAgeSafetyReview, true);
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

test('obvious virtual, AI and minor-concern signals are filtered before human screening', () => {
  const nonPhoto = new Set(config.obviousNonPhotoTextSignals.map((value) => String(value).toLowerCase()));
  const ageConcern = new Set(config.obviousMinorConcernTextSignals.map((value) => String(value).toLowerCase()));
  assert.ok(nonPhoto.has('second life'));
  assert.ok(nonPhoto.has('maps.secondlife.com'));
  assert.ok(nonPhoto.has('midjourney'));
  assert.ok(nonPhoto.has('ai generated'));
  assert.ok(ageConcern.has('teen'));
  assert.ok(ageConcern.has('underage'));
  assert.ok(ageConcern.has('child'));
  assert.match(script, /obviousNonPhotoSignal/);
  assert.match(script, /obviousMinorConcernSignal/);
  assert.match(script, /humanAgeSafetyReviewRequired: true/);
});
