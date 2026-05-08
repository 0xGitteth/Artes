import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const match = source.match(/export const updateUserAffiliationStatus = async \([\s\S]*?\n};/);
assert.ok(match, 'updateUserAffiliationStatus export exists');

const body = match[0];

assert.match(
  body,
  /const publicSnap = await getDoc\(publicRef\);/,
  'updateUserAffiliationStatus reads publicUsers/{targetUid} for client-side validation',
);
assert.doesNotMatch(
  body,
  /getDoc\(targetRef\)/,
  'updateUserAffiliationStatus does not read private users/{targetUid} before owner actions',
);
assert.match(
  body,
  /const target = publicSnap\.data\(\) \|\| \{};/,
  'updateUserAffiliationStatus derives validation/display data from the public profile',
);
assert.match(
  body,
  /target\?\.\[fields\.id\] !== authUser\.uid/,
  'updateUserAffiliationStatus validates that the public affiliation links to the current owner UID',
);
assert.match(
  body,
  /batch\.set\(targetRef, privatePatch, \{ merge: true \}\);/,
  'updateUserAffiliationStatus still writes the private patch for Firestore rules to authorize',
);
assert.match(
  body,
  /batch\.set\(publicRef, publicPatch, \{ merge: true \}\);/,
  'updateUserAffiliationStatus still writes the public projection patch',
);
