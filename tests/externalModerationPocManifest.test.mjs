import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessExternalImageTrainingEligibility } from '../functions/moderationExternalImageEligibility.js';

const manifest = JSON.parse(readFileSync(new URL('../docs/moderation-external-poc-manifest-v1.json', import.meta.url), 'utf8'));
const fetcherSource = readFileSync(new URL('../scripts/fetchExternalModerationPocImages.js', import.meta.url), 'utf8');

test('every external POC manifest entry passes the fail-closed eligibility gate', () => {
  assert.equal(manifest.status, 'approved_for_local_embedding_poc_only');
  assert.ok(Array.isArray(manifest.entries));
  assert.ok(manifest.entries.length >= 4);
  for (const entry of manifest.entries) {
    const assessment = assessExternalImageTrainingEligibility(entry);
    assert.equal(assessment.eligible, true, `${entry.id}: ${assessment.reasons.join(',')}`);
    assert.match(entry.sourceUrl, /^https:\/\/(?:www\.)?flickr\.com\/photos\/[^/]+\/\d+\/?$/);
    assert.notEqual(entry.intendedUse, 'training_ready');
  }
});

test('manifest uses original Flickr sources and not blocked discovery mirrors', () => {
  const serialized = JSON.stringify(manifest).toLowerCase();
  assert.doesNotMatch(serialized, /pexels\.com/);
  assert.doesNotMatch(serialized, /unsplash\.com/);
  assert.doesNotMatch(serialized, /wikipedia\.org/);
  assert.doesNotMatch(serialized, /wikimedia\.org/);
});

test('adult entries can pin exact Flickr CDN originals without weakening source checks', () => {
  const pinned = manifest.entries.filter((entry) => entry.resolvedImageUrl);
  assert.ok(pinned.length >= 2);
  for (const entry of pinned) {
    const sourceId = new URL(entry.sourceUrl).pathname.match(/\/(\d+)\/?$/)?.[1];
    const resolved = new URL(entry.resolvedImageUrl);
    assert.equal(resolved.protocol, 'https:');
    assert.match(resolved.hostname, /^(?:live|farm\d+)\.staticflickr\.com$/i);
    assert.ok(sourceId && resolved.pathname.includes(`/${sourceId}_`));
  }
});

test('fetcher is local-only, bounded and restricts resolved images to static Flickr hosts', () => {
  assert.match(fetcherSource, /\.tmp.*moderation-test-images/s);
  assert.match(fetcherSource, /MAX_IMAGE_BYTES = 15 \* 1024 \* 1024/);
  assert.match(fetcherSource, /staticflickr/);
  assert.match(fetcherSource, /assertExternalImageTrainingEligible/);
  assert.match(fetcherSource, /external_poc_pinned_image_photo_id_mismatch/);
  assert.match(fetcherSource, /trainingReady: false/);
  assert.doesNotMatch(fetcherSource, /child_process|exec\(|spawn\(/);
});

test('fetcher supports only bounded manifest and output names while preserving seed defaults', () => {
  assert.match(fetcherSource, /DEFAULT_MANIFEST_NAME = 'moderation-external-poc-manifest-v1\.json'/);
  assert.match(fetcherSource, /DEFAULT_OUTPUT_SUBDIR = 'external-poc'/);
  assert.match(fetcherSource, /ARTES_EXTERNAL_POC_MANIFEST/);
  assert.match(fetcherSource, /ARTES_EXTERNAL_POC_OUTPUT_SUBDIR/);
  assert.match(fetcherSource, /MANIFEST_NAME_PATTERN = \/\^\[A-Za-z0-9\._-\]\+\\\.json\$\//);
  assert.match(fetcherSource, /OUTPUT_SUBDIR_PATTERN = \/\^\[a-z0-9\]\[a-z0-9\._-\]\*\$\//);
  assert.match(fetcherSource, /candidate\.includes\('\.\.'\)/);
  assert.match(fetcherSource, /path\.join\(REPO_ROOT, 'docs', MANIFEST_NAME\)/);
  assert.match(fetcherSource, /path\.join\(REPO_ROOT, '\.tmp', 'moderation-test-images', OUTPUT_SUBDIR\)/);
});
