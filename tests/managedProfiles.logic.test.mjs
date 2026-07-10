import assert from 'node:assert/strict';
import {
  ACTIVE_PROFILE_STORAGE_KEY,
  EXTERNAL_PROFILE_VIEW_PREFIX,
  buildLegacyOrganizationSetupProfiles,
  buildManagedExternalProfileCreatePayload,
  buildManagedExternalProfileUpdatePayload,
  buildManagedExternalProfileUpdateRequest,
  buildManagedProfileSetupCreateDraft,
  createManagedExternalProfileId,
  deriveManagedProfiles,
  getBrowserStorage,
  getExternalProfileIdFromView,
  collectLegacyOrganizationProfileHints,
  buildPostAuthorFields,
  assertCanPublishWithManagedProfile,
  getSetupProfilePublishBlockCopy,
  isLegacySetupProfileId,
  isSetupManagedProfile,
  shouldShowPostInDiscover,
  shouldShowProfileInDiscover,
  getPublicExternalProfileTarget,
  getLegacyOrganizationPrefillDisplayName,
  getManagedProfileBio,
  getManagedProfileAvatar,
  getManagedProfileInitials,
  getManagedProfileHeaderSwipeDirection,
  getManagedProfileHeaderSwitcherPresentation,
  findManagedExternalProfileByType,
  getManagedProfileSwitcherActiveIndex,
  getNextManagedProfileForSwipe,
  hasManagedExternalProfileOfType,
  isManagedProfileSetupRequired,
  getPreviousManagedProfileForSwipe,
  shouldShowManagedProfileHeaderSwitcher,
  shouldShowManagedProfileSetupProfile,
  normalizeRequestedActiveProfileId,
  readStoredActiveProfileId,
  resolveActiveProfile,
  resolveAuthorQuickProfileTarget,
  resolvePostAuthorDisplayNameFromProfiles,
  resolveInitialPublicExternalProfileLoadState,
  resolvePublicExternalProfileLoadState,
  isPublicManagedExternalProfileVisible,
  mergeManagedExternalProfileUpdate,
  resolvePostAuthorProfile,
  shouldDelayActiveProfilePersistence,
  validateManagedExternalProfileDraft,
  validateManagedExternalProfileEditDraft,
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


const editValidationProfile = { profileId: 'company_edit', ownerUid: 'owner_multi', type: 'company', status: 'active', displayName: 'Company Edit' };
assert.deepEqual(
  validateManagedExternalProfileEditDraft({ profile: editValidationProfile, displayName: '  Updated Company  ', bio: '  Korte omschrijving  ' }),
  { ok: true, type: 'company', displayName: 'Updated Company', bio: 'Korte omschrijving', error: null },
  'Managed external profile edit validation trims displayName and bio',
);
assert.equal(
  validateManagedExternalProfileEditDraft({ profile: editValidationProfile, displayName: '   ', bio: '' }).ok,
  false,
  'Managed external profile edit validation rejects an empty displayName',
);
assert.equal(
  validateManagedExternalProfileEditDraft({ profile: editValidationProfile, displayName: 'x'.repeat(121), bio: '' }).ok,
  false,
  'Managed external profile edit validation rejects a too long displayName',
);
assert.equal(
  validateManagedExternalProfileEditDraft({ profile: editValidationProfile, displayName: 'Valid Name', bio: '' }).ok,
  true,
  'Managed external profile edit validation allows an empty bio',
);
assert.equal(
  validateManagedExternalProfileEditDraft({ profile: editValidationProfile, displayName: 'Valid Name', bio: 'x'.repeat(501) }).ok,
  false,
  'Managed external profile edit validation rejects a too long bio',
);
assert.deepEqual(
  buildManagedExternalProfileUpdatePayload({ profile: editValidationProfile, displayName: '  Updated Company  ', bio: '  Nieuwe omschrijving  ', avatar: ' https://cdn.example/avatar.jpg ', timestamp: 'ts' }),
  { displayName: 'Updated Company', bio: 'Nieuwe omschrijving', avatar: 'https://cdn.example/avatar.jpg', updatedAt: 'ts' },
  'Managed external profile update payload writes editable fields, avatar and updatedAt',
);
assert.throws(
  () => buildManagedExternalProfileUpdatePayload({ profile: { ...editValidationProfile, type: 'personal' }, displayName: 'Personal', bio: '', timestamp: 'ts' }),
  /niet worden bewerkt/,
  'Personal managed profile cannot use the external profile update payload',
);
assert.equal(getManagedProfileBio({ bio: '  Bio tekst  ' }), 'Bio tekst', 'Bio helper trims profile bio for quick and full external profile rendering');
assert.equal(getManagedProfileBio({ displayName: 'Legacy profile' }), '', 'Old external profiles without bio still resolve to an empty bio');
assert.equal(getManagedProfileAvatar({ avatar: '  https://cdn.example/avatar.jpg  ' }), 'https://cdn.example/avatar.jpg', 'Avatar helper trims managed profile avatar URLs for quick and full rendering');
assert.equal(getManagedProfileAvatar({ displayName: 'Legacy profile' }), '', 'Old external profiles without avatar still resolve to an empty avatar');
assert.equal(getManagedProfileInitials({ displayName: 'Studio Luna' }), 'SL', 'Avatar fallback uses profile initials when no image exists');

const updateAvatarBlob = new Blob(['avatar-bytes'], { type: 'image/jpeg' });
const updateRequestWithBlob = buildManagedExternalProfileUpdateRequest({
  profile: editValidationProfile,
  displayName: 'Updated Company',
  bio: 'Nieuwe omschrijving',
  avatar: 'data:image/jpeg;base64,cropped-preview',
  avatarBlob: updateAvatarBlob,
});
assert.equal(updateRequestWithBlob.profile, editValidationProfile, 'Parent update request keeps the managed profile reference');
assert.equal(updateRequestWithBlob.displayName, 'Updated Company', 'Parent update request forwards displayName');
assert.equal(updateRequestWithBlob.bio, 'Nieuwe omschrijving', 'Parent update request forwards bio');
assert.equal(updateRequestWithBlob.avatar, 'data:image/jpeg;base64,cropped-preview', 'Parent update request forwards the selected avatar preview');
assert.equal(updateRequestWithBlob.avatarBlob, updateAvatarBlob, 'Parent update request forwards avatarBlob for upload');
assert.deepEqual(
  buildManagedExternalProfileUpdateRequest({ profile: editValidationProfile, displayName: 'Updated Company', bio: 'Nieuwe omschrijving', avatar: '' }),
  { profile: editValidationProfile, displayName: 'Updated Company', bio: 'Nieuwe omschrijving', avatar: '' },
  'Parent update request forwards an empty avatar string so deletion can be persisted',
);
assert.deepEqual(
  mergeManagedExternalProfileUpdate([
    { profileId: 'company_edit', displayName: 'Old Company', bio: 'Old bio', avatar: 'https://cdn.example/old.jpg' },
    { profileId: 'agency_other', displayName: 'Other Agency', bio: '', avatar: 'https://cdn.example/other.jpg' },
  ], { profileId: 'company_edit', displayName: 'Updated Company', bio: 'Nieuwe omschrijving', avatar: 'https://cdn.example/new.jpg' }),
  [
    { profileId: 'company_edit', displayName: 'Updated Company', bio: 'Nieuwe omschrijving', avatar: 'https://cdn.example/new.jpg' },
    { profileId: 'agency_other', displayName: 'Other Agency', bio: '', avatar: 'https://cdn.example/other.jpg' },
  ],
  'Managed profile state merge keeps displayName/bio working and applies avatar from updatedProfile',
);
assert.deepEqual(
  mergeManagedExternalProfileUpdate([
    { profileId: 'company_edit', displayName: 'Old Company', bio: 'Old bio', avatar: 'https://cdn.example/old.jpg' },
  ], { profileId: 'company_edit', displayName: 'Updated Company', bio: 'Nieuwe omschrijving', avatar: '' }),
  [{ profileId: 'company_edit', displayName: 'Updated Company', bio: 'Nieuwe omschrijving', avatar: '' }],
  'Managed profile state merge applies an empty avatar from updatedProfile after deletion',
);

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
    { id: 'company_multi_1', type: 'company', displayName: 'Company One', ownerUid: 'owner_multi', status: 'active', avatar: 'https://cdn.example/company.jpg' },
    { id: 'agency_multi_1', type: 'agency', displayName: 'Agency One', ownerUid: 'owner_multi', status: 'active' },
    { id: 'collective_multi_1', type: 'collective', displayName: 'Collective One', ownerUid: 'owner_multi', status: 'active' },
  ],
});
assert.equal(ownerManagedProfiles[1].avatar, 'https://cdn.example/company.jpg', 'Managed external profile normalization keeps the avatar field');
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
assert.deepEqual(
  getManagedProfileHeaderSwitcherPresentation({ isOwn: true, managedProfiles: ownerManagedProfiles }),
  { showDots: true, showActiveProfileCard: false },
  'Header switcher presentation only shows pagination dots and never the active-profile card',
);
assert.deepEqual(
  getManagedProfileHeaderSwitcherPresentation({ isOwn: true, managedProfiles }),
  { showDots: false, showActiveProfileCard: false },
  'Header switcher presentation hides dots when only one managed profile is available',
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
assert.equal('didit' in createPayload, false, 'Create payload never writes Didit data');

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


const activeSeedProfile = { profileId: 'company_profile', ownerUid: 'owner_user', type: 'company', status: 'active', displayName: 'Seed Studio' };

assert.deepEqual(
  resolveInitialPublicExternalProfileLoadState({ profileId: 'company_profile', seedProfile: null }),
  { loading: true, profile: null, error: '' },
  'Normal external profile route without seed starts in loading state before Firestore resolves',
);
assert.deepEqual(
  resolveInitialPublicExternalProfileLoadState({ profileId: 'legacy_company_owner_user', seedProfile: null }),
  { loading: false, profile: null, error: 'setup-profile' },
  'Legacy setup profile route is blocked immediately without Firestore loading',
);
assert.deepEqual(
  resolveInitialPublicExternalProfileLoadState({ profileId: '', seedProfile: null }),
  { loading: false, profile: null, error: 'missing-id' },
  'Empty external profile route returns missing-id immediately',
);

assert.deepEqual(
  resolveInitialPublicExternalProfileLoadState({ profileId: 'company_profile', seedProfile: { ...activeSeedProfile, displayName: 'Seed Studio' } }),
  { loading: false, profile: { id: 'company_profile', ...activeSeedProfile, displayName: 'Seed Studio' }, error: '' },
  'Active seed profile renders immediately without loading',
);
assert.deepEqual(
  resolveInitialPublicExternalProfileLoadState({ profileId: 'company_profile', seedProfile: { ...activeSeedProfile, status: 'inactive' } }),
  { loading: false, profile: null, error: 'inactive' },
  'Inactive seed profile is unavailable immediately',
);
assert.deepEqual(
  resolveInitialPublicExternalProfileLoadState({ profileId: 'company_profile', seedProfile: { ...activeSeedProfile, isSetupProfile: true, setupRequired: true, source: 'legacyOrganization', status: 'setup' } }),
  { loading: false, profile: null, error: 'setup-profile' },
  'Setup seed profile is unavailable immediately with setup-profile error',
);

assert.deepEqual(
  resolvePublicExternalProfileLoadState({ profileId: 'company_profile', profile: { ...activeSeedProfile, displayName: 'Fresh Studio', avatar: 'https://cdn.example/fresh.jpg' } }),
  { loading: false, profile: { id: 'company_profile', ...activeSeedProfile, displayName: 'Fresh Studio', avatar: 'https://cdn.example/fresh.jpg' }, error: '' },
  'Successful active refresh keeps showing the external profile',
);
assert.deepEqual(
  resolvePublicExternalProfileLoadState({ profileId: 'company_profile', profile: null, error: 'load-failed' }),
  { loading: false, profile: null, error: 'load-failed' },
  'Load failed refresh clears any stale seed profile for visitors',
);
assert.deepEqual(
  resolvePublicExternalProfileLoadState({ profileId: 'company_profile', profile: null, error: 'missing' }),
  { loading: false, profile: null, error: 'missing' },
  'Missing refresh clears any stale seed profile after Firestore getDoc resolves',
);
assert.deepEqual(
  resolvePublicExternalProfileLoadState({ profileId: 'company_profile', profile: { ...activeSeedProfile, status: 'inactive' }, error: 'inactive' }),
  { loading: false, profile: null, error: 'inactive' },
  'Inactive refresh clears any stale seed profile',
);

const setupProfileForPublicRoute = buildLegacyOrganizationSetupProfiles({
  personalProfile: { uid: 'user_123', roles: ['company'] },
  managedProfiles: [],
})[0];
assert.equal(isManagedProfileSetupRequired(setupProfileForPublicRoute), true, 'Legacy setup profile remains marked setupRequired');
assert.deepEqual(
  resolvePublicExternalProfileLoadState({ profileId: setupProfileForPublicRoute.profileId, profile: setupProfileForPublicRoute }),
  { loading: false, profile: null, error: 'setup-profile' },
  'Setup profiles do not open as public external profile routes',
);


const legacySetupFor = (personalProfile, managedProfiles = []) => buildLegacyOrganizationSetupProfiles({
  personalProfile: { uid: 'legacy_user', ...personalProfile },
  managedProfiles,
});
const legacySetupTypesFor = (personalProfile, managedProfiles = []) => legacySetupFor(personalProfile, managedProfiles).map((profile) => profile.type);

assert.deepEqual(collectLegacyOrganizationProfileHints({ role: 'company' }), ['company'], 'role company detection creates a company hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ roles: ['company'] }), ['company'], 'roles company detection creates a company hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: 'bedrijf' }), ['company'], 'role bedrijf detection maps to company');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: 'agency' }), ['agency'], 'role agency detection creates an agency hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: 'collective' }), ['collective'], 'role collective detection creates a collective hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: 'collectief' }), ['collective'], 'role collectief detection maps to collective');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: { id: 'company' } }), ['company'], 'role object with id detection is supported');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: { value: 'agency' } }), ['agency'], 'role object with value detection is supported');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: { role: 'collectief' } }), ['collective'], 'role object with role detection is supported');
assert.deepEqual(collectLegacyOrganizationProfileHints({ role: { label: 'Bedrijf/Studio' } }), ['company'], 'role object with label Bedrijf/Studio detection maps to company');
assert.deepEqual(collectLegacyOrganizationProfileHints({ linkedCompanyName: 'Studio Naam' }), ['company'], 'linkedCompanyName without a company role creates a company hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ linkedAgencyName: 'Agency Naam' }), ['agency'], 'linkedAgencyName without an agency role creates an agency hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ linkedCompanyId: 'company_123' }), ['company'], 'linkedCompanyId creates a company hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ linkedAgencyId: 'agency_123' }), ['agency'], 'linkedAgencyId creates an agency hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ linkedCompanyStatus: 'approved' }), ['company'], 'positive linkedCompanyStatus creates a company hint');
assert.deepEqual(collectLegacyOrganizationProfileHints({ linkedAgencyStatus: 'verified' }), ['agency'], 'positive linkedAgencyStatus creates an agency hint');

