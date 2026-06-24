import assert from 'node:assert/strict';
import { resolvePublicDisplayName, resolvePublicDisplayNameSeed } from '../src/utils/publicIdentity.js';

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

console.log('PASS publicIdentity.logic.test');
