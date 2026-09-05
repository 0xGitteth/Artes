import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reviewSource = readFileSync(new URL('../scripts/serveWebResearchModerationLabelReview.js', import.meta.url), 'utf8');
const validateSource = readFileSync(new URL('../scripts/validateReviewedWebResearchModeration.js', import.meta.url), 'utf8');
const assistantPrefill = JSON.parse(readFileSync(new URL('../docs/moderation-web-research-assistant-prefill-v1.json', import.meta.url), 'utf8'));

test('web research review stays local and reviews the whole prepared batch', () => {
  assert.match(reviewSource, /HOST = '127\.0\.0\.1'/);
  assert.match(reviewSource, /DATASET_SUBDIR = 'web-research-v1'/);
  assert.match(reviewSource, /moderation-test-images/);
  assert.match(reviewSource, /moderation-test-set/);
  assert.match(reviewSource, /labels\.reviewed\.json/);
  assert.doesNotMatch(reviewSource, /firebase|gcloud|artes-media-app|artes-staging/);
});

test('age safety is explicit and uncertain or possible minors are excluded rather than labeled', () => {
  assert.match(reviewSource, /adult_clear/);
  assert.match(reviewSource, /skip_minor_or_age_uncertain/);
  assert.match(reviewSource, /excluded_age_safety/);
  assert.match(reviewSource, /web_research_possible_minor_must_be_skipped/);
  assert.match(reviewSource, /detectorLabel = null/);
  assert.match(reviewSource, /humanAgeSafetyReviewRequired: true/);
});

test('assistant visual prefill is separate from authoritative human review', () => {
  assert.equal(assistantPrefill.suggestionSource, 'assistant_visual_review');
  assert.equal(assistantPrefill.authoritative, false);
  assert.equal(assistantPrefill.humanConfirmationRequired, true);
  assert.equal(assistantPrefill.discoveryMetadataUsedAsLabelAuthority, false);
  assert.match(reviewSource, /PREFILL_PATH/);
  assert.match(reviewSource, /assistantSuggestion/);
  assert.match(reviewSource, /Vooringevuld door assistent/);
  assert.match(reviewSource, /labelSource: 'local_human_review'/);
  assert.match(reviewSource, /humanLabelsAuthoritative: true/);
  assert.match(reviewSource, /assistantSuggestionAcceptedAsIs/);
});

test('discovery metadata remains provenance only and is hidden from the labeling interface', () => {
  assert.doesNotMatch(reviewSource, /<strong>Discovery facet:<\/strong>/);
  assert.match(reviewSource, /discoveryFacet: state\.source\.visualFacet \|\| null/);
  assert.match(reviewSource, /discoveryMetadataIsLabelAuthority: false/);
  assert.doesNotMatch(reviewSource, /suggestionsByFacet/);
});

test('human review progress cannot be completed merely by assistant prefills', () => {
  assert.match(reviewSource, /isHumanReviewed/);
  assert.match(reviewSource, /items\.filter\(isHumanReviewed\)\.length/);
  assert.match(reviewSource, /reviewStatus = items\.length === states\.length \? 'complete' : 'partial'/);
  assert.match(reviewSource, /assistantPrefillCount/);
});

test('review output cannot become training, production or runtime authority', () => {
  assert.match(reviewSource, /semanticClusterApproved: false/);
  assert.match(reviewSource, /researchOnly: true/);
  assert.match(reviewSource, /trainingReady: false/);
  assert.match(reviewSource, /productionEligible: false/);
  assert.match(reviewSource, /runtimeEligible: false/);
  assert.doesNotMatch(reviewSource, /trainingReady: true/);
  assert.doesNotMatch(reviewSource, /productionEligible: true/);
  assert.doesNotMatch(reviewSource, /runtimeEligible: true/);
});

test('review validator builds a separate offline research dataset with DINO contract preserved', () => {
  assert.match(validateSource, /datasetRole: 'offline_research_probe_only'/);
  assert.match(validateSource, /performanceInterpretation: 'research_only_not_production_ready'/);
  assert.match(validateSource, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(validateSource, /EXPECTED_DIMENSION = 768/);
  assert.match(validateSource, /humanLabelsAuthoritative: true/);
  assert.match(validateSource, /discoveryMetadataIsLabelAuthority: false/);
  assert.match(validateSource, /dinoSimilarityIsLabelAuthority: false/);
  assert.match(validateSource, /thresholdSelected: false/);
  assert.match(validateSource, /semanticClustersApproved: false/);
  assert.match(validateSource, /benchmarkDataset: false/);
  assert.match(validateSource, /research-dataset\.json/);
});

test('validated research dataset remains permanently non-promoted by this step', () => {
  assert.match(validateSource, /researchOnly: true/);
  assert.match(validateSource, /trainingReady: false/);
  assert.match(validateSource, /productionEligible: false/);
  assert.match(validateSource, /runtimeEligible: false/);
  assert.doesNotMatch(validateSource, /trainingReady: true/);
  assert.doesNotMatch(validateSource, /productionEligible: true/);
  assert.doesNotMatch(validateSource, /runtimeEligible: true/);
  assert.doesNotMatch(validateSource, /combined_external_seed_v2|combined-external-v2/);
});
