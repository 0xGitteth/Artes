import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModerationApiBase } from '../src/utils/moderationApiBase.js';

test('explicit moderation API base wins and trailing slashes are normalized', () => {
  assert.equal(resolveModerationApiBase({
    VITE_MODERATION_API_BASE: 'https://moderation.example.test///',
    VITE_FUNCTIONS_BASE_URL: 'https://functions.example.test',
  }), 'https://moderation.example.test');
});

test('moderateImage function URL resolves to its shared function base', () => {
  assert.equal(resolveModerationApiBase({
    VITE_MODERATION_FUNCTION_URL: 'https://region-project.cloudfunctions.net/moderateImage',
  }), 'https://region-project.cloudfunctions.net');
});

test('shared functions base URL is a supported publication fallback', () => {
  assert.equal(resolveModerationApiBase({
    VITE_FUNCTIONS_BASE_URL: 'https://functions.example.test/',
  }), 'https://functions.example.test');
});

test('legacy shared functions base is also supported', () => {
  assert.equal(resolveModerationApiBase({
    VITE_FUNCTIONS_BASE: 'https://legacy-functions.example.test/',
  }), 'https://legacy-functions.example.test');
});

test('missing configuration resolves to empty base', () => {
  assert.equal(resolveModerationApiBase({}), '');
});