assert.equal(getLegacyOrganizationPrefillDisplayName({ linkedCompanyName: '  Linked Studio  ', companyName: 'Company Name' }, 'company'), 'Linked Studio', 'linkedCompanyName is the first company prefill');
assert.equal(getLegacyOrganizationPrefillDisplayName({ companyName: '  Company Name  ' }, 'company'), 'Company Name', 'companyName is used as company prefill');
assert.equal(getLegacyOrganizationPrefillDisplayName({ linkedAgencyName: '  Linked Agency  ', agencyName: 'Agency Name' }, 'agency'), 'Linked Agency', 'linkedAgencyName is the first agency prefill');
assert.equal(getLegacyOrganizationPrefillDisplayName({ agencyName: '  Agency Name  ' }, 'agency'), 'Agency Name', 'agencyName is used as agency prefill');
assert.equal(getLegacyOrganizationPrefillDisplayName({ collectiveName: '  Collective Name  ' }, 'collective'), 'Collective Name', 'collectiveName is used as collective prefill');
assert.equal(getLegacyOrganizationPrefillDisplayName({ collectiefName: '  Collectief Naam  ' }, 'collective'), 'Collectief Naam', 'collectiefName is used as collective prefill');
assert.equal(getLegacyOrganizationPrefillDisplayName({ role: 'company', businessName: '  Business Studio  ' }, 'company'), 'Business Studio', 'businessName is fallback prefill for company role setup');
assert.equal(getLegacyOrganizationPrefillDisplayName({ role: 'agency', businessName: '  Business Agency  ' }, 'agency'), 'Business Agency', 'businessName is fallback prefill for agency role setup');
assert.equal(getLegacyOrganizationPrefillDisplayName({ displayName: 'Personal Name', name: 'Legal Name' }, 'company'), '', 'personal display fields are not reused as organization prefill');

