import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnderagePostPatch, createUnderagePublicProfilePatch, parseDiditAge, resolveDiditAge, resolveDiditPersistenceDecision } from '../didit.js';

test('Didit age parser treats null, undefined, blank, and non numeric values as missing', () => {
  assert.equal(parseDiditAge(null), null);
  assert.equal(parseDiditAge(undefined), null);
  assert.equal(parseDiditAge(''), null);
  assert.equal(parseDiditAge('   '), null);
  assert.equal(parseDiditAge('unknown'), null);
});

test('Didit age parser keeps explicit numeric zero', () => {
  assert.equal(parseDiditAge(0), 0);
  assert.equal(parseDiditAge('0'), 0);
});

test('Didit feature id_verifications age 18 resolves approved adult', () => {
  const age = resolveDiditAge({ id_verifications: [{ age: 18 }] });
  const result = resolveDiditPersistenceDecision({ status: 'approved', age });

  assert.equal(age, 18);
  assert.equal(result.persistedStatus, 'approved');
  assert.equal(result.isApprovedAdult, true);
});

test('Didit feature id_verifications age 17 resolves underage', () => {
  const age = resolveDiditAge({ id_verifications: [{ age: 17 }] });
  const result = resolveDiditPersistenceDecision({ status: 'approved', age });

  assert.equal(age, 17);
  assert.equal(result.persistedStatus, 'underage');
  assert.equal(result.isApprovedAdult, false);
});

test('Didit feature id_verifications adult date_of_birth resolves approved adult', () => {
  const age = resolveDiditAge({ id_verifications: [{ date_of_birth: '2000-01-01' }] });
  const result = resolveDiditPersistenceDecision({ status: 'approved', age });

  assert.equal(age >= 18, true);
  assert.equal(result.persistedStatus, 'approved');
  assert.equal(result.isApprovedAdult, true);
});

test('Didit feature id_verifications underage date_of_birth resolves underage', () => {
  const age = resolveDiditAge({ id_verifications: [{ date_of_birth: '2010-01-01' }] });
  const result = resolveDiditPersistenceDecision({ status: 'approved', age });

  assert.equal(age < 18, true);
  assert.equal(result.persistedStatus, 'underage');
  assert.equal(result.isApprovedAdult, false);
});

test('Didit feature null and blank ages remain age_unverified', () => {
  const age = resolveDiditAge({ id_verifications: [{ age: null }, { age: '   ' }] });
  const result = resolveDiditPersistenceDecision({ status: 'approved', age });

  assert.equal(age, null);
  assert.equal(result.persistedStatus, 'age_unverified');
  assert.equal(result.isApprovedAdult, false);
});

test('Didit payload-level id_verifications age is scanned when session object differs', () => {
  const age = resolveDiditAge({}, { id_verifications: [{ age: 18 }] });
  const result = resolveDiditPersistenceDecision({ status: 'approved', age });

  assert.equal(age, 18);
  assert.equal(result.persistedStatus, 'approved');
  assert.equal(result.isApprovedAdult, true);
});

test('Underage public profile patch hides profile without leaking Didit details', () => {
  const marker = { serverTimestamp: true };
  const patch = createUnderagePublicProfilePatch(marker);

  assert.equal(patch.hidden, true);
  assert.equal(patch.status, 'inactive');
  assert.equal(patch.visibility, 'private');
  assert.equal(patch.publicVisibility, 'private');
  assert.equal(patch.deactivatedReason, 'underage');
  assert.equal(patch.updatedAt, marker);
  assert.deepEqual(patch.roles, []);
  assert.deepEqual(patch.themes, []);
  assert.deepEqual(patch.quickProfilePostIds, []);
  assert.equal('displayName' in patch, true);
  assert.equal('photoURL' in patch, true);
  assert.equal('didit' in patch, false);
  assert.equal('idv' in patch, false);
});


test('Underage post patch hides owned posts without leaking Didit details', () => {
  const marker = { serverTimestamp: true };
  const patch = createUnderagePostPatch(marker);

  assert.equal(patch.hidden, true);
  assert.equal(patch.status, 'inactive');
  assert.equal(patch.visibility, 'private');
  assert.equal(patch.deactivatedReason, 'underage');
  assert.equal(patch.updatedAt, marker);
  assert.deepEqual(patch.credits, []);
  assert.deepEqual(patch.styles, []);
  assert.equal('title' in patch, true);
  assert.equal('imageUrl' in patch, true);
  assert.equal('didit' in patch, false);
  assert.equal('idv' in patch, false);
  assert.equal('age' in patch, false);
  assert.equal('sessionId' in patch, false);
});

