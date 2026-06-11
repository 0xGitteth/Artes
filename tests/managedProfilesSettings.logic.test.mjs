import assert from 'node:assert/strict';
import {
  buildManagedProfilesSettingsModel,
  getManagedProfileDisplayName,
  getManagedProfileSettingsAction,
  getManagedProfileBio,
  getManagedProfilePrefillDisplayName,
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
assert.equal(getManagedProfileDisplayName({ email: 'profile@example.com' }), 'Naamloos profiel', 'Email-only profile does not use account identity as display fallback');
assert.equal(getManagedProfileDisplayName({ name: '', username: '', email: 'profile@example.com' }), 'Naamloos profiel', 'Email is not returned when profile display fields are empty');
assert.equal(getManagedProfileDisplayName({}), 'Naamloos profiel', 'Profiles without display copy receive a safe fallback');
assert.equal(personalProfileHasOrganizationHints({ linkedCompanyStatus: 'none' }), false, 'Neutral linked company status does not trigger organization guidance');
assert.equal(personalProfileHasOrganizationHints({ linkedAgencyStatus: 'unlinked' }), false, 'Neutral linked agency status does not trigger organization guidance');
assert.equal(personalProfileHasOrganizationHints({ linkedCompanyStatus: 'rejected' }), false, 'Rejected linked company status does not trigger organization guidance');
assert.equal(personalProfileHasOrganizationHints({ linkedAgencyStatus: 'unknown' }), false, 'Unknown linked agency status does not trigger organization guidance');
assert.equal(personalProfileHasOrganizationHints({ linkedCompanyStatus: 'approved' }), true, 'Positive linked company status still triggers organization guidance');
assert.equal(personalProfileHasOrganizationHints({ linkedAgencyStatus: 'verified' }), true, 'Positive linked agency status still triggers organization guidance');
assert.equal(personalProfileHasOrganizationHints({ linkedCompanyId: 'company_123' }), true, 'Real linked company ids still trigger organization guidance');
assert.equal(personalProfileHasOrganizationHints({ linkedAgencyId: 'none' }), false, 'Neutral linked agency id does not trigger organization guidance');


assert.equal(getManagedProfilePrefillDisplayName({ linkedCompanyName: '  Studio Hint  ' }, 'company'), 'Studio Hint', 'Company create flow can prefill from an existing safe company hint');
assert.equal(getManagedProfilePrefillDisplayName({ linkedAgencyName: '  Agency Hint  ' }, 'agency'), 'Agency Hint', 'Agency create flow can prefill from an existing safe agency hint');
assert.equal(getManagedProfilePrefillDisplayName({ linkedCompanyName: 'Studio Hint' }, 'collective'), 'Studio Hint', 'Collective create flow may reuse a generic organization name hint without migrating data');


const activeExternalProfile = settingsWithMultipleExternal.externalProfiles[1];
const settingsWithActiveExternal = buildManagedProfilesSettingsModel([
  personalProfile,
  { profileId: 'studio_luna', displayName: 'Studio Luna', type: 'company', kind: 'company', isPersonal: false },
  activeExternalProfile,
], activeExternalProfile);
assert.equal(settingsWithActiveExternal.personalProfile.settingsAction.isActive, false, 'Personal profile is not marked active when an external profile is active');
assert.equal(settingsWithActiveExternal.personalProfile.settingsAction.actionLabel, 'Beheren als', 'Inactive personal profile can be chosen with Beheren als');
assert.equal(settingsWithActiveExternal.externalProfiles[1].settingsAction.isActive, true, 'Active external profile is marked active in settings helper');
assert.equal(settingsWithActiveExternal.externalProfiles[1].settingsAction.statusLabel, 'Actief', 'Active profile shows Actief status');
assert.equal(settingsWithActiveExternal.externalProfiles[1].settingsAction.actionLabel, '', 'Active profile does not show the Beheren als action');
assert.deepEqual(
  getManagedProfileSettingsAction(personalProfile, personalProfile),
  { isActive: true, statusLabel: 'Actief', actionLabel: '' },
  'Settings action helper returns Actief for the active personal profile',
);

assert.equal(
  getManagedProfileBio({ profileId: 'studio_luna', type: 'company', bio: '  Studio voor campagnebeeld  ' }),
  'Studio voor campagnebeeld',
  'Settings model can surface the managed external profile bio immediately after edits',
);
assert.equal(
  settingsWithMultipleExternal.externalProfiles.every((profile) => profile.isPersonal === false),
  true,
  'Personal managed profile remains separate from editable external profiles in settings',
);

console.log('PASS managedProfilesSettings.logic.test');