const roleOnlyCompanySetup = legacySetupFor({ role: 'company' });
assert.equal(roleOnlyCompanySetup[0].displayName, '', 'role only company without a name keeps displayName empty');
assert.equal(roleOnlyCompanySetup[0].fallbackLabel, 'Bedrijfsprofiel', 'role only company uses Bedrijfsprofiel as fallbackLabel');
const roleOnlyAgencySetup = legacySetupFor({ role: 'agency' });
assert.equal(roleOnlyAgencySetup[0].displayName, '', 'role only agency without a name keeps displayName empty');
assert.equal(roleOnlyAgencySetup[0].fallbackLabel, 'Agency', 'role only agency uses Agency as fallbackLabel');
const roleOnlyCollectiveSetup = legacySetupFor({ role: 'collective' });
assert.equal(roleOnlyCollectiveSetup[0].displayName, '', 'role only collective without a name keeps displayName empty');
assert.equal(roleOnlyCollectiveSetup[0].fallbackLabel, 'Collectief', 'role only collective uses Collectief as fallbackLabel');
assert.equal(buildManagedProfileSetupCreateDraft(roleOnlyCompanySetup[0]).displayName, '', 'role only company setup submit draft requires the user to type a displayName');
assert.equal(buildManagedProfileSetupCreateDraft(roleOnlyAgencySetup[0]).displayName, '', 'role only agency setup submit draft requires the user to type a displayName');
assert.equal(buildManagedProfileSetupCreateDraft(roleOnlyCollectiveSetup[0]).displayName, '', 'role only collective setup submit draft requires the user to type a displayName');
assert.deepEqual(
  buildManagedProfileSetupCreateDraft(legacySetupFor({ linkedCompanyName: '  Setup Studio  ' })[0]),
  { type: 'company', displayName: 'Setup Studio', fallbackLabel: 'Bedrijfsprofiel', setupProfile: legacySetupFor({ linkedCompanyName: '  Setup Studio  ' })[0] },
  'setup profile with existing company displayName pre-fills the real create draft',
);
assert.equal(
  findManagedExternalProfileByType([{ profileId: 'real_agency', type: 'agency', displayName: 'Real Agency', ownerUid: 'owner_user', status: 'active' }], 'agency')?.profileId,
  'real_agency',
  'duplicate setup create guard finds an existing real external profile of the same type',
);
assert.equal(
  findManagedExternalProfileByType([{ ...roleOnlyAgencySetup[0], ownerUid: 'owner_user' }], 'agency'),
  null,
  'duplicate setup create guard ignores setup profiles so setup placeholders do not count as saved profiles',
);

