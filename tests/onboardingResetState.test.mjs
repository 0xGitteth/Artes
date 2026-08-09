import assert from 'node:assert/strict';
import {
  clearConfirmedOnboardingResetForTests,
  hasPendingOnboardingReset,
  markConfirmedOnboardingReset,
  reconcileConfirmedOnboardingReset,
} from '../src/utils/onboardingResetState.js';

const uid = 'reset-local-user';
clearConfirmedOnboardingResetForTests();
assert.equal(hasPendingOnboardingReset(uid), false, 'failed/unconfirmed reset changes no local state');

markConfirmedOnboardingReset(uid);
assert.equal(hasPendingOnboardingReset(uid), true);
assert.equal(
  reconcileConfirmedOnboardingReset(uid, { onboardingStep: 5, onboardingComplete: true }),
  true,
  'stale completed listener state keeps the explicit step-2 override active',
);
assert.equal(hasPendingOnboardingReset(uid), true);
assert.equal(
  reconcileConfirmedOnboardingReset(uid, { onboardingStep: 2, onboardingComplete: false }),
  true,
  'the authoritative reset snapshot is accepted',
);
assert.equal(hasPendingOnboardingReset(uid), false, 'authoritative reset clears only the special override');
assert.equal(
  reconcileConfirmedOnboardingReset(uid, { onboardingStep: 1, onboardingComplete: false }),
  false,
  'normal non-reset synchronization receives no backwards-step override',
);

console.log('PASS onboardingResetState.test');
