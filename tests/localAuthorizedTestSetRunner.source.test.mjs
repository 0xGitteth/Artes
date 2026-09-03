import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/run_local_authorized_test_set.sh', import.meta.url), 'utf8');

test('authorized test-set runner is loopback-only and cleans up', () => {
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /trap cleanup EXIT INT TERM/);
  assert.match(source, /kill \"\$VISION_PID\"/);
  assert.doesNotMatch(source, /set\s+-[^\n]*u/);
});

test('authorized test-set runner uses only gitignored local input/output flow', () => {
  assert.match(source, /\.tmp\/moderation-test-images/);
  assert.match(source, /prepareAuthorizedModerationTestSet\.js --confirm-authorized/);
  assert.match(source, /\.model-cache\/huggingface/);
  assert.doesNotMatch(source, /firebase|gcloud|deploy|storage\.googleapis/i);
});
