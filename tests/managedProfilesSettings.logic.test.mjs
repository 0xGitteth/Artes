import assert from 'node:assert/strict';
import {
  buildManagedProfilesSettingsModel,
  getManagedProfileDisplayName,
  getManagedProfileTypeLabel,
  personalProfileHasOrganizationHints,
} from '../src/utils/managedProfiles.js';

const personalProfile = {
  uid: 'user_1',
  profileId: 'user_1',
  displayName: 'Gitte',
  roles: ['assistant'],
  isPersonal: true,
  kind: 'personal',
};

const settingsWithoutExternal = buildManagedProfilesSettingsModel([personalProfile]);
assert.equal(settingsWithoutExternal.personalProfile.profileId, 'user_1', 'Personal profile is selected for the settings overview');
assert.deepEqual(settingsWithoutExternal.externalProfiles, [], 'No external profiles creates an empty external list');
assert.equal(settingsWithoutExternal.hasExternalProfiles, false, 'Empty external profile list is explicitly exposed');
assert.equal(settingsWithoutExternal.hasPersonalOrganizationHints, false, 'Regular personal roles do not show organization guidance');
assert.equal(getManagedProfileTypeLabel(personalProfile), 'Persoonlijk profiel', 'Personal profile label is user-facing Dutch copy');
assert.equal(getManagedProfileDisplayName(personalProfile), 'Gitte', 'Display name is shown for personal profiles');

const settingsWithMultipleExternal = buildManagedProfilesSettingsModel([
  personalProfile,
  { profileId: 'studio_luna', displayName: 'Studio Luna', type: 'company', kind: 'company', isPersonal: false },
  { profileId: 'nova_agency', displayName: 'Nova Agency', type: 'agency', kind: 'agency', isPersonal: false },
  { profileId: 'project_x', displayName: 'Project X', type: 'collective', kind: 'collective', isPersonal: false },
  { profileId: 'second_studio', displayName: 'Tweede Studio', type: 'company', kind: 'company', isPersonal: false },
]);

assert.equal(settingsWithMultipleExternal.externalProfiles.length, 4, 'Settings model keeps all external profiles as a list');
assert.deepEqual(
  settingsWithMultipleExternal.externalProfiles.map((profile) => profile.profileId),
  ['studio_luna', 'nova_agency', 'project_x', 'second_studio'],
  'Multiple companies, agencies, and collectives remain visible in input order',
);
assert.deepEqual(
  settingsWithMultipleExternal.externalProfiles.map((profile) => getManagedProfileTypeLabel(profile)),
  ['Bedrijfsprofiel', 'Agency', 'Collectief', 'Bedrijfsprofiel'],
  'External profile type labels match the PR 4 terminology',
);

assert.equal(personalProfileHasOrganizationHints({ roles: ['company'] }), true, 'Company role on the personal profile is recognized');
assert.equal(personalProfileHasOrganizationHints({ roles: [{ label: 'Agency' }] }), true, 'Agency role object on the personal profile is recognized');
assert.equal(personalProfileHasOrganizationHints({ role: 'Bedrijf' }), true, 'Dutch Bedrijf role on the personal profile is recognized');
assert.equal(personalProfileHasOrganizationHints({ linkedCompanyName: 'Studio Luna' }), true, 'Existing linked company fields are recognized');
assert.equal(personalProfileHasOrganizationHints({ linkedAgencyName: 'Nova Agency' }), true, 'Existing linked agency fields are recognized');
assert.equal(personalProfileHasOrganizationHints({ roles: ['model'], linkedAgencyName: '' }), false, 'Empty organization fields do not trigger the explanation');
assert.equal(getManagedProfileDisplayName({}), 'Naamloos profiel', 'Profiles without display copy receive a safe fallback');

console.log('PASS managedProfilesSettings.logic.test');
