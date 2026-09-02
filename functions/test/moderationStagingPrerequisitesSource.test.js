import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/auditModerationStagingPrerequisites.js', import.meta.url), 'utf8');

test('staging prerequisites audit is pinned to Artes staging and production metadata reference only', () => {
  assert.match(source, /const STAGING_PROJECT_ID = 'artes-staging'/);
  assert.match(source, /const PRODUCTION_REFERENCE_PROJECT_ID = 'artes-media-app'/);
  assert.doesNotMatch(source, /process\.argv/);
});

test('staging prerequisites audit performs metadata reads only', () => {
  assert.match(source, /method: 'GET'/);
  assert.doesNotMatch(source, /method:\s*'(POST|PUT|PATCH|DELETE)'/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /writes: false/);
  assert.match(source, /modelCalls: false/);
  assert.match(source, /mediaRead: false/);
});

test('staging prerequisites audit never enables services or creates cloud resources', () => {
  assert.doesNotMatch(source, /services enable/);
  assert.doesNotMatch(source, /databases create/);
  assert.doesNotMatch(source, /buckets create/);
  assert.doesNotMatch(source, /firebase projects:addfirebase/);
});
