import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessExternalImageTrainingEligibility } from '../functions/moderationExternalImageEligibility.js';

const manifest = JSON.parse(readFileSync(new URL('../docs/moderation-external-expansion-poc-v1.json', import.meta.url), 'utf8'));

test('external expansion v1 contains four rights-cleared coverage-only Flickr entries', () => {
  assert.equal(manifest.status, 'approved_for_local_embedding_poc_only');
  assert.equal(manifest.round, 'external_expansion_v1');
  assert.equal(manifest.entries.length, 4);

  for (const entry of manifest.entries) {
    const assessment = assessExternalImageTrainingEligibility(entry);
    assert.equal(assessment.eligible, true, `${entry.id}: ${assessment.reasons.join(',')}`);
    assert.match(entry.sourceUrl, /^https:\/\/www\.flickr\.com\/photos\/elementsofthisworld\/\d+\/$/);
    assert.equal(entry.copyrightLicense, 'CC BY 2.0');
    assert.equal(entry.copyrightLicenseVerified, true);
    assert.equal(entry.explicitAiTrainingPermission, true);
    assert.equal(entry.adultStatus, 'verified_over_21_by_source');
    assert.equal(entry.modelRightsStatus, 'creator_subject_owned');
    assert.equal(entry.sourceIsOriginalCreatorLocation, true);
    assert.equal(entry.trainingReady, false);
    assert.match(entry.intendedUse, /^coverage_only_/);
  }
});

test('all pinned image URLs are matching Flickr CDN originals', () => {
  for (const entry of manifest.entries) {
    const sourceId = new URL(entry.sourceUrl).pathname.match(/\/(\d+)\/?$/)?.[1];
    const image = new URL(entry.resolvedImageUrl);
    assert.equal(image.protocol, 'https:');
    assert.match(image.hostname, /^(?:live|farm\d+)\.staticflickr\.com$/i);
    assert.ok(sourceId && image.pathname.includes(`/${sourceId}_`));
  }
});

test('expansion fills three underwear candidates and one genitalia candidate without claiming style coverage', () => {
  const underwear = manifest.entries.filter((entry) => entry.intendedUse.includes('underwear'));
  const genitalia = manifest.entries.filter((entry) => entry.intendedUse.includes('genitalia'));
  assert.equal(underwear.length, 3);
  assert.equal(genitalia.length, 1);
  assert.ok(manifest.limitations.some((value) => value.includes('one creator/model pool')));
  assert.ok(manifest.limitations.some((value) => value.includes('not modern Artes visual-style calibration')));
});

test('expansion manifest does not substitute discovery mirrors as sources', () => {
  const serialized = JSON.stringify(manifest).toLowerCase();
  assert.doesNotMatch(serialized, /wikipedia\.org/);
  assert.doesNotMatch(serialized, /wikimedia\.org/);
  assert.doesNotMatch(serialized, /pexels\.com/);
  assert.doesNotMatch(serialized, /unsplash\.com/);
});