test('Didit approved with age null persists age_unverified, not underage or approved', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: null });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'age_unverified');
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.adultDecision.ageIsNumber, false);
  assert.equal(result.adultDecision.assumeAdultOnVerified, false);
});

test('Didit approved with blank age persists age_unverified, not underage or approved', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: '   ' });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'age_unverified');
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.adultDecision.ageIsNumber, false);
});

test('Didit approved with non numeric age persists age_unverified, not underage or approved', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 'unknown' });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'age_unverified');
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.adultDecision.ageIsNumber, false);
  assert.equal(result.adultDecision.assumeAdultOnVerified, false);
});

test('Didit approved with age 17 persists underage, not approved', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 17 });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'underage');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.adultDecision.age, 17);
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

test('Existing approved adult user with missing age stays diagnostics_only and does not downgrade', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: null, alreadyApproved: true });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, null);
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.updateMode, 'diagnostics_only');
  assert.equal(result.shouldClearAdultVerification, false);
  assert.equal(result.shouldResetOnboarding, false);
});

test('Existing approved adult user with non numeric age stays diagnostics_only and does not downgrade', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 'unknown', alreadyApproved: true });

  assert.equal(result.persistedStatus, null);
  assert.equal(result.candidateStatus, 'age_unverified');
  assert.equal(result.updateMode, 'diagnostics_only');
  assert.equal(result.shouldClearAdultVerification, false);
  assert.equal(result.shouldResetOnboarding, false);
});

for (const status of ['started', 'in_progress', 'expired']) {
  test(`Existing approved adult user with status ${status} stays diagnostics_only and does not clear adult flags or claims`, () => {
    const result = resolveDiditPersistenceDecision({ status, alreadyApproved: true });

    assert.equal(result.normalizedStatus, status);
    assert.equal(result.persistedStatus, null);
    assert.equal(result.candidateStatus, status);
    assert.equal(result.updateMode, 'diagnostics_only');
    assert.equal(result.shouldClearAdultVerification, false);
    assert.equal(result.shouldResetOnboarding, false);
  });
}

for (const status of ['declined', 'rejected']) {
  test(`Existing approved adult user with status ${status} stays diagnostics_only and does not clear adult flags or claims`, () => {
    const result = resolveDiditPersistenceDecision({ status, alreadyApproved: true });

    assert.equal(result.normalizedStatus, status);
    assert.equal(result.persistedStatus, null);
    assert.equal(result.candidateStatus, status);
    assert.equal(result.updateMode, 'diagnostics_only');
    assert.equal(result.shouldClearAdultVerification, false);
    assert.equal(result.shouldResetOnboarding, false);
  });
}

test('Existing approved adult user with approved age 17 downgrades underage and resets adult verification/onboarding', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 17, alreadyApproved: true });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'underage');
  assert.equal(result.candidateStatus, 'underage');
  assert.equal(result.isAdult, false);
  assert.equal(result.isApprovedAdult, false);
  assert.equal(result.updateMode, 'downgrade_underage');
  assert.equal(result.shouldClearAdultVerification, true);
  assert.equal(result.shouldResetOnboarding, true);
  assert.equal(result.onboardingStep, 2);
});

test('Existing approved adult user with age 18 remains approved adult', () => {
  const result = resolveDiditPersistenceDecision({ status: 'approved', age: 18, alreadyApproved: true });

  assert.equal(result.normalizedStatus, 'approved');
  assert.equal(result.persistedStatus, 'approved');
  assert.equal(result.candidateStatus, 'approved');
  assert.equal(result.isAdult, true);
  assert.equal(result.isApprovedAdult, true);
  assert.equal(result.updateMode, 'approve_adult');
  assert.equal(result.shouldClearAdultVerification, false);
  assert.equal(result.shouldResetOnboarding, false);
});

for (const status of ['declined', 'rejected']) {
  test(`Not already approved user with status ${status} syncs status without adult approval`, () => {
    const result = resolveDiditPersistenceDecision({ status, alreadyApproved: false });

    assert.equal(result.normalizedStatus, status);
    assert.equal(result.persistedStatus, status);
    assert.equal(result.candidateStatus, status);
    assert.equal(result.isAdult, false);
    assert.equal(result.isApprovedAdult, false);
    assert.equal(result.updateMode, 'sync_status');
    assert.equal(result.shouldClearAdultVerification, false);
  });
}
