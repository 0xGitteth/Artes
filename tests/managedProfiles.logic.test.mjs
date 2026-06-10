import assert from 'node:assert/strict';
import {
  ACTIVE_PROFILE_STORAGE_KEY,
  EXTERNAL_PROFILE_VIEW_PREFIX,
  buildManagedExternalProfileCreatePayload,
  createManagedExternalProfileId,
  deriveManagedProfiles,
  getBrowserStorage,
  getExternalProfileIdFromView,
  buildPostAuthorFields,
  getManagedProfileHeaderSwipeDirection,
  getManagedProfileSwitcherActiveIndex,
  getNextManagedProfileForSwipe,
  getPreviousManagedProfileForSwipe,
  shouldShowManagedProfileHeaderSwitcher,
  normalizeRequestedActiveProfileId,
  readStoredActiveProfileId,
  resolveActiveProfile,
  resolveAuthorQuickProfileTarget,
  resolvePostAuthorDisplayNameFromProfiles,
  isPublicManagedExternalProfileVisible,
  resolvePostAuthorProfile,
  shouldDelayActiveProfilePersistence,
  validateManagedExternalProfileDraft,
  writeStoredActiveProfileId,
} from '../src/utils/managedProfiles.js';

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


const ownerManagedProfiles = deriveManagedProfiles({
  authUser: { uid: 'owner_multi' },
  profile: { uid: 'owner_multi', displayName: 'Owner Multi' },
  managedExternalProfiles: [
    { id: 'company_multi_1', type: 'company', displayName: 'Company One', ownerUid: 'owner_multi', status: 'active' },
    { id: 'agency_multi_1', type: 'agency', displayName: 'Agency One', ownerUid: 'owner_multi', status: 'active' },
    { id: 'collective_multi_1', type: 'collective', displayName: 'Collective One', ownerUid: 'owner_multi', status: 'active' },
  ],
});
assert.equal(
  resolveActiveProfile({ managedProfiles: ownerManagedProfiles, personalProfileId: 'owner_multi' })?.profileId,
  'owner_multi',
  'Missing activeProfileId falls back to the personal profile',
);
assert.equal(
  resolveActiveProfile({ managedProfiles: ownerManagedProfiles, activeProfileId: 'agency_multi_1', personalProfileId: 'owner_multi' })?.profileId,
  'agency_multi_1',
  'Valid external activeProfileId selects that external profile',
);
assert.equal(
  resolveActiveProfile({ managedProfiles: ownerManagedProfiles, activeProfileId: 'stale_external', personalProfileId: 'owner_multi' })?.profileId,
  'owner_multi',
  'Stale activeProfileId falls back to the personal profile',
);
assert.equal(
  resolveActiveProfile({ managedProfiles: ownerManagedProfiles, activeProfileId: 'unmanaged_profile', personalProfileId: 'owner_multi' })?.profileId,
  'owner_multi',
  'activeProfileId is ignored when the profile is not present in managedProfiles',
);
assert.deepEqual(
  ['company_multi_1', 'agency_multi_1', 'collective_multi_1'].map((profileId) => (
    resolveActiveProfile({ managedProfiles: ownerManagedProfiles, activeProfileId: profileId, personalProfileId: 'owner_multi' })?.profileId
  )),
  ['company_multi_1', 'agency_multi_1', 'collective_multi_1'],
  'Multiple external profiles remain individually selectable as active profiles',
);

