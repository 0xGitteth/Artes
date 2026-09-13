import assert from 'node:assert/strict';
import {
  hasExclusiveFanProfileRole,
  normalizeProfileRoles,
  toggleProfileRole,
} from '../src/utils/roles.js';
import { normalizePublicProfileField } from '../src/utils/publicProfileFieldNormalization.js';

assert.deepEqual(normalizeProfileRoles(['fan']), ['fan']);
assert.deepEqual(toggleProfileRole(['photographer', 'artist'], 'fan'), ['fan']);
assert.deepEqual(toggleProfileRole(['fan'], 'photographer'), ['photographer']);
assert.deepEqual(toggleProfileRole(['photographer'], 'artist'), ['photographer', 'artist']);
assert.deepEqual(normalizeProfileRoles(['photographer', 'photographer']), ['photographer']);
assert.deepEqual(normalizeProfileRoles(['fan', 'photographer']), ['photographer']);
assert.deepEqual(
  normalizeProfileRoles(['photographer', 'fan', 'artist']),
  ['photographer', 'artist'],
);
assert.deepEqual(normalizeProfileRoles([]), []);
assert.deepEqual(normalizeProfileRoles([], { fallbackToFan: true }), ['fan']);
assert.equal(hasExclusiveFanProfileRole(['fan']), true);
assert.equal(hasExclusiveFanProfileRole(['photographer', 'artist']), true);
assert.equal(hasExclusiveFanProfileRole(['fan', 'photographer']), false);
assert.deepEqual(
  normalizePublicProfileField('roles', ['fan', 'photographer', 'artist']),
  ['photographer', 'artist'],
  'public projection drops fan from legacy mixed profile roles',
);

console.log('profileRoles.logic.test.mjs passed');
