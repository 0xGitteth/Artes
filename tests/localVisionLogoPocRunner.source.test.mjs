import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../vision-service/run_local_logo_poc.sh', import.meta.url), 'utf8');

test('local logo POC runner avoids nounset/RVM conflict', () => {
  assert.doesNotMatch(source, /set\s+-[^\n]*u/);
  assert.match(source, /set -eo pipefail/);
});

test('local logo POC runner is loopback-only and cleans up the service', () => {
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /trap cleanup EXIT INT TERM/);
  assert.match(source, /kill \"\$VISION_PID\"/);
  assert.match(source, /\/health/);
});

test('local logo POC runner keeps model cache local and defaults to repo-owned logo', () => {
  assert.match(source, /\.model-cache\/huggingface/);
  assert.match(source, /public\/brand\/logo\.png/);
  assert.match(source, /testLocalModerationVisionPoc\.js/);
});
