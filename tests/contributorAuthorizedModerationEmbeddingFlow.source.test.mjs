import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const embedSource = readFileSync(new URL('../scripts/prepareContributorAuthorizedModerationEmbeddings.js', import.meta.url), 'utf8');
const runnerSource = readFileSync(new URL('../vision-service/run_contributor_authorized_moderation_poc.sh', import.meta.url), 'utf8');

test('contributor embedding preparation preserves authorization, source pool and hashes', () => {
  assert.match(embedSource, /contributor_authorized_moderation_images/);
  assert.match(embedSource, /authorizationConfirmed/);
  assert.match(embedSource, /sourcePoolId/);
  assert.match(embedSource, /rightsHolderConfirmed/);
  assert.match(embedSource, /moderationMlUseAuthorized/);
  assert.match(embedSource, /contributor_image_sha_mismatch/);
});

test('contributor embedding preparation requires the real client envelope and DINOv2 768D output', () => {
  assert.match(embedSource, /EXPECTED_PROVIDER = 'artes_custom_vision'/);
  assert.match(embedSource, /EXPECTED_MODEL = 'dinov2_vitb14'/);
  assert.match(embedSource, /EXPECTED_DIMENSION = 768/);
  assert.match(embedSource, /const vector = inference\?\.embedding/);
  assert.match(embedSource, /inference\?\.provider !== EXPECTED_PROVIDER/);
  assert.match(embedSource, /inference\?\.model !== EXPECTED_MODEL/);
  assert.match(embedSource, /inference\?\.embeddingDimension !== EXPECTED_DIMENSION/);
});

test('contributor embedding endpoint is fail-closed to loopback only', () => {
  assert.match(embedSource, /LOOPBACK_HOSTS/);
  assert.match(embedSource, /127\.0\.0\.1/);
  assert.match(embedSource, /localhost/);
  assert.match(embedSource, /contributor_embedding_endpoint_must_be_loopback/);
  assert.match(embedSource, /networkScope: 'loopback_custom_vision_only'/);
});

test('contributor embeddings infer no labels and cannot promote training readiness', () => {
  assert.match(embedSource, /detectorLabel: null/);
  assert.match(embedSource, /labelStatus: 'pending_human_review'/);
  assert.match(embedSource, /semanticClusterApproved: false/);
  assert.match(embedSource, /trainingReady: false/);
  assert.doesNotMatch(embedSource, /trainingReady: true/);
});

test('contributor embedding script prints summaries only and never image bytes or vectors', () => {
  assert.match(embedSource, /fullEmbeddingsPrinted: false/);
  assert.match(embedSource, /imageBytesPrinted: false/);
  assert.doesNotMatch(embedSource, /JSON\.stringify\(outputItems\)/);
});

test('contributor runner is loopback-only, bounded and preserves local-only scope', () => {
  assert.match(runnerSource, /ENDPOINT="http:\/\/127\.0\.0\.1:8787"/);
  assert.match(runnerSource, /--host 127\.0\.0\.1/);
  assert.match(runnerSource, /STARTUP_WAIT_SECONDS/);
  assert.match(runnerSource, /POC_TIMEOUT_MS/);
  assert.match(runnerSource, /trap cleanup EXIT INT TERM/);
  assert.match(runnerSource, /prepareContributorAuthorizedModerationIntake\.js --confirm-authorized/);
  assert.match(runnerSource, /prepareContributorAuthorizedModerationEmbeddings\.js --confirm-authorized/);
  assert.doesNotMatch(runnerSource, /firebase deploy|gcloud|artes-media-app|artes-staging/);
});
