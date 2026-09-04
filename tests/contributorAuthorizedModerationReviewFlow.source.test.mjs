import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reviewSource = readFileSync(new URL('../scripts/serveContributorAuthorizedModerationLabelReview.js', import.meta.url), 'utf8');
const validationSource = readFileSync(new URL('../scripts/validateReviewedContributorAuthorizedModeration.js', import.meta.url), 'utf8');

test('contributor review is loopback-only and reads local contributor artifacts', () => {
  assert.match(reviewSource, /const HOST = '127\.0\.0\.1'/);
  assert.match(reviewSource, /moderation-contributor-images/);
  assert.match(reviewSource, /moderation-contributor-intake/);
  assert.match(reviewSource, /embedding-intake\.json/);
  assert.doesNotMatch(reviewSource, /https:\/\//);
});

test('contributor review makes no content suggestion and requires explicit human detector labels', () => {
  assert.match(reviewSource, /Er is bewust geen inhoudelijke voorselectie/);
  assert.match(reviewSource, /validateArtesDetectorLabel/);
  assert.match(reviewSource, /labelStatus: 'human_confirmed'/);
  assert.match(reviewSource, /labelSource: 'local_human_review'/);
  assert.doesNotMatch(reviewSource, /suggestionsByFacet|metadataSuggestion/);
});

test('contributor review preserves authorization and source pool without promotion', () => {
  assert.match(reviewSource, /sourcePoolId: state\.sourcePoolId/);
  assert.match(reviewSource, /authorization: state\.authorization/);
  assert.match(reviewSource, /semanticClusterApproved: false/);
  assert.match(reviewSource, /trainingReady: false/);
  assert.doesNotMatch(reviewSource, /trainingReady: true/);
});

test('review validator binds human labels to hashes, source pools, authorization and DINO embeddings', () => {
  for (const token of [
    'contributor_label_sha_mismatch',
    'contributor_source_pool_mismatch',
    'contributor_authorization_missing',
    'contributor_label_not_human_confirmed',
    "EXPECTED_PROVIDER = 'artes_custom_vision'",
    "EXPECTED_MODEL = 'dinov2_vitb14'",
    'EXPECTED_DIMENSION = 768',
    'validateArtesDetectorLabel',
  ]) {
    assert.match(validationSource, new RegExp(token));
  }
});

test('review validation remains an unpromoted curated candidate and prints summaries only', () => {
  assert.match(validationSource, /semanticClusterApproved: false/);
  assert.match(validationSource, /trainingReady: false/);
  assert.match(validationSource, /explicit_semantic_cluster_review_and_dataset_promotion/);
  assert.match(validationSource, /fullEmbeddingsPrinted: false/);
  assert.match(validationSource, /imageBytesPrinted: false/);
  assert.doesNotMatch(validationSource, /trainingReady: true/);
  assert.doesNotMatch(validationSource, /JSON\.stringify\(outputItems\)/);
});
