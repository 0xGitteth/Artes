import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/run_external_male_topless_poc_v1.sh', import.meta.url), 'utf8');

test('male-topless runner uses its own bounded manifest and local directories', () => {
  assert.match(source, /moderation-external-male-topless-poc-v1\.json/);
  assert.match(source, /external-male-topless-v1/);
  assert.match(source, /fetchExternalModerationPocImages\.js/);
  assert.match(source, /prepareAuthorizedModerationTestSet\.js --confirm-authorized/);
});

test('male-topless runner stays loopback-only and bounded', () => {
  assert.match(source, /ENDPOINT="http:\/\/127\.0\.0\.1:8787"/);
  assert.match(source, /--host 127\.0\.0\.1/);
  assert.match(source, /STARTUP_WAIT_SECONDS/);
  assert.match(source, /POC_TIMEOUT_MS/);
  assert.match(source, /trap cleanup EXIT INT TERM/);
  assert.doesNotMatch(source, /firebase deploy|gcloud|artes-media-app|artes-staging/);
});

test('male-topless runner supports resume and does not modify existing seed paths', () => {
  assert.match(source, /ARTES_EXTERNAL_POC_SKIP_FETCH/);
  assert.match(source, /Reusing already fetched male-topless POC images/);
  assert.match(source, /Existing seed and expansion directories were not modified/);
  assert.doesNotMatch(source, /OUTPUT_SUBDIR="external-poc"/);
  assert.doesNotMatch(source, /OUTPUT_SUBDIR="external-expansion-v1"/);
});
