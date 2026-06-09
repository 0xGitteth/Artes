import assert from 'node:assert/strict';
import { deriveManagedProfiles, resolveActiveProfile } from '../src/utils/managedProfiles.js';

const managedProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_123' },
  profile: {
    uid: 'user_123',
    profileId: 'user_123',
    ownerUid: 'user_123',
    displayName: 'Existing Maker',
    roles: ['assistant'],
  },
  publicProfile: { uid: 'user_123', displayName: 'Public Maker' },
});

assert.equal(managedProfiles.length, 1, 'Existing personal profile should create exactly one managed profile for now');
assert.equal(managedProfiles[0].uid, 'user_123', 'Personal profile keeps auth uid as uid');
assert.equal(managedProfiles[0].id, 'user_123', 'Personal profile keeps auth uid as id');
assert.equal(managedProfiles[0].profileId, 'user_123', 'Personal profile keeps auth uid as profileId');
assert.equal(managedProfiles[0].ownerUid, 'user_123', 'Personal profile keeps auth uid as ownerUid');
assert.equal(managedProfiles[0].isPersonal, true, 'Personal managed profile is marked explicitly');
assert.equal(managedProfiles[0].displayName, 'Existing Maker', 'Private profile data remains the preferred source for the owner');

const activeProfile = resolveActiveProfile({
  managedProfiles,
  activeProfileId: 'missing_profile',
  personalProfileId: 'user_123',
});

assert.equal(activeProfile?.profileId, 'user_123', 'Unknown activeProfileId should fall back to the personal profile');

const stalePrivateOnlyProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_B' },
  profile: { uid: 'user_A', displayName: 'Stale Private User A' },
});

assert.deepEqual(stalePrivateOnlyProfiles, [], 'Stale private profile for user_A must not create a managed profile for authenticated user_B');

const stalePrivateMatchingPublicProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_B' },
  profile: { uid: 'user_A', displayName: 'Stale Private User A' },
  publicProfile: { uid: 'user_B', displayName: 'Matching Public User B' },
});

assert.equal(stalePrivateMatchingPublicProfiles.length, 1, 'Matching public profile can be used when private profile is stale');
assert.equal(stalePrivateMatchingPublicProfiles[0].uid, 'user_B', 'Stale private profile must not override auth uid');
assert.equal(stalePrivateMatchingPublicProfiles[0].displayName, 'Matching Public User B', 'Matching public data should seed the profile when private data is stale');

const missingAuthProfiles = deriveManagedProfiles({
  profile: { uid: 'user_A', displayName: 'Stale Private User A' },
  publicProfile: { uid: 'user_A', displayName: 'Stale Public User A' },
});

assert.deepEqual(missingAuthProfiles, [], 'Missing authUser.uid should return no managed profiles even with stale profile data');

const spoofedProfile = deriveManagedProfiles({
  authUser: { uid: 'user_safe' },
  profile: { uid: 'user_safe', id: 'other_id', profileId: 'other_profile', ownerUid: 'other_owner', displayName: 'Safe User' },
});

assert.equal(spoofedProfile[0].uid, 'user_safe', 'Personal managed profile should always use auth uid');
assert.equal(spoofedProfile[0].id, 'user_safe', 'Spoofed id should be replaced by auth uid');
assert.equal(spoofedProfile[0].profileId, 'user_safe', 'Spoofed profileId should be replaced by auth uid');
assert.equal(spoofedProfile[0].ownerUid, 'user_safe', 'Spoofed ownerUid should be replaced by auth uid');

const preferredPrivateProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_preferred' },
  profile: { uid: 'user_preferred', displayName: 'Private Preferred' },
  publicProfile: { uid: 'user_preferred', displayName: 'Public Fallback' },
});

assert.equal(preferredPrivateProfiles.length, 1, 'Matching private/public data should still create one personal managed profile');
assert.equal(preferredPrivateProfiles[0].displayName, 'Private Preferred', 'Matching private profile data should be preferred over public profile data');

const publicOnlyProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_456' },
  publicProfile: { uid: 'user_456', displayName: 'Public Only' },
});

assert.equal(publicOnlyProfiles.length, 1, 'Public profile data can seed the personal managed profile when private profile is not loaded yet');
assert.equal(publicOnlyProfiles[0].uid, 'user_456', 'Public-only personal profile gets auth uid');
assert.equal(publicOnlyProfiles[0].profileId, 'user_456', 'Public-only personal profile gets a safe profileId fallback');
assert.equal(publicOnlyProfiles[0].ownerUid, 'user_456', 'Public-only personal profile gets a safe ownerUid fallback');

const noProfile = deriveManagedProfiles({ authUser: { uid: 'visitor_1' } });
assert.deepEqual(noProfile, [], 'Visitors without a loaded own profile should not receive a managed profile context');

console.log('PASS managedProfiles.logic.test');