const activeAgencyProfile = resolveActiveProfile({
  managedProfiles: ownerManagedProfiles,
  activeProfileId: 'agency_multi_1',
  personalProfileId: 'owner_multi',
});
assert.equal(
  getManagedProfileSwitcherActiveIndex({ managedProfiles: ownerManagedProfiles, activeProfile: activeAgencyProfile }),
  2,
  'Header switcher helper resolves the active profile index from activeProfile.profileId',
);
assert.equal(
  getManagedProfileSwitcherActiveIndex({ managedProfiles: ownerManagedProfiles, activeProfile: { profileId: 'stale_external' } }),
  0,
  'Header switcher helper falls back to the personal profile for stale activeProfile values',
);
assert.equal(
  getNextManagedProfileForSwipe({ managedProfiles: ownerManagedProfiles, activeProfile: activeAgencyProfile })?.profileId,
  'collective_multi_1',
  'Swipe left helper selects the next managed profile',
);
assert.equal(
  getPreviousManagedProfileForSwipe({ managedProfiles: ownerManagedProfiles, activeProfile: activeAgencyProfile })?.profileId,
  'company_multi_1',
  'Swipe right helper selects the previous managed profile',
);
assert.equal(
  getNextManagedProfileForSwipe({ managedProfiles: ownerManagedProfiles, activeProfile: ownerManagedProfiles[3] })?.profileId,
  'owner_multi',
  'Swipe left helper wraps from the last profile to the personal profile',
);
assert.equal(
  shouldShowManagedProfileHeaderSwitcher({ isOwn: true, managedProfiles }),
  false,
  'Header switcher is hidden when only the personal profile is available',
);
assert.equal(
  shouldShowManagedProfileHeaderSwitcher({ isOwn: true, managedProfiles: ownerManagedProfiles }),
  true,
  'Header switcher is shown for the owner when multiple managed profiles are available',
);
assert.equal(
  shouldShowManagedProfileHeaderSwitcher({ isOwn: false, managedProfiles: ownerManagedProfiles }),
  false,
  'Header switcher is hidden for visitors viewing another profile',
);
assert.equal(
  getManagedProfileHeaderSwipeDirection({ deltaX: -80, deltaY: 12 }),
  'next',
  'Clear horizontal swipe left on the header maps to the next profile',
);
assert.equal(
  getManagedProfileHeaderSwipeDirection({ deltaX: 80, deltaY: 12 }),
  'previous',
  'Clear horizontal swipe right on the header maps to the previous profile',
);
assert.equal(
  getManagedProfileHeaderSwipeDirection({ deltaX: -80, deltaY: 75 }),
  null,
  'Mostly vertical movement is ignored so mobile scrolling remains normal',
);
assert.equal(
  getManagedProfileHeaderSwipeDirection({ deltaX: -24, deltaY: 4 }),
  null,
  'Small horizontal movement below the swipe threshold is ignored',
);
assert.equal(
  getManagedProfileHeaderSwipeDirection({ deltaX: 0, deltaY: 0 }),
  null,
  'No movement, including touches outside the header handlers, has no switch direction',
);

const storageWrites = new Map();
const fakeStorage = {
  getItem: (key) => storageWrites.get(key) || null,
  setItem: (key, value) => storageWrites.set(key, value),
  removeItem: (key) => storageWrites.delete(key),
};
writeStoredActiveProfileId(fakeStorage, 'agency_multi_1');
assert.deepEqual(
  Array.from(storageWrites.keys()),
  [ACTIVE_PROFILE_STORAGE_KEY],
  'localStorage persistence stores only the activeProfileId key',
);
assert.equal(readStoredActiveProfileId(fakeStorage), 'agency_multi_1', 'Stored activeProfileId can be read back');
writeStoredActiveProfileId(fakeStorage, '');
assert.equal(storageWrites.has(ACTIVE_PROFILE_STORAGE_KEY), false, 'Empty activeProfileId clears the stored value');

