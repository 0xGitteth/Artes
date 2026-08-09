import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/services/firebaseClient.js', import.meta.url), 'utf8');
const match = source.match(/const toPublicProfilePayload = \(payload = \{}, uid\) => \{[\s\S]*?\n\};\n\n\/\/ Debug logging helper/);
assert.ok(match, 'toPublicProfilePayload helper exists');

const helper = match[0];

assert.match(
  helper,
  /profileId:\s*uid,/, 
  'publicUsers/{uid}.profileId is always derived from the target uid',
);
assert.match(
  helper,
  /ownerUid:\s*uid,/, 
  'publicUsers/{uid}.ownerUid is always derived from the target uid',
);
assert.doesNotMatch(
  helper,
  /profileId\s*=\s*payload\?\.profileId|profileId:\s*payload\?\.profileId/,
  'profileId must not be derived from caller payload fields',
);
assert.doesNotMatch(
  helper,
  /ownerUid\s*=\s*payload\?\.ownerUid|ownerUid:\s*payload\?\.ownerUid/,
  'ownerUid must not be derived from caller payload fields',
);
assert.doesNotMatch(
  helper,
  /\.\.\.rest|\.\.\.payload/,
  'private profile data is never spread into the public payload',
);

const helperBlock = source.match(/const normalizeUsername = [\s\S]*?\n\};\n\n\/\/ Debug logging helper/);
assert.ok(helperBlock, 'public payload normalization block exists');
const buildPayload = Function(
  'serverTimestamp',
  `${helperBlock[0].replace(/\/\/ Debug logging helper[\s\S]*$/, '')}; return toPublicProfilePayload;`,
)(() => 'timestamp');
const payload = buildPayload({
  displayName: 'Codex',
  username: 'Co Dex!',
  roles: ['assistent', null, 7, ' maker '],
  themes: 'private-invalid-array',
  photoURL: { private: true },
  quickProfilePreviewMode: 'invalid',
  onboardingStep: '5',
  preferences: { private: true },
  didit: { status: 'approved' },
  idv: { status: 'approved' },
  authProvider: 'google.com',
  onboardingCompletedAt: 'private',
}, 'user-1');
assert.deepEqual(payload, {
  uid: 'user-1',
  profileId: 'user-1',
  ownerUid: 'user-1',
  updatedAt: 'timestamp',
  displayName: 'Codex',
  displayNameLower: 'codex',
  username: 'codex',
  roles: ['assistent', 'maker'],
  themes: [],
  onboardingStep: 5,
});

console.log('PASS firebaseClient.publicProfilePayload.client.test');
