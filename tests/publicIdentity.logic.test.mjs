import assert from 'node:assert/strict';
import {
  resolveOnboardingDisplayNameState,
  resolvePublicDisplayName,
  resolvePublicDisplayNameSeed,
  shouldIncludeGoogleDisplayNameSeed,
} from '../src/utils/publicIdentity.js';

assert.equal(resolvePublicDisplayName({ displayName: 'Public Name', username: 'handle' }), 'Public Name');
assert.equal(resolvePublicDisplayName({ username: '@handle' }), 'handle');
assert.equal(resolvePublicDisplayName({}), 'Gebruiker');
assert.equal(resolvePublicDisplayName({ authDisplayName: 'Auth Name' }), 'Gebruiker');
assert.equal(resolvePublicDisplayName({ email: 'legal@example.com' }), 'Gebruiker');
assert.equal(resolvePublicDisplayName({ uid: 'uid_legal_name' }), 'Gebruiker');

assert.equal(
  resolvePublicDisplayNameSeed({ appPublicDisplayName: 'Saved App Name', diditDisplayName: 'Legal Name', googleDisplayName: 'Google Name' }),
  'Saved App Name',
);
assert.equal(
  resolvePublicDisplayNameSeed({ publicProfile: { displayName: 'Existing Public Name' }, diditDisplayName: 'Legal Name', googleDisplayName: 'Google Name' }),
  'Existing Public Name',
);
assert.equal(resolvePublicDisplayNameSeed({ diditDisplayName: 'Legal Seed' }), 'Legal Seed');
assert.equal(resolvePublicDisplayNameSeed({ googleDisplayName: 'Google Seed' }), 'Google Seed');
assert.equal(
  resolvePublicDisplayNameSeed({ appPublicDisplayName: 'User Edited Name', diditDisplayName: 'New Legal Name', googleDisplayName: 'New Google Name' }),
  'User Edited Name',
);

assert.equal(
  resolveOnboardingDisplayNameState({ currentDisplayName: 'Google Seed', appPublicDisplayName: 'Loaded App Name', googleDisplayName: 'Google Seed' }),
  'Loaded App Name',
);
assert.equal(
  resolveOnboardingDisplayNameState({ currentDisplayName: 'Google Seed', publicProfile: { displayName: 'Loaded Public Name' }, googleDisplayName: 'Google Seed' }),
  'Loaded Public Name',
);
assert.equal(
  resolveOnboardingDisplayNameState({ currentDisplayName: 'Typed Name', fieldEdited: true, appPublicDisplayName: 'Loaded App Name', publicProfile: { displayName: 'Loaded Public Name' }, googleDisplayName: 'Google Seed' }),
  'Typed Name',
);
assert.equal(
  resolveOnboardingDisplayNameState({ currentDisplayName: '', googleDisplayName: 'Google Seed' }),
  'Google Seed',
);

assert.equal(shouldIncludeGoogleDisplayNameSeed({ isGoogleUser: true, profileLoading: true, profile: {}, googleDisplayName: 'Google Seed' }), false);
assert.equal(shouldIncludeGoogleDisplayNameSeed({ isGoogleUser: true, profileLoading: false, profile: null, googleDisplayName: 'Google Seed' }), false);
assert.equal(shouldIncludeGoogleDisplayNameSeed({ isGoogleUser: true, profileLoading: false, profile: { displayName: 'Saved App Name' }, googleDisplayName: 'Google Seed' }), false);
assert.equal(shouldIncludeGoogleDisplayNameSeed({ isGoogleUser: false, profileLoading: false, profile: {}, googleDisplayName: 'Google Seed' }), false);
assert.equal(shouldIncludeGoogleDisplayNameSeed({ isGoogleUser: true, profileLoading: false, profile: {}, googleDisplayName: 'Google Seed' }), true);

console.log('PASS publicIdentity.logic.test');