const personalOnlyWhileExternalProfilesLoad = ownerManagedProfiles.slice(0, 1);
const personalFallbackWhileLoading = resolveActiveProfile({
  managedProfiles: personalOnlyWhileExternalProfilesLoad,
  activeProfileId: 'agency_multi_1',
  personalProfileId: 'owner_multi',
});
assert.equal(personalFallbackWhileLoading?.profileId, 'owner_multi', 'Personal profile remains the safe UI fallback while external profiles load');
assert.equal(
  normalizeRequestedActiveProfileId({
    managedProfiles: personalOnlyWhileExternalProfilesLoad,
    activeProfile: personalFallbackWhileLoading,
    requestedActiveProfileId: 'agency_multi_1',
    managedExternalProfilesLoaded: false,
  }),
  'agency_multi_1',
  'Stored external activeProfileId survives while external profiles are still loading',
);
assert.equal(
  normalizeRequestedActiveProfileId({
    managedProfiles: personalOnlyWhileExternalProfilesLoad,
    activeProfile: null,
    requestedActiveProfileId: 'agency_multi_1',
    managedExternalProfilesLoaded: false,
  }),
  'agency_multi_1',
  'requestedActiveProfileId is preserved while activeProfile is null and external profiles are still loading',
);
assert.equal(
  normalizeRequestedActiveProfileId({
    managedProfiles: [],
    activeProfile: null,
    requestedActiveProfileId: 'agency_multi_1',
    managedExternalProfilesLoaded: false,
  }),
  'agency_multi_1',
  'requestedActiveProfileId is preserved while managedProfiles is empty and external profiles are still loading',
);
assert.equal(
  normalizeRequestedActiveProfileId({
    managedProfiles: [],
    activeProfile: null,
    requestedActiveProfileId: '',
    managedExternalProfilesLoaded: false,
  }),
  null,
  'No requested id and no activeProfile still returns null',
);
assert.equal(
  shouldDelayActiveProfilePersistence({
    managedProfiles: personalOnlyWhileExternalProfilesLoad,
    requestedActiveProfileId: 'agency_multi_1',
    managedExternalProfilesLoaded: false,
  }),
  true,
  'Personal fallback is not persisted while a stored external activeProfileId may still load',
);
assert.equal(
  resolveActiveProfile({ managedProfiles: ownerManagedProfiles, activeProfileId: 'agency_multi_1', personalProfileId: 'owner_multi' })?.profileId,
  'agency_multi_1',
  'Stored external activeProfileId becomes active once external profiles load',
);
assert.equal(
  normalizeRequestedActiveProfileId({
    managedProfiles: ownerManagedProfiles,
    activeProfile: resolveActiveProfile({ managedProfiles: ownerManagedProfiles, activeProfileId: 'agency_multi_1', personalProfileId: 'owner_multi' }),
    requestedActiveProfileId: 'agency_multi_1',
    managedExternalProfilesLoaded: true,
  }),
  'agency_multi_1',
  'Valid requestedActiveProfileId still wins when present in managedProfiles',
);
assert.equal(
  normalizeRequestedActiveProfileId({
    managedProfiles: ownerManagedProfiles,
    activeProfile: resolveActiveProfile({ managedProfiles: ownerManagedProfiles, activeProfileId: 'stale_external', personalProfileId: 'owner_multi' }),
    requestedActiveProfileId: 'stale_external',
    managedExternalProfilesLoaded: true,
  }),
  'owner_multi',
  'Stored stale activeProfileId falls back to personal only after external profiles finished loading',
);
assert.equal(
  shouldDelayActiveProfilePersistence({
    managedProfiles: ownerManagedProfiles,
    requestedActiveProfileId: 'stale_external',
    managedExternalProfilesLoaded: true,
  }),
  false,
  'Stale activeProfileId fallback can be persisted after external profiles finished loading',
);

const throwingStorage = {
  getItem: () => { throw new Error('blocked read'); },
  setItem: () => { throw new Error('blocked write'); },
  removeItem: () => { throw new Error('blocked remove'); },
};
assert.equal(readStoredActiveProfileId(throwingStorage), null, 'localStorage read errors return null and do not throw');
assert.doesNotThrow(() => writeStoredActiveProfileId(throwingStorage, 'agency_multi_1'), 'localStorage write errors do not throw');
assert.doesNotThrow(() => writeStoredActiveProfileId(throwingStorage, ''), 'localStorage remove errors do not throw');
assert.equal(getBrowserStorage(() => { throw new Error('blocked access'); }), null, 'localStorage access errors return null and do not throw');

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
      privateData: { legalRepresentativeEmail: 'private@example.com' },
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
assert.equal('managerUids' in profilesWithExternal[1], false, 'External profiles do not expose managerUids while manager access is not used yet');
assert.equal('uid' in profilesWithExternal[1], false, 'External profiles do not receive a personal uid field');
assert.equal('legalName' in profilesWithExternal[1], false, 'External profile normalization only exposes the safe public profile model');
assert.equal('privateData' in profilesWithExternal[1], false, 'External profile normalization drops nested/private candidate data');

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

const collectiveExternal = deriveManagedProfiles({
  authUser: { uid: 'collective_owner' },
  profile: { uid: 'collective_owner', displayName: 'Collective Owner' },
  managedExternalProfiles: [
    {
      id: 'collective_profile_1',
      type: 'collective',
      displayName: 'Collective Profile',
      ownerUid: 'collective_owner',
      status: 'active',
    },
  ],
});

