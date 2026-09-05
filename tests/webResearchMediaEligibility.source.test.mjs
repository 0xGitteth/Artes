import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reviewSource = readFileSync(new URL('../scripts/serveWebResearchModerationLabelReview.js', import.meta.url), 'utf8');
const validateSource = readFileSync(new URL('../scripts/validateReviewedWebResearchModeration.js', import.meta.url), 'utf8');
const overrides = JSON.parse(readFileSync(new URL('../docs/moderation-web-research-assistant-prefill-overrides-v1.json', import.meta.url), 'utf8'));

test('non-photographic assistant override is non-authoritative and carries no detector label', () => {
  assert.equal(overrides.authoritative, false);
  assert.equal(overrides.humanConfirmationRequired, true);
  const nonPhoto = overrides.items.find((item) => item.researchEligibilityDecision === 'exclude_non_photographic_or_synthetic');
  assert.ok(nonPhoto);
  assert.equal(nonPhoto.ageSafetyDecision, null);
  assert.equal(nonPhoto.detectorLabel, null);
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

test('age safety is required by adult or sexual content, not by possible age alone', () => {
  assert.match(reviewSource, /not_required_nonadult_nonsexual/);
  assert.match(reviewSource, /AGE_SAFETY_RELEVANT_NUDITY/);
  assert.match(reviewSource, /detectorLabelRequiresAgeSafety/);
  assert.match(reviewSource, /web_research_age_safety_required_for_adult_or_sexual_content/);
  assert.match(reviewSource, /ageSafetyAppliedOnlyWhenAdultOrSexualContent: true/);
  assert.match(validateSource, /not_required_nonadult_nonsexual/);
  assert.match(validateSource, /web_research_age_safety_required_for_adult_or_sexual_content/);
  assert.match(validateSource, /ageSafetyAppliedOnlyWhenAdultOrSexualContent: true/);

  const nonsexualMaleTopless = overrides.items.filter((item) => item.ageSafetyDecision === 'not_required_nonadult_nonsexual');
  assert.ok(nonsexualMaleTopless.length >= 4);
  for (const item of nonsexualMaleTopless) {
    assert.equal(item.researchEligibilityDecision, 'include_real_photograph');
    assert.equal(item.detectorLabel.nudity, 'male_topless');
    assert.equal(item.detectorLabel.sexualContext, 'none');
    assert.equal(item.detectorLabel.possibleMinorConcern, false);
  }
});

test('validator excludes non-photographic items from the offline detector dataset', () => {
  assert.match(validateSource, /exclude_non_photographic_or_synthetic/);
  assert.match(validateSource, /excluded_non_photographic/);
  assert.match(validateSource, /non_photographic_or_synthetic/);
  assert.match(validateSource, /nonPhotographicExcludedCount/);
  assert.match(validateSource, /realPhotographyResearchOnly: true/);
  assert.match(validateSource, /researchEligibilityDecision: 'include_real_photograph'/);
});
