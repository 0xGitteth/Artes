import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../docs/moderation-web-research-batch-v2.json', import.meta.url), 'utf8'));
const fetchSource = readFileSync(new URL('../scripts/fetchWebResearchModerationImages.js', import.meta.url), 'utf8');
const prepareSource = readFileSync(new URL('../scripts/prepareWebResearchModerationTestSet.js', import.meta.url), 'utf8');
const genericRunnerSource = readFileSync(new URL('../vision-service/run_web_research_moderation_poc_v1.sh', import.meta.url), 'utf8');
const v2RunnerSource = readFileSync(new URL('../vision-service/run_web_research_moderation_poc_v2.sh', import.meta.url), 'utf8');

const countsByFacet = manifest.entries.reduce((counts, entry) => {
  counts[entry.discoveryFacet] = (counts[entry.discoveryFacet] || 0) + 1;
  return counts;
}, {});

test('v2 is a targeted human-guided research batch rather than a repeated v1 distribution', () => {
  assert.equal(manifest.status, 'research_only_not_training_approved');
  assert.equal(manifest.datasetSubdir, 'web-research-v2');
  assert.equal(manifest.entries.length, 40);
  assert.equal(manifest.selectionPlan.requestedCandidateCount, manifest.entries.length);
  assert.deepEqual(countsByFacet, manifest.selectionPlan.discoveryTargets);
  assert.equal(countsByFacet.none_negative, 12);
  assert.equal(countsByFacet.adult_art_nude_gap, 11);
  assert.equal(countsByFacet.male_topless_low_priority, 1);
  assert.match(manifest.selectionPlan.reasoning, /zero examples in bare_buttocks, female_bare_breasts and genitalia/);
});

test('v2 keeps discovery metadata non-authoritative and research rights pragmatic', () => {
  assert.equal(manifest.rules.discoveryFacetIsLabelAuthority, false);
  assert.equal(manifest.rules.rightsStatusIsResearchEligibilityGate, false);
  assert.equal(manifest.rules.allRightsReservedMayBeUsedForLocalResearch, true);
  assert.equal(manifest.rules.realPhotographyTarget, true);
  assert.equal(manifest.rules.excludeKnownAiRenderGameIllustration, true);
  assert.equal(manifest.rules.preferRecentRepresentativePhotography, true);
  assert.equal(manifest.rules.olderPhotographyAllowedForCoverageGapFill, true);
  assert.equal(manifest.rules.trainingReady, false);
  assert.equal(manifest.rules.productionEligible, false);
});

test('v2 candidates are public exact Flickr photo pages with diverse source pools', () => {
  const urls = manifest.entries.map((entry) => entry.sourceUrl);
  assert.equal(new Set(urls).size, urls.length);
  for (const entry of manifest.entries) {
    assert.match(entry.sourceUrl, /^https:\/\/(?:www\.)?flickr\.com\/photos\/[^/]+\/\d+\/$/);
    assert.ok(entry.sourcePoolId);
    assert.match(entry.rightsStatus, /research_only$/);
  }
  assert.ok(new Set(manifest.entries.map((entry) => entry.sourcePoolId)).size >= 28);
});

test('shared local research flow can select v2 without weakening v1 defaults', () => {
  assert.match(fetchSource, /ARTES_WEB_RESEARCH_MANIFEST/);
  assert.match(fetchSource, /ARTES_WEB_RESEARCH_DATASET_SUBDIR/);
  assert.match(fetchSource, /moderation-web-research-batch-v1\.json/);
  assert.match(fetchSource, /web-research-v1/);
  assert.match(fetchSource, /web_research_manifest_dataset_subdir_mismatch/);
  assert.match(prepareSource, /ARTES_WEB_RESEARCH_DATASET_SUBDIR/);
  assert.match(prepareSource, /web-research-v1/);
  assert.match(genericRunnerSource, /ARTES_WEB_RESEARCH_MANIFEST/);
  assert.match(genericRunnerSource, /ARTES_WEB_RESEARCH_DATASET_SUBDIR/);
  assert.match(v2RunnerSource, /moderation-web-research-batch-v2\.json/);
  assert.match(v2RunnerSource, /web-research-v2/);
});

test('v2 remains local research only and cannot promote itself', () => {
  assert.equal(manifest.rules.publicPagesOnly, true);
  assert.equal(manifest.rules.loginBypassAllowed, false);
  assert.equal(manifest.rules.localOnly, true);
  assert.equal(manifest.rules.commitImageBytes, false);
  assert.doesNotMatch(v2RunnerSource, /firebase|gcloud|artes-media-app|artes-staging/);
  assert.doesNotMatch(fetchSource, /trainingReady: true|productionEligible: true/);
  assert.doesNotMatch(prepareSource, /trainingReady: true|productionEligible: true/);
});
