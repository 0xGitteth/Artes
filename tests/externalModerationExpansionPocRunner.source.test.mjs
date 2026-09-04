import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/run_external_moderation_expansion_poc_v1.sh', import.meta.url), 'utf8');

test('expansion runner uses its own bounded manifest and local directories', () => {
  assert.match(source, /MANIFEST_NAME="moderation-external-expansion-poc-v1\.json"/);
  assert.match(source, /OUTPUT_SUBDIR="external-expansion-v1"/);
  assert.match(source, /ARTES_EXTERNAL_POC_MANIFEST="\$MANIFEST_NAME"/);
  assert.match(source, /ARTES_EXTERNAL_POC_OUTPUT_SUBDIR="\$OUTPUT_SUBDIR"/);
  assert.match(source, /\.tmp\/moderation-test-images\/\$OUTPUT_SUBDIR/);
  assert.match(source, /\.tmp\/moderation-test-set\/\$OUTPUT_SUBDIR/);
  assert.match(source, /prepareAuthorizedModerationTestSet\.js --confirm-authorized/);
});

test('expansion runner remains loopback-only and cleans up DINO service', () => {
  assert.match(source, /ENDPOINT="http:\/\/127\.0\.0\.1:8787"/);
  assert.match(source, /--host 127\.0\.0\.1/);
  assert.match(source, /trap cleanup EXIT INT TERM/);
  assert.match(source, /kill "\$VISION_PID"/);
  assert.doesNotMatch(source, /artes-media-app|artes-staging|firebase deploy|gcloud/);
});

test('expansion runner supports resumable local processing without re-fetching image bytes', () => {
  assert.match(source, /ARTES_EXTERNAL_POC_SKIP_FETCH/);
  assert.match(source, /SKIP_FETCH="\$\{ARTES_EXTERNAL_POC_SKIP_FETCH:-0\}"/);
  assert.match(source, /sources\.json/);
  assert.match(source, /Reusing already fetched external expansion images/);
});

test('expansion runner allows bounded slow startup and first-model warmup', () => {
  assert.match(source, /ARTES_VISION_STARTUP_WAIT_SECONDS:-120/);
  assert.match(source, /ARTES_CUSTOM_VISION_TIMEOUT_MS:-300000/);
  assert.match(source, /STARTUP_WAIT_SECONDS.*600/);
  assert.match(source, /seq 1 "\$STARTUP_WAIT_SECONDS"/);
});

test('expansion runner does not promote or overwrite original seed outputs', () => {
  assert.match(source, /Original external-poc seed directories were not modified/);
  assert.doesNotMatch(source, /trainingReady=true|trainingReady: true/);
  assert.doesNotMatch(source, /moderation-test-set\/external-poc/);
});
