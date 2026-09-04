import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessExternalImageTrainingEligibility } from '../functions/moderationExternalImageEligibility.js';

const manifest = JSON.parse(readFileSync(new URL('../docs/moderation-external-male-topless-poc-v1.json', import.meta.url), 'utf8'));

test('male-topless v1 contains one independent rights-cleared Flickr self-subject candidate', () => {
  assert.equal(manifest.status, 'approved_for_local_embedding_poc_only');
  assert.equal(manifest.entries.length, 1);
  const [entry] = manifest.entries;
  assert.equal(entry.sourcePoolId, 'flickr_isana_chiba_self');
  assert.equal(entry.visualFacet, 'adult_male_topless_self_portrait');
  assert.equal(entry.sourcePlatform, 'flickr');
  assert.match(entry.sourceUrl, /^https:\/\/www\.flickr\.com\/photos\/[^/]+\/\d+\/$/);
  assert.equal(entry.trainingReady, false);
});

test('Isana candidate passes the existing fail-closed rights gate without special casing', () => {
  const [entry] = manifest.entries;
  const assessment = assessExternalImageTrainingEligibility(entry);
  assert.equal(assessment.eligible, true, assessment.reasons.join(','));
  assert.deepEqual(assessment.reasons, []);
  assert.equal(entry.copyrightLicenseVerified, true);
  assert.equal(entry.rightsStatus, 'cc0');
  assert.equal(entry.adultStatus, 'verified_adult');
  assert.equal(entry.modelRightsStatus, 'self_subject');
  assert.equal(entry.sourceIsOriginalCreatorLocation, true);
});

test('manifest preserves original Flickr as source and uses Commons only as rights evidence', () => {
  const [entry] = manifest.entries;
  assert.match(entry.sourceUrl, /flickr\.com/);
  assert.match(entry.rightsEvidenceUrl, /commons\.wikimedia\.org/);
  assert.doesNotMatch(entry.sourceUrl, /wikimedia|wikipedia/);
});
