import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDiditPersistenceDecision } from '../didit.js';

test('Didit approved with age 17 persists underage, not approved', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 17 });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'underage');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.adultDecision.age, 17);
  assert.equal(result.adultDecision.assumeAdultOnVerified, false);
});

test('Didit approved with missing age persists age_unverified, not approved', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: null });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'age_unverified');
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.adultDecision.ageIsNumber, false);
  assert.equal(result.adultDecision.assumeAdultOnVerified, false);
});

test('Didit approved with non numeric age persists age_unverified, not approved', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 'unknown' });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'age_unverified');
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.adultDecision.ageIsNumber, false);
  assert.equal(result.adultDecision.assumeAdultOnVerified, false);
});

test('Didit approved with age 18 persists approved and adult true', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 18 });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'approved');
  assert.equal(result.isAdult, true);
  assert.equal(result.isApprovedAdult, true);
  assert.equal(result.adultDecision.age, 18);
  assert.equal(result.adultDecision.assumeAdultOnVerified, false);
});

test('Existing approved adult user is not downgraded by later incomplete Didit data', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: null, alreadyApproved: true });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, null);
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.updateMode, 'diagnostics_only');
});