assert.deepEqual(legacySetupTypesFor({ role: 'company' }), ['company'], 'user with role company gets setup company when no real company exists');
assert.deepEqual(legacySetupTypesFor({ role: 'bedrijf' }), ['company'], 'user with role bedrijf gets setup company when no real company exists');
assert.deepEqual(legacySetupTypesFor({ role: 'agency' }), ['agency'], 'user with role agency gets setup agency when no real agency exists');
assert.deepEqual(legacySetupTypesFor({ role: 'collective' }), ['collective'], 'user with role collective gets setup collective when no real collective exists');
assert.deepEqual(legacySetupTypesFor({ role: 'collectief' }), ['collective'], 'user with role collectief gets setup collective when no real collective exists');
assert.equal(legacySetupFor({ linkedCompanyName: 'Studio Luna' })[0].displayName, 'Studio Luna', 'linkedCompanyName prefill is copied into setup company');
assert.equal(legacySetupFor({ companyName: 'Company Luna' })[0].displayName, 'Company Luna', 'companyName prefill is copied into setup company');
assert.equal(legacySetupFor({ linkedAgencyName: 'Nova Agency' })[0].displayName, 'Nova Agency', 'linkedAgencyName prefill is copied into setup agency');
assert.equal(legacySetupFor({ agencyName: 'Agency Nova' })[0].displayName, 'Agency Nova', 'agencyName prefill is copied into setup agency');
assert.equal(legacySetupFor({ collectiveName: 'Project Collective' })[0].displayName, 'Project Collective', 'collectiveName prefill is copied into setup collective');
assert.equal(legacySetupFor({ collectiefName: 'Project Collectief' })[0].displayName, 'Project Collectief', 'collectiefName prefill is copied into setup collective');
assert.equal(legacySetupFor({ role: 'company', businessName: 'Business Studio' })[0].displayName, 'Business Studio', 'businessName is fallback displayName for company role setup');
assert.equal(legacySetupFor({ role: 'agency', businessName: 'Business Agency' })[0].displayName, 'Business Agency', 'businessName is fallback displayName for agency role setup');

