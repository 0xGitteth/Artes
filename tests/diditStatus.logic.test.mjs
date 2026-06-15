import assert from 'node:assert/strict';
import test from 'node:test';
import { DIDIT_REFRESHABLE_STATUSES, resolveEffectiveDiditState } from '../src/utils/diditStatus.js';

test('persisted underage remains a terminal support state', () => {
  assert.equal(resolveEffectiveDiditState({ persistedDiditStatus: 'underage' }), 'underage');
});

test('persisted age_unverified remains a support state', () => {
  assert.equal(resolveEffectiveDiditState({ persistedDiditStatus: 'age_unverified' }), 'age_unverified');
});

test('persisted underage and age_unverified are not treated as approved', () => {
  assert.notEqual(resolveEffectiveDiditState({ persistedDiditStatus: 'underage' }), 'approved');
  assert.notEqual(resolveEffectiveDiditState({ persistedDiditStatus: 'age_unverified' }), 'approved');
});

test('profile ageVerified true is the local shortcut to approved adult access', () => {
  assert.equal(resolveEffectiveDiditState({ profileAgeVerified: true, persistedDiditStatus: 'age_unverified' }), 'approved');
  assert.equal(resolveEffectiveDiditState({ profileAgeVerified: false, persistedDiditStatus: 'approved' }), 'not_started');
});


test('age_unverified maps to support state and is refreshable', () => {
  assert.equal(resolveEffectiveDiditState({ persistedDiditStatus: 'age_unverified' }), 'age_unverified');
  assert.notEqual(resolveEffectiveDiditState({ persistedDiditStatus: 'age_unverified' }), 'approved');
  assert.equal(DIDIT_REFRESHABLE_STATUSES.includes('age_unverified'), true);
});
