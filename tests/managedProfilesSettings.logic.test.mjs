import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLegacyOrganizationSetupProfiles,
  buildManagedProfileSetupCreateDraft,
  buildManagedProfilesSettingsModel,
  findManagedExternalProfileByType,
  getManagedProfileDisplayName,
  getManagedProfileSettingsAction,
  getManagedProfileBio,
  getManagedProfileAvatar,
  getManagedProfilePrefillDisplayName,
  getManagedProfileSetupActionLabel,
  getManagedProfileSetupDescription,
  getManagedProfileSetupStatusLabel,
  getOwnerVisibleManagedProfileSetupProfiles,
  getManagedProfileTypeLabel,
  personalProfileHasOrganizationHints,
} from '../src/utils/managedProfiles.js';


const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
assert.match(
  appSource,
  /function SetupProfileOverlay\(\{ profile = \{\}, onOpenSetupProfile \}\)[\s\S]*?onClick=\{onOpenSetupProfile\}/,
  'Header setup overlay CTA uses the explicit setup handler instead of the generic profile edit handler',
);
assert.doesNotMatch(
  appSource,
  /function SetupProfileOverlay\(\{ profile = \{\}, onOpenSettings \}\)/,
  'Header setup overlay no longer receives the personal profile edit onOpenSettings handler',
);
assert.match(
  appSource,
  /onOpenManagedProfileSetup=\{\(setupProfile\) => \{[\s\S]*?setPendingManagedProfileSetup\(setupProfile \|\| null\);[\s\S]*?setShowEditProfile\(false\);[\s\S]*?setShowSettingsModal\(true\);[\s\S]*?\}\}/,
  'Own profile route wires header setup CTA to Settings while explicitly keeping the personal profile editor closed',
);
assert.match(
  appSource,
  /<SetupProfileOverlay profile=\{activeSwitcherProfile\} onOpenSetupProfile=\{\(\) => onOpenManagedProfileSetup\?\.\(activeSwitcherProfile\)\}/,
  'Header setup CTA passes the selected setupProfile to the explicit setup handler',
);
assert.match(
  appSource,
  /initialSetupProfile=\{pendingManagedProfileSetup\}/,
  'Settings modal receives the setup profile selected from the header CTA',
);
assert.match(
  appSource,
  /useEffect\(\(\) => \{[\s\S]*?if \(!initialSetupProfile\) return;[\s\S]*?openSetupProfileCreateFlow\(initialSetupProfile\);[\s\S]*?\}/,
  'Settings modal starts the local setup create flow when opened from the header setup CTA',
);
assert.match(
  appSource,
  /const openSetupProfileCreateFlow = useCallback\(\(setupProfile\) => \{[\s\S]*?buildManagedProfileSetupCreateDraft\(setupProfile\);[\s\S]*?setCreateType\(setupDraft\.type\);[\s\S]*?setCreateDisplayName\(setupDraft\.displayName\);[\s\S]*?setCreateFlowOpen\(true\);/,
  'Settings setup card and header-selected setup profile prefill type/displayName locally before any submit',
);
const headerSetupHandlerSource = appSource.match(
  /onOpenManagedProfileSetup=\{\(setupProfile\) => \{[\s\S]*?setShowSettingsModal\(true\);[\s\S]*?\}\}/,
)?.[0] || '';
assert.ok(headerSetupHandlerSource, 'Header setup handler source is present for write-safety checks');
assert.doesNotMatch(
  headerSetupHandlerSource,
  /onCreateManagedProfile|createManagedExternalProfile|setDoc|addDoc|uploadBytes/,
  'Header setup CTA only opens Settings and does not call create/write helpers',
);

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
  { profileId: 'studio_luna', displayName: 'Studio Luna', type: 'company', kind: 'company', isPersonal: false, avatar: 'https://cdn.example/studio.jpg' },
  { profileId: 'nova_agency', displayName: 'Nova Agency', type: 'agency', kind: 'agency', isPersonal: false },
  { profileId: 'project_x', displayName: 'Project X', type: 'collective', kind: 'collective', isPersonal: false },
  { profileId: 'second_studio', displayName: 'Tweede Studio', type: 'company', kind: 'company', isPersonal: false },
]);

assert.equal(settingsWithMultipleExternal.externalProfiles.length, 4, 'Settings model keeps all external profiles as a list');
assert.equal(getManagedProfileAvatar(settingsWithMultipleExternal.externalProfiles[0]), 'https://cdn.example/studio.jpg', 'Settings model exposes managed external profile avatar for Mijn profielen');
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
assert.equal(getManagedProfilePrefillDisplayName({ collectiefName: 'Collectief Hint' }, 'collective'), 'Collectief Hint', 'Collective create flow can prefill from an existing collective hint');



const settingsWithLegacyCompanySetup = buildManagedProfilesSettingsModel([{ ...personalProfile, roles: ['company'], companyName: 'Studio Legacy' }]);
assert.equal(settingsWithLegacyCompanySetup.setupProfiles.length, 1, 'Settings model returns setupProfiles for legacy organization hints');
assert.equal(settingsWithLegacyCompanySetup.setupProfiles[0].type, 'company', 'Settings model setup profile keeps the legacy company type');
assert.equal(settingsWithLegacyCompanySetup.setupProfiles[0].displayName, 'Studio Legacy', 'Settings model setup profile includes the company prefill name');
assert.equal(settingsWithLegacyCompanySetup.setupProfiles[0].setupRequired, true, 'Settings model setup profile is marked setupRequired');
assert.equal(settingsWithLegacyCompanySetup.setupProfiles[0].isSetupProfile, true, 'Settings model setup profile is marked isSetupProfile');
assert.equal(settingsWithLegacyCompanySetup.setupProfiles[0].source, 'legacyOrganization', 'Settings model setup profile source is legacyOrganization');
assert.equal(settingsWithLegacyCompanySetup.setupProfiles[0].profileId, 'legacy_company_user_1', 'Settings model setup profile uses a temporary legacy id');
assert.equal(settingsWithLegacyCompanySetup.externalProfiles.length, 0, 'Settings model keeps setup profiles separate from real externalProfiles');
assert.equal(settingsWithLegacyCompanySetup.hasExternalProfiles, false, 'Settings model does not count setup profiles as real external profiles');

assert.equal(getManagedProfileDisplayName(settingsWithLegacyCompanySetup.setupProfiles[0]), 'Studio Legacy', 'Setup profile with displayName uses displayName as its provisional name');
assert.equal(getManagedProfileSetupStatusLabel(settingsWithLegacyCompanySetup.setupProfiles[0]), 'Nog niet openbaar', 'Setup profile exposes the non-public status badge copy');
assert.equal(
  getManagedProfileSetupDescription(settingsWithLegacyCompanySetup.setupProfiles[0]),
  'Dit profiel is klaargezet op basis van je bestaande gegevens. Stel het in om het apart te beheren en ermee te publiceren.',
  'Setup profile with company name receives the general existing-data overlay copy',
);
assert.equal(getManagedProfileSetupActionLabel(settingsWithLegacyCompanySetup.setupProfiles[0]), 'Bedrijfsprofiel instellen', 'Company setup profile receives the company setup action label');

const roleOnlyCompanySetup = buildManagedProfilesSettingsModel([{ ...personalProfile, roles: ['company'], displayName: 'Personal Name' }]).setupProfiles[0];
assert.equal(getManagedProfileDisplayName(roleOnlyCompanySetup), 'Bedrijfsprofiel', 'Setup profile without displayName uses fallbackLabel instead of the personal displayName');
assert.equal(
  getManagedProfileSetupDescription(roleOnlyCompanySetup),
  'Je hebt eerder Bedrijf/Studio als rol gekozen. Stel dit profiel in om het apart te beheren en ermee te publiceren.',
  'Role-only company setup profile receives Bedrijf/Studio copy',
);
const roleOnlyAgencySetup = buildManagedProfilesSettingsModel([{ ...personalProfile, roles: ['agency'], displayName: 'Personal Name' }]).setupProfiles[0];
assert.equal(getManagedProfileDisplayName(roleOnlyAgencySetup), 'Agency', 'Role-only agency setup profile uses the agency fallbackLabel');
assert.equal(
  getManagedProfileSetupDescription(roleOnlyAgencySetup),
  'Je hebt eerder Agency als rol gekozen. Stel dit profiel in om het apart te beheren en ermee te publiceren.',
  'Role-only agency setup profile receives Agency copy',
);
assert.equal(getManagedProfileSetupActionLabel(roleOnlyAgencySetup), 'Agency instellen', 'Agency setup profile receives the agency action label');
const roleOnlyCollectiveSetup = buildManagedProfilesSettingsModel([{ ...personalProfile, roles: ['collective'], displayName: 'Personal Name' }]).setupProfiles[0];
assert.equal(getManagedProfileDisplayName(roleOnlyCollectiveSetup), 'Collectief', 'Role-only collective setup profile uses the collective fallbackLabel');
assert.equal(
  getManagedProfileSetupDescription(roleOnlyCollectiveSetup),
  'Je hebt eerder Collectief als rol gekozen. Stel dit profiel in om het apart te beheren en ermee te publiceren.',
  'Role-only collective setup profile receives Collectief copy',
);
assert.equal(getManagedProfileSetupActionLabel(roleOnlyCollectiveSetup), 'Collectief instellen', 'Collective setup profile receives the collective action label');

assert.deepEqual(
  buildManagedProfileSetupCreateDraft({ type: 'company', displayName: '  Studio Prefill  ', fallbackLabel: 'Bedrijfsprofiel' }),
  { type: 'company', displayName: 'Studio Prefill', fallbackLabel: 'Bedrijfsprofiel', setupProfile: { type: 'company', displayName: '  Studio Prefill  ', fallbackLabel: 'Bedrijfsprofiel' } },
  'Setup draft trims the setup displayName prefill before submit',
);
assert.equal(
  buildManagedProfileSetupCreateDraft(roleOnlyCompanySetup).displayName,
  '',
  'Role-only company setup draft keeps displayName empty so the personal displayName is not used as a company name',
);
assert.equal(
  buildManagedProfileSetupCreateDraft(roleOnlyAgencySetup).displayName,
  '',
  'Role-only agency setup draft keeps displayName empty until the user fills it',
);
assert.equal(
  buildManagedProfileSetupCreateDraft(roleOnlyCollectiveSetup).displayName,
  '',
  'Role-only collective setup draft keeps displayName empty until the user fills it',
);
assert.equal(
  findManagedExternalProfileByType(settingsWithMultipleExternal.externalProfiles, 'company')?.profileId,
  'studio_luna',
  'Duplicate setup create guard can find an existing real external company profile',
);
assert.equal(
  findManagedExternalProfileByType([roleOnlyCompanySetup], 'company'),
  null,
  'Duplicate setup create guard ignores temporary setup profiles',
);
assert.match(
  appSource,
  /createSetupProfile \? findManagedExternalProfileByType\(externalProfiles, validation\.type\) : null/,
  'Settings create submit checks existing real external profiles before saving a setup profile',
);
assert.match(
  appSource,
  /if \(createPending\) return;/,
  'Settings create submit exits early while saving to prevent double submit',
);
assert.match(
  appSource,
  /setupProfile: createSetupProfile/,
  'Settings create submit passes the pending setup profile only when the user consciously saves',
);
assert.match(
  appSource,
  /setPendingManagedProfileSetup\(null\);[\s\S]*?setRequestedActiveProfileId\(createdProfile\.profileId\)/,
  'Successful setup create clears pending setup state and selects the new real managed profile',
);
assert.match(
  appSource,
  /setCreateError\(error\?\.message \|\| 'Opslaan mislukt\. Probeer het opnieuw\.'\)/,
  'Failed setup create keeps setup state open and shows the existing error style',
);
assert.doesNotMatch(
  headerSetupHandlerSource,
  /onCreateManagedProfile|createManagedExternalProfile|setDoc|addDoc|uploadBytes/,
  'Opening settings from the header setup CTA still does not write to Firestore',
);

assert.deepEqual(
  getOwnerVisibleManagedProfileSetupProfiles({ setupProfiles: [roleOnlyCompanySetup], currentUserId: 'user_1', ownerUid: 'user_1' }).map((profile) => profile.profileId),
  ['legacy_company_user_1'],
  'Setup profile is visible to the owner',
);

assert.deepEqual(
  getOwnerVisibleManagedProfileSetupProfiles({ setupProfiles: [roleOnlyCompanySetup], currentUserId: 'visitor_1', ownerUid: 'user_1' }),
  [],
  'Setup profile is hidden from visitors',
);


const settingsWithExistingCompany = buildManagedProfilesSettingsModel([
  { ...personalProfile, roles: ['company'], companyName: 'Studio Legacy' },
  { profileId: 'real_company', displayName: 'Real Company', type: 'company', kind: 'company', isPersonal: false },
]);
assert.deepEqual(settingsWithExistingCompany.setupProfiles, [], 'Settings model does not return setup profile when a real external profile of the same type exists');
assert.deepEqual(
  buildLegacyOrganizationSetupProfiles({ personalProfile: { ...personalProfile, roles: ['agency'], businessName: 'Business Agency' }, managedProfiles: [] }).map((profile) => profile.displayName),
  ['Business Agency'],
  'Settings helper import confirms businessName fallback is available for legacy agency setup',
);

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
  getManagedProfileAvatar({ profileId: 'studio_luna', type: 'company', avatar: '  https://cdn.example/updated.jpg  ' }),
  'https://cdn.example/updated.jpg',
  'Settings model can surface the managed external profile avatar immediately after edits',
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
