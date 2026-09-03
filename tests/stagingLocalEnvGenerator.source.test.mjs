import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/configureStagingLocalEnv.js', import.meta.url), 'utf8');

test('staging env generator is pinned to artes-staging', () => {
  assert.match(source, /const STAGING_PROJECT_ID = 'artes-staging'/);
  assert.doesNotMatch(source, /artes-media-app/);
  assert.match(source, /config\?\.projectId !== STAGING_PROJECT_ID/);
});

test('staging env generator writes only a gitignored local env file', () => {
  assert.match(source, /\.env\.staging\.local/);
  assert.match(source, /git', \['check-ignore'/);
  assert.doesNotMatch(source, /\.env\.staging(?!\.local)/);
});

test('staging env generator keeps providers and functions disabled initially', () => {
  assert.match(source, /VITE_ENABLE_EMAIL_SIGNIN: 'false'/);
  assert.match(source, /VITE_ENABLE_GOOGLE_SIGNIN: 'false'/);
  assert.match(source, /VITE_ENABLE_APPLE_SIGNIN: 'false'/);
  assert.match(source, /VITE_FUNCTIONS_BASE_URL: ''/);
  assert.match(source, /VITE_MODERATION_FUNCTION_URL: ''/);
});

test('staging env generator does not print raw Firebase API key', () => {
  assert.match(source, /rawApiKeyPrinted: false/);
  assert.doesNotMatch(source, /process\.stdout\.write\([^)]*apiKey/);
});
