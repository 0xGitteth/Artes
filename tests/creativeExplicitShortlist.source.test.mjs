import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-creative-explicit-discovery-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/shortlistCreativeExplicitFlickrCandidates.js', import.meta.url), 'utf8');

test('metadata shortlist is intentionally much larger than the final human shortlist', () => {
  assert.ok(config.metadataShortlistTarget >= 180);
  assert.ok(config.desiredShortlistTarget >= 120);
  assert.ok(config.metadataShortlistTarget > config.desiredShortlistTarget);
});

test('metadata shortlist protects hard-content sourcing buckets first', () => {
  assert.ok(config.bucketTargets.explicit_act >= 40);
  assert.ok(config.bucketTargets.full_frontal_genitalia >= 40);
  assert.match(script, /\['explicit_act', 'full_frontal_genitalia', 'bdsm_kink', 'art_nude'\]/);
  assert.match(script, /bucketShortages/);
  assert.match(script, /bucketTargetsReached/);
});

test('metadata shortlist enforces source diversity before previews', () => {
  assert.ok(config.minimumMetadataShortlistOwners >= 60);
  assert.ok(config.maxMetadataShortlistPerOwner <= 3);
  assert.match(script, /ownerSelectedCounts/);
  assert.match(script, /largestShortlistOwnerCount/);
  assert.match(script, /sourceDiversityReached/);
});

test('metadata shortlist remains non-authoritative and downloads no images', () => {
  assert.match(script, /metadataShortlistOnly: true/);
  assert.match(script, /humanVisualScreeningRequired: true/);
  assert.match(script, /humanAgeSafetyReviewRequired: true/);
  assert.match(script, /detectorLabel: null/);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.match(script, /trainingReady: false/);
  assert.match(script, /productionEligible: false/);
});