const existingCompanyProfile = { profileId: 'real_company', type: 'company', kind: 'company', displayName: 'Real Company', ownerUid: 'legacy_user', status: 'active', isPersonal: false };
assert.equal(hasManagedExternalProfileOfType([existingCompanyProfile], 'company'), true, 'real external profile of the same type is detected');
assert.equal(hasManagedExternalProfileOfType([{ ...existingCompanyProfile, isSetupProfile: true, setupRequired: true, source: 'legacyOrganization' }], 'company'), false, 'setup profile is not treated as a real external profile');
assert.deepEqual(legacySetupFor({ role: 'company' }, [existingCompanyProfile]), [], 'no setup profile is created if a real external profile of the same type exists');
assert.deepEqual(legacySetupTypesFor({ role: 'company', linkedCompanyName: 'Studio', companyName: 'Other Studio' }), ['company'], 'multiple signals for the same type create a maximum of one setup profile');

const legacyCompanySetup = legacySetupFor({ role: 'company' })[0];
assert.equal(legacyCompanySetup.setupRequired, true, 'setup profile has setupRequired true');
assert.equal(legacyCompanySetup.isSetupProfile, true, 'setup profile has isSetupProfile true');
assert.equal(legacyCompanySetup.source, 'legacyOrganization', 'setup profile source is legacyOrganization');
assert.equal(legacyCompanySetup.profileId, 'legacy_company_legacy_user', 'setup profile uses temporary legacy profileId');
assert.equal(legacyCompanySetup.status, 'setup', 'setup profile status is setup rather than active');
assert.equal(isManagedProfileSetupRequired(legacyCompanySetup), true, 'setup required helper recognizes legacy setup profiles');
assert.equal(hasManagedExternalProfileOfType([legacyCompanySetup], 'company'), false, 'setup profiles are not marked as real active external profiles');