assert.equal(collectiveExternal.length, 2, 'A valid collective profile can be normalized when explicitly provided');
assert.equal(collectiveExternal[1].type, 'collective', 'External collective profiles keep their allowed organization type');

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

const fakeTimestamp = { __serverTimestamp: true };
const createPayload = buildManagedExternalProfileCreatePayload({
  authUid: 'owner_user',
  type: 'company',
  displayName: '  Studio Veilig  ',
  timestamp: fakeTimestamp,
});

assert.deepEqual(
  Object.keys(createPayload).sort(),
  ['createdAt', 'displayName', 'ownerUid', 'status', 'type', 'updatedAt'],
  'Create payload only contains safe public profiles/{profileId} fields',
);
assert.equal(createPayload.ownerUid, 'owner_user', 'Create payload ownerUid always comes from authUser.uid');
assert.equal(createPayload.displayName, 'Studio Veilig', 'Create payload trims displayName whitespace');
assert.equal(createPayload.type, 'company', 'Create payload stores the selected external profile type');
assert.equal(createPayload.status, 'active', 'Create payload always stores active status');
assert.equal(createPayload.createdAt, fakeTimestamp, 'Create payload uses the provided Firestore timestamp for createdAt');
assert.equal(createPayload.updatedAt, fakeTimestamp, 'Create payload uses the provided Firestore timestamp for updatedAt');
assert.equal('managerUids' in createPayload, false, 'Create payload never writes managerUids');
assert.equal('email' in createPayload, false, 'Create payload never writes email');
assert.equal('legalName' in createPayload, false, 'Create payload never writes legalName');
assert.equal('private' in createPayload, false, 'Create payload never writes private nested data');

assert.equal(validateManagedExternalProfileDraft({ type: 'agency', displayName: '' }).ok, false, 'Empty displayName is rejected');
assert.equal(validateManagedExternalProfileDraft({ type: 'agency', displayName: '   ' }).ok, false, 'Whitespace-only displayName is rejected');
assert.equal(validateManagedExternalProfileDraft({ type: 'collective', displayName: '  Nacht Collectief  ' }).displayName, 'Nacht Collectief', 'Validation trims displayName');
assert.equal(validateManagedExternalProfileDraft({ type: 'company', displayName: 'x'.repeat(121) }).ok, false, 'Display names longer than 120 characters are rejected');
assert.equal(validateManagedExternalProfileDraft({ type: 'collective', displayName: 'Projectgroep' }).ok, true, 'Collective profile type is accepted');

const generatedProfileId = createManagedExternalProfileId({
  authUid: 'auth_user',
  createId: (() => {
    const ids = ['auth_user', 'external_profile_1'];
    return () => ids.shift();
  })(),
});
assert.equal(generatedProfileId, 'external_profile_1', 'Generated profileId retries when a generated id equals authUser.uid');
assert.notEqual(generatedProfileId, 'auth_user', 'Generated profileId is not authUser.uid');

const multipleSameTypeProfiles = deriveManagedProfiles({
  authUser: { uid: 'same_type_owner' },
  profile: { uid: 'same_type_owner', displayName: 'Same Type Owner' },
  managedExternalProfiles: [
    { id: 'company_one', type: 'company', displayName: 'Company One', ownerUid: 'same_type_owner', status: 'active' },
    { id: 'company_two', type: 'company', displayName: 'Company Two', ownerUid: 'same_type_owner', status: 'active' },
    { id: 'agency_one', type: 'agency', displayName: 'Agency One', ownerUid: 'same_type_owner', status: 'active' },
    { id: 'agency_two', type: 'agency', displayName: 'Agency Two', ownerUid: 'same_type_owner', status: 'active' },
    { id: 'collective_one', type: 'collective', displayName: 'Collective One', ownerUid: 'same_type_owner', status: 'active' },
    { id: 'collective_two', type: 'collective', displayName: 'Collective Two', ownerUid: 'same_type_owner', status: 'active' },
  ],
});
assert.deepEqual(
  multipleSameTypeProfiles.slice(1).map((profile) => profile.profileId),
  ['company_one', 'company_two', 'agency_one', 'agency_two', 'collective_one', 'collective_two'],
  'Multiple profiles of the same type remain allowed and are not collapsed by type',
);


