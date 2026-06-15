import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgeGateOnboardingStep, shouldBlockMainAppForAgeState } from '../src/utils/ageGate.js';

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

test('profile isDevTestUser alone does not bypass age gate', () => {
  assert.equal(shouldBlockMainAppForAgeState({ profile: { isDevTestUser: true, ageVerified: false, isAdult: false } }), true);
});

test('known Codex dev uid bypasses age gate', () => {
  assert.equal(shouldBlockMainAppForAgeState({ profile: { ageVerified: false, isAdult: false }, uid: 'codex-dev-user' }), false);
});

test('age-blocked completed users are forced back to Didit step', () => {
  assert.equal(resolveAgeGateOnboardingStep({ profile: { onboardingComplete: true, ageVerified: false, isAdult: false } }), 2);
  assert.equal(resolveAgeGateOnboardingStep({ profile: { onboardingComplete: true, ageVerified: true, isAdult: true } }), null);
});
