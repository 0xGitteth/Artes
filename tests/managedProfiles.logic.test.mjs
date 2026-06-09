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

const uidlessPrivateOnlyProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_B' },
  profile: { displayName: 'Uidless Stale Private User' },
});

assert.deepEqual(uidlessPrivateOnlyProfiles, [], 'Uid-less private profile data must not match authenticated user_B');

const uidlessPrivateMatchingPublicProfiles = deriveManagedProfiles({
  authUser: { uid: 'user_B' },
  profile: { displayName: 'Uidless Stale Private User' },
  publicProfile: { uid: 'user_B', displayName: 'Matching Public User B' },
});

assert.equal(uidlessPrivateMatchingPublicProfiles.length, 1, 'Matching public profile can be used when private profile is uid-less');
assert.equal(uidlessPrivateMatchingPublicProfiles[0].uid, 'user_B', 'Uid-less private profile must not override auth uid');
assert.equal(uidlessPrivateMatchingPublicProfiles[0].displayName, 'Matching Public User B', 'Matching public data should seed the profile when private data is uid-less');

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

const profilesWithExternal = deriveManagedProfiles({
  authUser: { uid: 'owner_user' },
  profile: { uid: 'owner_user', displayName: 'Owner User' },
  managedExternalProfiles: [
    {
      id: 'agency_profile_1',
      type: 'agency',
      displayName: 'Owner Agency',
      ownerUid: 'owner_user',
      managerUids: ['owner_user', 'manager_2', ''],
      status: 'active',
      uid: 'spoofed_uid',
      legalName: 'Should Not Leak',
    },
    {
      id: 'company_profile_1',
      type: 'company',
      displayName: 'Other Company',
      ownerUid: 'other_owner',
      status: 'active',
    },
  ],
});

assert.equal(profilesWithExternal.length, 2, 'A valid owned external profile should be added next to the personal profile');
assert.equal(profilesWithExternal[0].profileId, 'owner_user', 'The personal profile remains first and auth uid based');
assert.equal(profilesWithExternal[1].profileId, 'agency_profile_1', 'External profileId is derived from the supplied root profiles document id');
assert.equal(profilesWithExternal[1].ownerUid, 'owner_user', 'External profile keeps ownerUid as the managing identity');
assert.equal(profilesWithExternal[1].type, 'agency', 'External profile keeps its allowed organization type');
assert.equal(profilesWithExternal[1].kind, 'agency', 'External profile kind mirrors its organization type');
assert.equal(profilesWithExternal[1].isPersonal, false, 'External profile is explicitly non-personal');
assert.deepEqual(profilesWithExternal[1].managerUids, ['owner_user', 'manager_2'], 'External managerUids are trimmed and empty values are removed');
assert.equal('uid' in profilesWithExternal[1], false, 'External profiles do not receive a personal uid field');
assert.equal('legalName' in profilesWithExternal[1], false, 'External profile normalization only exposes the safe public profile model');

const companyExternal = deriveManagedProfiles({
  authUser: { uid: 'company_owner' },
  publicProfile: { uid: 'company_owner', displayName: 'Company Owner' },
  managedExternalProfiles: [
    {
      profileId: 'company_profile_1',
      type: 'company',
      displayName: 'Company Profile',
      ownerUid: 'company_owner',
      status: 'active',
    },
  ],
});

assert.equal(companyExternal.length, 2, 'A valid company profile can be normalized when explicitly provided');
assert.equal(companyExternal[1].profileId, 'company_profile_1', 'External profileId can come from profileId');
assert.equal(companyExternal[1].ownerUid, 'company_owner', 'Company external profile ownerUid remains leading');

const invalidExternalProfiles = deriveManagedProfiles({
  authUser: { uid: 'owner_user' },
  profile: { uid: 'owner_user', displayName: 'Owner User' },
  managedExternalProfiles: [
    { id: 'personal_spoof', type: 'personal', displayName: 'Personal Spoof', ownerUid: 'owner_user', status: 'active' },
    { id: 'inactive_agency', type: 'agency', displayName: 'Inactive Agency', ownerUid: 'owner_user', status: 'draft' },
    { id: 'missing_owner', type: 'agency', displayName: 'Missing Owner', status: 'active' },
    { id: 'missing_name', type: 'agency', displayName: '', ownerUid: 'owner_user', status: 'active' },
    { id: 'owner_user', type: 'agency', displayName: 'Uid Collision', ownerUid: 'owner_user', status: 'active' },
  ],
});

assert.equal(invalidExternalProfiles.length, 1, 'Invalid, inactive, spoofed, and personal-id external profiles are ignored');

const duplicateExternalProfiles = deriveManagedProfiles({
  authUser: { uid: 'owner_user' },
  profile: { uid: 'owner_user', displayName: 'Owner User' },
  managedExternalProfiles: [
    { id: 'agency_profile_1', type: 'agency', displayName: 'First Agency', ownerUid: 'owner_user', status: 'active' },
    { id: 'agency_profile_1', type: 'agency', displayName: 'Duplicate Agency', ownerUid: 'owner_user', status: 'active' },
  ],
});

assert.equal(duplicateExternalProfiles.length, 2, 'Duplicate external profile ids are normalized once');
assert.equal(duplicateExternalProfiles[1].displayName, 'First Agency', 'The first valid external profile wins when duplicates are supplied');

console.log('PASS managedProfiles.logic.test');
