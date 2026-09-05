import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../docs/moderation-hard-gap-targeted-sources-v1.json', import.meta.url), 'utf8'));
const script = await readFile(new URL('../scripts/discoverTargetedHardGapFlickrCandidates.js', import.meta.url), 'utf8');

test('hard-gap discovery starts from curated adult photography sources instead of broad tags', () => {
  assert.equal(config.status, 'research_targeted_source_discovery_only');
  assert.ok(config.sources.length >= 8);
  assert.ok(config.sources.filter((source) => source.sourceType === 'flickr_album').length >= 6);
  assert.ok(config.sources.some((source) => source.sourceType === 'flickr_exact_photos'));
  assert.doesNotMatch(script, /\/photos\/tags\//);
  assert.match(script, /ALBUM_PATH/);
  assert.match(script, /EXACT_PHOTO_PATH/);
});

test('hard-gap targets remain focused on classes missing after visual screening', () => {
  assert.ok(config.currentVisualGapBaseline.explicit_act <= 2);
  assert.ok(config.currentVisualGapBaseline.genitalia_full_frontal <= 1);
  assert.ok(config.desiredAdditionalVisualCandidates.explicit_act >= 20);
  assert.ok(config.desiredAdditionalVisualCandidates.genitalia_full_frontal >= 20);
  assert.ok(config.desiredAdditionalVisualCandidates.bare_buttocks >= 15);
  assert.ok(config.desiredAdditionalVisualCandidates.female_bare_breasts >= 15);
  const hints = new Set(config.sources.flatMap((source) => source.targetHints || []));
  for (const expected of ['explicit_act', 'genitalia_full_frontal', 'bare_buttocks', 'female_bare_breasts']) {
    assert.ok(hints.has(expected), `missing targeted hard-gap hint ${expected}`);
  }
});

test('source caps limit style dominance while preserving research scale', () => {
  assert.ok(config.sourceCandidateCapDefault <= 24);
  for (const source of config.sources) {
    assert.ok(Number(source.maxCandidates || config.sourceCandidateCapDefault) <= 24, `${source.sourceId} exceeds source cap`);
    assert.ok(source.sourcePoolId, `${source.sourceId} must preserve sourcePoolId`);
  }
});

test('targeted discovery remains public metadata-only research', () => {
  assert.equal(config.rules.publicPagesOnly, true);
  assert.equal(config.rules.noLoginOrPaywallBypass, true);
  assert.equal(config.rules.noAuthOrCookies, true);
  assert.equal(config.rules.metadataDiscoveryOnly, true);
  assert.equal(config.rules.downloadImageBytes, false);
  assert.equal(config.rules.sourceIntentIsLabelAuthority, false);
  assert.equal(config.rules.researchOnly, true);
  assert.equal(config.rules.trainingReady, false);
  assert.equal(config.rules.productionEligible, false);
  assert.match(script, /imageBytesDownloaded: false/);
  assert.doesNotMatch(script, /Authorization|Bearer/);
  assert.doesNotMatch(script, /['"]Cookie['"]\s*:/i);
});

test('research rights and age handling match the current pragmatic policy', () => {
  assert.equal(config.rules.allRightsReservedMayBeUsedForLocalResearch, true);
  assert.equal(config.rules.ordinaryCopyrightNoticeIsNotResearchEligibilityGate, true);
  assert.equal(config.rules.explicitNoReuseRestrictionBlocksAutomatedFetch, true);
  assert.equal(config.rules.missingFaceIsNotMinorConcern, true);
  assert.equal(config.rules.cropRearViewOrAnonymousIsNotMinorConcernByItself, true);
  assert.equal(config.rules.concreteMinorConcernStillRequiresSafetyHold, true);
  assert.match(script, /metadataPossibleMinorConcernSignal/);
  assert.match(script, /safetyHold/);
});

test('portfolio leads stay separate until a whitelisted resolver exists', () => {
  assert.ok(Array.isArray(config.portfolioLeadsNotYetAutomated));
  assert.ok(config.portfolioLeadsNotYetAutomated.length >= 2);
  assert.ok(config.portfolioLeadsNotYetAutomated.some((lead) => lead.sourceId.includes('cherry_pie')));
  assert.ok(config.portfolioLeadsNotYetAutomated.some((lead) => lead.sourceId.includes('rachel_schwebach')));
});
