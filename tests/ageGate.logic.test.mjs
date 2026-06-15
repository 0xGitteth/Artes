import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldBlockMainAppForAgeState } from '../src/utils/ageGate.js';

test('blocks main app when Didit status is underage', () => {
  assert.equal(shouldBlockMainAppForAgeState({ profile: { ageVerified: true, isAdult: true, didit: { status: 'underage' } } }), true);
});

test('blocks main app when IDV status is underage', () => {
  assert.equal(shouldBlockMainAppForAgeState({ profile: { ageVerified: true, isAdult: true, idv: { status: 'underage' } } }), true);
});

test('blocks main app when ageVerified or isAdult is not true', () => {
  assert.equal(shouldBlockMainAppForAgeState({ profile: { ageVerified: false, isAdult: true } }), true);
  assert.equal(shouldBlockMainAppForAgeState({ profile: { ageVerified: true, isAdult: false } }), true);
});

test('allows main app for verified adult profile', () => {
  assert.equal(shouldBlockMainAppForAgeState({ profile: { ageVerified: true, isAdult: true } }), false);
});

test('does not block explicit Codex dev identity', () => {
  assert.equal(shouldBlockMainAppForAgeState({ profile: { ageVerified: false, isAdult: false }, authClaims: { devCodex: true } }), false);
});