const personalAuthorProfile = resolvePostAuthorProfile({
  authUid: 'owner_user',
  requestedProfileId: 'owner_user',
});
assert.deepEqual(
  personalAuthorProfile,
  { profileId: 'owner_user', ownerUid: 'owner_user', isPersonal: true },
  'Personal author profile resolves to auth uid',
);

const externalAuthorProfile = resolvePostAuthorProfile({
  authUid: 'owner_user',
  requestedProfileId: 'studio_profile',
  profileDoc: {
    id: 'studio_profile',
    profileId: 'studio_profile',
    ownerUid: 'owner_user',
    status: 'active',
    type: 'company',
    displayName: 'Studio Profile',
  },
});
assert.equal(externalAuthorProfile.profileId, 'studio_profile', 'Valid external author profile resolves to profile id');
assert.equal(externalAuthorProfile.ownerUid, 'owner_user', 'Valid external author profile keeps auth uid as owner');
assert.throws(
  () => resolvePostAuthorProfile({
    authUid: 'owner_user',
    requestedProfileId: 'spoofed_profile',
    profileDoc: { id: 'spoofed_profile', ownerUid: 'other_user', status: 'active', type: 'agency' },
  }),
  /alleen publiceren namens een profiel dat je beheert/,
  'External author profile from another owner is rejected',
);
assert.throws(
  () => resolvePostAuthorProfile({
    authUid: 'owner_user',
    requestedProfileId: 'inactive_profile',
    profileDoc: { id: 'inactive_profile', ownerUid: 'owner_user', status: 'inactive', type: 'collective' },
  }),
  /niet beschikbaar/,
  'Inactive external author profile is rejected',
);
assert.deepEqual(
  buildPostAuthorFields({ authUid: 'owner_user', resolvedProfileId: 'agency_profile' }),
  {
    authorId: 'owner_user',
    authorUid: 'owner_user',
    authorOwnerUid: 'owner_user',
    authorProfileId: 'agency_profile',
  },
  'Post author payload keeps ownership on auth uid and writes resolved active profile id',
);
assert.equal(
  resolvePostAuthorDisplayNameFromProfiles({
    post: { authorId: 'owner_user', authorProfileId: 'agency_profile', authorName: 'Legacy Name' },
    users: [{ uid: 'owner_user', displayName: 'Owner Name' }],
    profilesById: { agency_profile: { displayName: 'Agency Profile' } },
  }),
  'Agency Profile',
  'Post display name uses external profile displayName when available',
);
assert.equal(
  resolvePostAuthorDisplayNameFromProfiles({
    post: { authorId: 'owner_user', authorName: 'Legacy Name' },
    users: [{ uid: 'owner_user', displayName: 'Owner Name' }],
    profilesById: {},
  }),
  'Owner Name',
  'Legacy post without authorProfileId uses existing public user fallback',
);
assert.equal(
  resolvePostAuthorDisplayNameFromProfiles({
    post: { authorId: 'owner_user', authorProfileId: 'missing_profile', authorName: 'Legacy Name' },
    users: [],
    profilesById: {},
  }),
  'Legacy Name',
  'Post display does not crash and falls back when external profile info is missing',
);


const quickExternalCompanyProfile = { profileId: 'company_profile', ownerUid: 'owner_user', type: 'company', status: 'active', displayName: 'Studio X' };
const quickExternalAgencyProfile = { profileId: 'agency_profile', ownerUid: 'owner_user', type: 'agency', status: 'active', displayName: 'Agency Y' };
const quickExternalCollectiveProfile = { profileId: 'collective_profile', ownerUid: 'owner_user', type: 'collective', status: 'active', displayName: 'Collectief Z' };