const setupCompanyProfile = {
  profileId: 'legacy_company_owner_multi',
  id: 'legacy_company_owner_multi',
  ownerUid: 'owner_multi',
  type: 'company',
  status: 'setup',
  source: 'legacyOrganization',
  isSetupProfile: true,
  setupRequired: true,
};
assert.equal(isSetupManagedProfile(setupCompanyProfile), true, 'full legacy organization setup profile is detected');
assert.equal(isSetupManagedProfile({ profileId: 'real_company', type: 'company', status: 'active', ownerUid: 'owner_multi' }), false, 'active external managed profile is not treated as setup');
assert.equal(isSetupManagedProfile({ profileId: 'legacy_company_owner_multi', type: 'company', status: 'active' }), true, 'legacy_ profileId defensively marks setup profile');
assert.equal(isSetupManagedProfile({ profileId: 'company_setup_required', setupRequired: true }), true, 'setupRequired true blocks setup profile publishing');
assert.equal(isSetupManagedProfile({ profileId: 'company_setup_flag', isSetupProfile: true }), true, 'isSetupProfile true blocks setup profile publishing');
assert.equal(isSetupManagedProfile({ profileId: 'company_legacy_source', source: 'legacyOrganization' }), true, 'legacyOrganization source blocks setup profile publishing');
assert.equal(isSetupManagedProfile({ profileId: 'company_setup_status', status: 'setup' }), true, 'setup status blocks setup profile publishing');
assert.equal(isLegacySetupProfileId('legacy_company_owner_multi'), true, 'legacy_ ids are recognized as setup ids');
assert.equal(assertCanPublishWithManagedProfile(setupCompanyProfile).ok, false, 'setup profile publish guard returns block status');
assert.equal(assertCanPublishWithManagedProfile({ profileId: 'company_active', type: 'company', status: 'active', ownerUid: 'owner_multi' }).ok, true, 'active external managed profile can publish');
assert.equal(assertCanPublishWithManagedProfile({ profileId: 'owner_multi', uid: 'owner_multi', isPersonal: true }).ok, true, 'personal profile can publish');
const setupPublishCopy = getSetupProfilePublishBlockCopy(setupCompanyProfile);
assert.equal(setupPublishCopy.title, 'Stel dit profiel eerst in', 'setup publish block title matches required copy');
assert.match(setupPublishCopy.message, /Dit profiel is nog niet openbaar/, 'setup publish block message explains profile is not public');
assert.equal(setupPublishCopy.ctaLabel, 'Profiel instellen', 'setup publish block CTA label matches required copy');

