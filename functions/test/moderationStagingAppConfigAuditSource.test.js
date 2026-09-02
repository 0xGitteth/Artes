import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/auditModerationStagingAppConfig.js', import.meta.url), 'utf8');

test('staging app config audit is pinned to Artes staging', () => {
  assert.match(source, /const STAGING_PROJECT_ID = 'artes-staging'/);
  assert.doesNotMatch(source, /artes-media-app/);
  assert.doesNotMatch(source, /process\.argv/);
});

test('staging app config audit performs GET requests only', () => {
  assert.match(source, /method: 'GET'/);
  assert.doesNotMatch(source, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /writes: false/);
});

test('staging app config audit never prints raw Firebase api keys or provider secrets', () => {
  assert.match(source, /hasApiKey:/);
  assert.doesNotMatch(source, /clientSecret/);
  assert.match(source, /secretsPrinted: false/);
});