assert.deepEqual(
  resolveAuthorQuickProfileTarget({
    post: { authorId: 'owner_user', authorOwnerUid: 'owner_user', authorProfileId: 'company_profile' },
    profilesById: { company_profile: quickExternalCompanyProfile },
    viewerUid: 'visitor_user',
  }),
  { kind: 'external', profileId: 'company_profile', ownerUid: 'owner_user', profile: quickExternalCompanyProfile },
  'Active company authorProfileId opens an external quick profile target',
);
assert.deepEqual(
  resolveAuthorQuickProfileTarget({
    post: { authorId: 'owner_user', authorOwnerUid: 'owner_user', authorProfileId: 'agency_profile' },
    profilesById: { agency_profile: quickExternalAgencyProfile },
    viewerUid: 'visitor_user',
  }),
  { kind: 'external', profileId: 'agency_profile', ownerUid: 'owner_user', profile: quickExternalAgencyProfile },
  'Active agency authorProfileId opens an external quick profile target',
);
assert.deepEqual(
  resolveAuthorQuickProfileTarget({
    post: { authorId: 'owner_user', authorOwnerUid: 'owner_user', authorProfileId: 'collective_profile' },
    profilesById: { collective_profile: quickExternalCollectiveProfile },
    viewerUid: 'visitor_user',
  }),
  { kind: 'external', profileId: 'collective_profile', ownerUid: 'owner_user', profile: quickExternalCollectiveProfile },
  'Active collective authorProfileId opens an external quick profile target',
);
assert.deepEqual(
  resolveAuthorQuickProfileTarget({
    post: { authorId: 'owner_user', authorOwnerUid: 'owner_user', authorProfileId: 'owner_user' },
    profilesById: { owner_user: { type: 'personal', displayName: 'Owner' } },
  }),
  { kind: 'personal', userId: 'owner_user', profileId: null, ownerUid: 'owner_user' },
  'Personal authorProfileId keeps opening the personal quick profile',
);
assert.deepEqual(
  resolveAuthorQuickProfileTarget({ post: { authorId: 'owner_user', authorName: 'Legacy Owner' }, profilesById: {} }),
  { kind: 'personal', userId: 'owner_user', profileId: null, ownerUid: 'owner_user' },
  'Old post without authorProfileId keeps using the personal fallback',
);
assert.deepEqual(
  resolveAuthorQuickProfileTarget({
    post: { authorId: 'owner_user', authorOwnerUid: 'owner_user', authorProfileId: 'missing_profile' },
    profilesById: {},
  }),
  { kind: 'externalUnavailable', profileId: 'missing_profile', ownerUid: 'owner_user', profile: null, reason: 'missing-external-profile' },
  'Missing external profile keeps the external target unavailable instead of falling back to the owner',
);
assert.deepEqual(
  resolveAuthorQuickProfileTarget({
    post: { authorId: 'owner_user', authorOwnerUid: 'owner_user', authorProfileId: 'inactive_profile' },
    profilesById: { inactive_profile: { profileId: 'inactive_profile', ownerUid: 'owner_user', type: 'agency', status: 'inactive' } },
    viewerUid: 'visitor_user',
  }),
  { kind: 'externalUnavailable', profileId: 'inactive_profile', ownerUid: 'owner_user', profile: null, reason: 'inactive-external-profile' },
  'Inactive external profile for a visitor keeps the external target unavailable instead of falling back to the owner',
);
assert.deepEqual(
  resolveAuthorQuickProfileTarget({
    post: { authorId: 'owner_user', authorOwnerUid: 'owner_user', authorProfileId: 'inactive_profile' },
    profilesById: { inactive_profile: { profileId: 'inactive_profile', ownerUid: 'owner_user', type: 'agency', status: 'inactive' } },
    viewerUid: 'owner_user',
  }),
  { kind: 'externalUnavailable', profileId: 'inactive_profile', ownerUid: 'owner_user', profile: null, reason: 'inactive-external-profile' },
  'Inactive external profile for the owner keeps the external target unavailable instead of falling back to the owner',
);
assert.equal(
  getExternalProfileIdFromView(`${EXTERNAL_PROFILE_VIEW_PREFIX}company_profile`),
  'company_profile',
  'External profile view parsing preserves profile ids with underscores',
);
assert.equal(
  getExternalProfileIdFromView(`${EXTERNAL_PROFILE_VIEW_PREFIX}companyprofile`),
  'companyprofile',
  'External profile view parsing also supports profile ids without underscores',
);
assert.equal(
  isPublicManagedExternalProfileVisible({ profile: { type: 'company', ownerUid: 'owner_user', status: 'inactive' }, viewerUid: 'visitor_user' }),
  false,
  'Inactive external profile is hidden from visitors',
);
assert.equal(
  isPublicManagedExternalProfileVisible({ profile: { type: 'company', ownerUid: 'owner_user', status: 'inactive' }, viewerUid: 'owner_user' }),
  false,
  'Inactive external profile is unavailable even when the owner is viewing the public surface',
);

console.log('PASS managedProfiles.logic.test');
