import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/ArtesApp.jsx', 'utf8');
const firebase = fs.readFileSync('src/firebase.js', 'utf8');
const client = fs.readFileSync('src/services/firebaseClient.js', 'utf8');
const backfill = fs.readFileSync('functions/scripts/backfillPublicUsersFromUsers.js', 'utf8');

assert.match(app, /import \{ ROLE_OPTIONS, normalizeProfileRoles, normalizeRoleValue, toggleProfileRole \} from '\.\/utils\/roles';/);
assert.match(app, /setRoles\(\(prev\) => toggleProfileRole\(prev, r\.id\)\)/);
assert.match(app, /roles: normalizeProfileRoles\(formData\.roles, \{ fallbackToFan: true \}\)/);
assert.match(app, /roles: normalizeProfileRoles\(roles, \{ fallbackToFan: true \}\)/);
assert.match(app, /const canUpload = profile && normalizeProfileRoles\(profile\.roles\)\.some\(\(role\) => role !== 'fan'\);/);
assert.doesNotMatch(app, /!profile\.roles\.includes\('fan'\) \|\| profile\.roles\.length > 1/);
assert.doesNotMatch(app, /roles: \['photographer', 'fan'\]/);
assert.match(app, /const roles = normalizeProfileRoles\(/);

assert.match(firebase, /safeData\.roles = normalizeProfileRoles\(safeData\.roles, \{ fallbackToFan: true \}\)/);
assert.match(client, /normalizeProfileRoles/);
assert.match(client, /roles: normalizeProfileRoles\(safeData\.roles\)/);
assert.match(backfill, /normalizeProfileRoles/);
assert.match(backfill, /roles: normalizeProfileRoles\(cleanStringArray\(userData\.roles\)\)/);

console.log('profileRoles.source.test.mjs passed');
