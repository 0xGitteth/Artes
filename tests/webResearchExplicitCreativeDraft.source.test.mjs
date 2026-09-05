import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../docs/moderation-web-research-explicit-creative-draft-v1.json', import.meta.url), 'utf8'));
const fetcher = await readFile(new URL('../scripts/fetchCreativeExplicitWebResearchImages.js', import.meta.url), 'utf8');
const runner = await readFile(new URL('../vision-service/run_web_research_moderation_explicit_creative_draft_v1.sh', import.meta.url), 'utf8');

const sourcePools = new Set(manifest.entries.map((entry) => entry.sourcePoolId));
const sourceTypes = new Set(manifest.entries.map((entry) => entry.sourceType));

test('creative explicit draft proves mixed non-Commons sourcing at useful diversity', () => {
  assert.equal(manifest.status, 'research_only_fetch_prototype_not_final_batch');
  assert.ok(manifest.entries.length >= 18);
  assert.ok(sourcePools.size >= 10);
  assert.ok(sourceTypes.has('direct_public_portfolio_asset'));
  assert.ok(sourceTypes.has('flickr_public_photo_page'));
  assert.ok(manifest.entries.every((entry) => entry.sourceType !== 'wikimedia_commons'));
});

test('creative explicit draft stays research-only and discovery facets are non-authoritative', () => {
  assert.equal(manifest.rules.publicPagesOnly, true);
  assert.equal(manifest.rules.noLoginOrPaywallBypass, true);
  assert.equal(manifest.rules.humanLabelRequired, true);
  assert.equal(manifest.rules.discoveryFacetIsLabelAuthority, false);
  assert.equal(manifest.rules.preferRecentRepresentativePhotography, true);
  assert.equal(manifest.rules.preferMultiplePhotographersAndSourcePools, true);
  assert.equal(manifest.rules.trainingReady, false);
  assert.equal(manifest.rules.productionEligible, false);
});

test('portfolio fetcher is host-bounded and does not use auth or cookies', () => {
  assert.match(fetcher, /images\.squarespace-cdn\.com/);
  assert.match(fetcher, /folsomstreeteast\.com/);
  assert.match(fetcher, /staticflickr\\\.com/);
  assert.match(fetcher, /MAX_IMAGE_BYTES = 15 \* 1024 \* 1024/);
  assert.match(fetcher, /humanAgeSafetyReviewRequired: true/);
  assert.match(fetcher, /trainingReady: false/);
  assert.match(fetcher, /productionEligible: false/);
  assert.doesNotMatch(fetcher, /Authorization|Cookie|Bearer/i);
});

test('source age evidence is provenance only and is preserved for human review', () => {
  assert.ok(manifest.entries.some((entry) => entry.ageEvidence));
  assert.match(fetcher, /ageEvidence: clean\(entry\.ageEvidence\) \|\| null/);
  assert.match(fetcher, /ageStatus: 'unverified_research_only'/);
  assert.match(fetcher, /humanAgeSafetyReviewRequired: true/);
});

test('creative explicit runner reuses the isolated local embedding flow', () => {
  assert.match(runner, /web-research-explicit-creative-draft-v1/);
  assert.match(runner, /fetchCreativeExplicitWebResearchImages\.js/);
  assert.match(runner, /run_web_research_moderation_poc_v1\.sh/);
});
