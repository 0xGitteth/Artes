import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDiditAdultDecision } from '../didit.js';

test('Didit approved with age 17 does not set isAdult true', () => {
  const result = resolveDiditAdultDecision('approved', 17);

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.age, 17);
  assert.equal(result.isAdult, null);
  assert.equal(result.assumeAdultOnVerified, false);
});

test('Didit approved with age 18 sets isAdult true', () => {
  const result = resolveDiditAdultDecision('approved', 18);

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.age, 18);
  assert.equal(result.isAdult, true);
  assert.equal(result.assumeAdultOnVerified, false);
});
