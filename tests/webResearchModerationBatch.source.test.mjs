import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../docs/moderation-web-research-batch-v1.json', import.meta.url), 'utf8'));
const fetchSource = readFileSync(new URL('../scripts/fetchWebResearchModerationImages.js', import.meta.url), 'utf8');
const prepareSource = readFileSync(new URL('../scripts/prepareWebResearchModerationTestSet.js', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('../vision-service/run_web_research_moderation_poc_v1.sh', import.meta.url), 'utf8');

test('web research batch is meaningfully sized and source-pool diverse', () => {
  assert.equal(manifest.status, 'research_only_not_training_approved');
  assert.ok(manifest.entries.length >= 30);
  const pools = new Set(manifest.entries.map((entry) => entry.sourcePoolId));
  assert.ok(pools.size >= 20);
  const facets = manifest.entries.reduce((counts, entry) => {
    counts[entry.discoveryFacet] = (counts[entry.discoveryFacet] || 0) + 1;
    return counts;
  }, {});
  assert.ok((facets.implied_nude || 0) >= 10);
  assert.ok((facets.male_topless || 0) >= 12);
  assert.ok((facets.underwear_swimwear || 0) + (facets.bdsm_kink_boundary || 0) >= 5);
});

test('manifest separates research collection from training and production approval', () => {
  assert.equal(manifest.rules.publicPagesOnly, true);
  assert.equal(manifest.rules.loginBypassAllowed, false);
  assert.equal(manifest.rules.localOnly, true);
  assert.equal(manifest.rules.commitImageBytes, false);
  assert.equal(manifest.rules.humanLabelRequired, true);
  assert.equal(manifest.rules.skipIfMinorOrAgeSeemsUncertain, true);
  assert.equal(manifest.rules.trainingReady, false);
  assert.equal(manifest.rules.productionEligible, false);
  for (const entry of manifest.entries) {
    assert.match(entry.sourceUrl, /^https:\/\/(?:www\.)?flickr\.com\/photos\/[^/]+\/\d+\/$/);
    assert.ok(entry.sourcePoolId);
    assert.match(entry.rightsStatus, /research_only$/);
  }
  assert.equal(new Set(manifest.entries.map((entry) => entry.sourceUrl)).size, manifest.entries.length);
});

test('research fetcher deliberately does not apply production rights eligibility', () => {
  assert.doesNotMatch(fetchSource, /assertExternalImageTrainingEligible|assessExternalImageTrainingEligibility/);
  assert.match(fetchSource, /researchOnly: true/);
  assert.match(fetchSource, /trainingReady: false/);
  assert.match(fetchSource, /productionEligible: false/);
  assert.match(fetchSource, /humanAgeSafetyReviewRequired: true/);
  assert.match(fetchSource, /failures\.push/);
  assert.match(fetchSource, /Skipped research image/);
  assert.match(fetchSource, /meaningfulReviewBatch/);
});

test('research fetcher stays on public Flickr and bounded local storage', () => {
  assert.match(fetchSource, /ALLOWED_FLICKR_SOURCE_HOSTS/);
  assert.match(fetchSource, /ALLOWED_STATIC_HOST/);
  assert.match(fetchSource, /MAX_IMAGE_BYTES = 15 \* 1024 \* 1024/);
  assert.match(fetchSource, /\.tmp', 'moderation-test-images'/);
  assert.doesNotMatch(fetchSource, /firebase|gcloud|artes-media-app|artes-staging/);
});

test('DINO preparation preserves research provenance and cannot promote examples', () => {
  assert.match(prepareSource, /sourcePoolId/);
  assert.match(prepareSource, /sourceUrl/);
  assert.match(prepareSource, /rightsStatus/);
  assert.match(prepareSource, /ageStatus/);
  assert.match(prepareSource, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(prepareSource, /EXPECTED_DIMENSION = 768/);
  assert.match(prepareSource, /web_research_vision_endpoint_must_be_loopback/);
  assert.match(prepareSource, /detectorLabel: null/);
  assert.match(prepareSource, /semanticClusterApproved: false/);
  assert.match(prepareSource, /researchOnly: true/);
  assert.match(prepareSource, /trainingReady: false/);
  assert.match(prepareSource, /productionEligible: false/);
  assert.doesNotMatch(prepareSource, /trainingReady: true/);
});

test('web research runner is local, resumable and isolated from existing seeds', () => {
  assert.match(runnerSource, /ENDPOINT="http:\/\/127\.0\.0\.1:8787"/);
  assert.match(runnerSource, /--host 127\.0\.0\.1/);
  assert.match(runnerSource, /ARTES_WEB_RESEARCH_SKIP_FETCH/);
  assert.match(runnerSource, /fetchWebResearchModerationImages\.js/);
  assert.match(runnerSource, /prepareWebResearchModerationTestSet\.js/);
  assert.match(runnerSource, /research-only, not training-approved and not production-eligible/);
  assert.doesNotMatch(runnerSource, /firebase deploy|gcloud|artes-media-app|artes-staging|combined-external-v/);
});
