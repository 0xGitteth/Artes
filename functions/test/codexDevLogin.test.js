import assert from 'node:assert/strict';
import test from 'node:test';
import { canIssueCodexDevToken } from '../codexDevLogin.js';

test('createDevCodexToken production gate blocks token issuance in production', () => {
  assert.equal(canIssueCodexDevToken({ NODE_ENV: 'production' }), false);
});

test('createDevCodexToken production gate allows local or explicit non-production environments', () => {
  assert.equal(canIssueCodexDevToken({}), true);
  assert.equal(canIssueCodexDevToken({ NODE_ENV: 'development' }), true);
  assert.equal(canIssueCodexDevToken({ NODE_ENV: 'staging' }), true);
});