assert.equal(shouldShowProfileInDiscover({ uid: 'viewer' }, 'viewer'), false, 'Discover hides profile with own uid');
assert.equal(shouldShowProfileInDiscover({ ownerUid: 'viewer', profileId: 'company_own', type: 'company', status: 'active' }, 'viewer'), false, 'Discover hides own external profile by ownerUid');
assert.equal(shouldShowProfileInDiscover({ profileId: 'viewer', type: 'company', status: 'active' }, 'viewer'), false, 'Discover hides profile with own profileId');
assert.equal(shouldShowProfileInDiscover({ profileId: 'setup_required', setupRequired: true, type: 'company' }, 'viewer'), false, 'Discover hides setupRequired profile');
assert.equal(shouldShowProfileInDiscover({ profileId: 'setup_flag', isSetupProfile: true, type: 'company' }, 'viewer'), false, 'Discover hides isSetupProfile profile');
assert.equal(shouldShowProfileInDiscover({ profileId: 'legacy_source', source: 'legacyOrganization', type: 'company' }, 'viewer'), false, 'Discover hides legacyOrganization setup profile');
assert.equal(shouldShowProfileInDiscover({ profileId: 'inactive_company', ownerUid: 'other', type: 'company', status: 'inactive' }, 'viewer'), false, 'Discover hides inactive external profile');
assert.equal(shouldShowProfileInDiscover({ profileId: 'hidden_user', ownerUid: 'other', hidden: true, displayName: 'Hidden User' }, 'viewer'), false, 'Discover hides hidden public users');
assert.equal(shouldShowProfileInDiscover({ profileId: 'private_user', ownerUid: 'other', visibility: 'private', displayName: 'Private User' }, 'viewer'), false, 'Discover hides private visibility public users');
assert.equal(shouldShowProfileInDiscover({ profileId: 'private_public_user', ownerUid: 'other', publicVisibility: 'private', displayName: 'Private Public User' }, 'viewer'), false, 'Discover hides private publicVisibility public users');
assert.equal(shouldShowProfileInDiscover({ profileId: 'active_company', ownerUid: 'other', type: 'company', status: 'active', displayName: 'Other Studio' }, 'viewer'), true, 'Discover shows active external profile from another user');

