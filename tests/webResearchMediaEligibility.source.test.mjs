import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reviewSource = readFileSync(new URL('../scripts/serveWebResearchModerationLabelReview.js', import.meta.url), 'utf8');
const validateSource = readFileSync(new URL('../scripts/validateReviewedWebResearchModeration.js', import.meta.url), 'utf8');
const overrides = JSON.parse(readFileSync(new URL('../docs/moderation-web-research-assistant-prefill-overrides-v1.json', import.meta.url), 'utf8'));

test('non-photographic assistant override is non-authoritative and carries no detector label', () => {
  assert.equal(overrides.authoritative, false);
  assert.equal(overrides.humanConfirmationRequired, true);
  assert.equal(overrides.items.length, 1);
  assert.equal(overrides.items[0].researchEligibilityDecision, 'exclude_non_photographic_or_synthetic');
  assert.equal(overrides.items[0].ageSafetyDecision, null);
  assert.equal(overrides.items[0].detectorLabel, null);
});

test('reviewer separates media eligibility from age safety and detector labels', () => {
  assert.match(reviewSource, /RESEARCH_ELIGIBILITY_DECISIONS/);
  assert.match(reviewSource, /include_real_photograph/);
  assert.match(reviewSource, /exclude_non_photographic_or_synthetic/);
  assert.match(reviewSource, /excluded_non_photographic/);
  assert.match(reviewSource, /Research image type/);
  assert.match(reviewSource, /realPhotographyResearchOnly: true/);
  assert.match(reviewSource, /researchEligibilityOfReviewed/);
  assert.match(reviewSource, /reviewed\?\.researchEligibilityDecision \|\| 'include_real_photograph'/);
});

test('validator excludes non-photographic items from the offline detector dataset', () => {
  assert.match(validateSource, /exclude_non_photographic_or_synthetic/);
  assert.match(validateSource, /excluded_non_photographic/);
  assert.match(validateSource, /non_photographic_or_synthetic/);
  assert.match(validateSource, /nonPhotographicExcludedCount/);
  assert.match(validateSource, /realPhotographyResearchOnly: true/);
  assert.match(validateSource, /researchEligibilityDecision: 'include_real_photograph'/);
});
