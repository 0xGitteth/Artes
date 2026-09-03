import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/run_external_moderation_poc_set.sh', import.meta.url), 'utf8');

test('external POC runner fetches only through guarded fetcher and uses isolated local directories', () => {
  assert.match(source, /fetchExternalModerationPocImages\.js/);
  assert.match(source, /moderation-test-images\/external-poc/);
  assert.match(source, /moderation-test-set\/external-poc/);
  assert.match(source, /prepareAuthorizedModerationTestSet\.js --confirm-authorized/);
});

test('external POC runner remains loopback-only and cleans up vision service', () => {
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /trap cleanup EXIT INT TERM/);
  assert.match(source, /kill \"\$VISION_PID\"/);
  assert.doesNotMatch(source, /firebase deploy|gcloud|artes-media-app|artes-staging/);
});