assert.equal(shouldShowPostInDiscover({ authorId: 'viewer', title: 'Own authorId' }, 'viewer'), false, 'Discover hides own post by authorId');
assert.equal(shouldShowPostInDiscover({ authorUid: 'viewer', title: 'Own authorUid' }, 'viewer'), false, 'Discover hides own post by authorUid');
assert.equal(shouldShowPostInDiscover({ authorOwnerUid: 'viewer', authorProfileId: 'company_own', title: 'Own company' }, 'viewer'), false, 'Discover hides own external post by authorOwnerUid');
assert.equal(shouldShowPostInDiscover({ ownerUid: 'viewer', authorProfileId: 'agency_own', title: 'Own agency' }, 'viewer'), false, 'Discover hides own external post by ownerUid');
assert.equal(shouldShowPostInDiscover({ authorProfileId: 'legacy_company_viewer', authorOwnerUid: 'other', title: 'Setup post' }, 'viewer'), false, 'Discover hides posts with legacy setup authorProfileId');
assert.equal(shouldShowPostInDiscover({ authorId: 'other', hidden: true, title: 'Hidden post' }, 'viewer'), false, 'Discover hides hidden posts');
assert.equal(shouldShowPostInDiscover({ authorId: 'other', status: 'inactive', title: 'Inactive post' }, 'viewer'), false, 'Discover hides inactive posts');
assert.equal(shouldShowPostInDiscover({ authorId: 'other', visibility: 'private', title: 'Private post' }, 'viewer'), false, 'Discover hides private posts');
assert.equal(shouldShowPostInDiscover({ authorId: 'other', deactivatedReason: 'underage', title: 'Underage deactivated post' }, 'viewer'), false, 'Discover hides underage deactivated posts');
assert.equal(shouldShowPostInDiscover({ authorId: 'other', authorOwnerUid: 'other', authorProfileId: 'company_other', title: 'Other company' }, 'viewer'), true, 'Discover shows external profile post from another user');

assert.equal(getPublicExternalProfileTarget(setupCompanyProfile), null, 'legacy setup profile id is not a public external profile target');
assert.equal(getPublicExternalProfileTarget({ profileId: 'active_company', ownerUid: 'other', type: 'company', status: 'active', displayName: 'Other Studio' }), 'active_company', 'active real external profile is a public target');
assert.equal(shouldShowManagedProfileSetupProfile({ profile: setupCompanyProfile, currentUserId: 'owner_multi', ownerUid: 'owner_multi' }), true, 'owner-only setup profile remains locally visible');

console.log('PASS managedProfiles.logic.test');
