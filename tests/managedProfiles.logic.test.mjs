import assert from 'node:assert/strict';
import { deriveManagedProfiles, resolveActiveProfile } from '../src/utils/managedProfiles.js';

const existingProfile = {
  uid: 'user_123',
  profileId: 'user_123',
  ownerUid: 'user_123',
  displayName: 'Existing Maker',
  roles: ['assistant'],
};

const managedProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_123' },
  profile: existingProfile,
  publicProfile: { uid: 'user_123', displayName: 'Public Maker' },
});

assert.equal(managedProfiles.length, 1, 'Existing personal profile should create exactly one managed profile for now');
assert.equal(managedProfiles[0].profileId, 'user_123', 'Personal profile keeps uid as profileId');
assert.equal(managedProfiles[0].ownerUid, 'user_123', 'Personal profile keeps uid as ownerUid');
assert.equal(managedProfiles[0].isPersonal, true, 'Personal managed profile is marked explicitly');
assert.equal(managedProfiles[0].displayName, 'Existing Maker', 'Private profile data remains the preferred source for the owner');

const activeProfile = resolveActiveProfile({
  managedProfiles,
  activeProfileId: 'missing_profile',
  personalProfileId: 'user_123',
});

assert.equal(activeProfile?.profileId, 'user_123', 'Unknown activeProfileId should fall back to the personal profile');

const spoofedProfile = deriveManagedProfiles({
  authUser: { uid: 'user_safe' },
  profile: { uid: 'user_safe', profileId: 'other_profile', ownerUid: 'other_owner', displayName: 'Safe User' },
});

assert.equal(spoofedProfile[0].profileId, 'user_safe', 'Personal managed profile should not trust a non-personal profileId');
assert.equal(spoofedProfile[0].ownerUid, 'user_safe', 'Personal managed profile should not trust a non-owner ownerUid');

const publicOnlyProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_456' },
  publicProfile: { uid: 'user_456', displayName: 'Public Only' },
});

assert.equal(publicOnlyProfiles.length, 1, 'Public profile data can seed the personal managed profile when private profile is not loaded yet');
assert.equal(publicOnlyProfiles[0].profileId, 'user_456', 'Public-only personal profile gets a safe profileId fallback');
assert.equal(publicOnlyProfiles[0].ownerUid, 'user_456', 'Public-only personal profile gets a safe ownerUid fallback');

const noProfile = deriveManagedProfiles({ authUser: { uid: 'visitor_1' } });
assert.deepEqual(noProfile, [], 'Visitors without a loaded own profile should not receive a managed profile context');

console.log('PASS managedProfiles.logic.test');
