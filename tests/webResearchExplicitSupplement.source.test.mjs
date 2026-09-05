import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../docs/moderation-web-research-explicit-v1.json', import.meta.url), 'utf8'));
const fetcher = await readFile(new URL('../scripts/fetchExplicitWebResearchModerationImages.js', import.meta.url), 'utf8');
const sharedRunner = await readFile(new URL('../vision-service/run_web_research_moderation_poc_v1.sh', import.meta.url), 'utf8');
const explicitRunner = await readFile(new URL('../vision-service/run_web_research_moderation_explicit_v1.sh', import.meta.url), 'utf8');

const counts = manifest.entries.reduce((acc, entry) => {
  acc[entry.discoveryFacet] = (acc[entry.discoveryFacet] || 0) + 1;
  return acc;
}, {});

test('explicit supplement targets strong content rather than another mild boundary batch', () => {
  assert.equal(manifest.selectionPlan.requestedCandidateCount, manifest.entries.length);
  assert.ok(manifest.entries.length >= 20);
  assert.ok((counts.female_bare_breasts_candidate || 0) >= 4);
  assert.ok((counts.bare_buttocks_candidate || 0) >= 3);
  assert.ok((counts.genitalia_candidate || 0) >= 5);
  assert.ok((counts.bdsm_kink_candidate || 0) >= 5);
  assert.ok((counts.explicit_act_candidate || 0) >= 6);
});

test('explicit supplement uses unique real-photography candidates and diverse source pools', () => {
  const urls = manifest.entries.map((entry) => entry.sourceUrl);
  const titles = manifest.entries.map((entry) => entry.commonsFileTitle);
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(new Set(titles).size, titles.length);
  assert.ok(new Set(manifest.entries.map((entry) => entry.sourcePoolId)).size >= 12);
  for (const entry of manifest.entries) {
    assert.equal(entry.sourceType, 'wikimedia_commons');
    assert.match(entry.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.match(entry.commonsFileTitle, /^File:/);
    assert.ok(entry.ageEvidence);
  }
});

test('explicit discovery facets remain non-authoritative and age review stays human', () => {
  assert.equal(manifest.rules.discoveryFacetIsLabelAuthority, false);
  assert.equal(manifest.rules.humanLabelRequired, true);
  assert.equal(manifest.rules.adultOrSexualContentRequiresHumanAgeSafetyReview, true);
  assert.equal(manifest.rules.sourceAgeEvidenceMayGuideButNeverReplaceHumanReview, true);
  assert.equal(manifest.rules.trainingReady, false);
  assert.equal(manifest.rules.productionEligible, false);
});

test('Commons explicit fetcher is bounded, public and local-only', () => {
  assert.match(fetcher, /commons\.wikimedia\.org\/w\/api\.php/);
  assert.match(fetcher, /upload\.wikimedia\.org/);
  assert.match(fetcher, /THUMB_WIDTH = 2048/);
  assert.match(fetcher, /MAX_IMAGE_BYTES = 15 \* 1024 \* 1024/);
  assert.match(fetcher, /researchOnly: true/);
  assert.match(fetcher, /trainingReady: false/);
  assert.match(fetcher, /productionEligible: false/);
  assert.doesNotMatch(fetcher, /authorization|cookie|login/i);
});

test('explicit runner remains isolated from v2 and reuses the local embedding pipeline', () => {
  assert.match(explicitRunner, /web-research-explicit-v1/);
  assert.match(explicitRunner, /moderation-web-research-explicit-v1\.json/);
  assert.match(explicitRunner, /fetchExplicitWebResearchModerationImages\.js/);
  assert.match(explicitRunner, /run_web_research_moderation_poc_v1\.sh/);
  assert.match(sharedRunner, /ARTES_WEB_RESEARCH_FETCH_SCRIPT/);
  assert.match(sharedRunner, /node "\$FETCH_SCRIPT_RELATIVE"/);
});
