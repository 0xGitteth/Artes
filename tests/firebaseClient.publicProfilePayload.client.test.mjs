import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isOnboardingComplete } from '../src/utils/firestoreGate.js';
import { syncPublicProfileFromCurrentPrivate } from '../src/utils/publicProfileSync.js';

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

const createProfile = source.match(/export const createProfile = async \(uid, profile\) => \{[\s\S]*?\n\};\n\n\/\/ Update is merged/);
assert.ok(createProfile, 'createProfile helper exists');
assert.match(
  createProfile[0],
  /if \(isOnboardingComplete\(profile\)\) \{[\s\S]*?toPublicProfilePayload\(profile, uid\)/,
  'createProfile keeps its existing direct publication behavior',
);
assert.doesNotMatch(
  createProfile[0],
  /syncPublicProfileFromCurrentPrivate/,
  'the update-only concurrency fix does not change createProfile',
);

const updateProfile = source.match(/export const updateProfile = async \(uid, payload\) => \{[\s\S]*?\n\};\n\nexport const publishPost/);
assert.ok(updateProfile, 'updateProfile helper exists');
assert.match(
  updateProfile[0],
  /const resultingProfile = \{ \.\.\.\(privateSnap\.exists\(\) \? privateSnap\.data\(\) : \{}\), \.\.\.payload \};/,
  'the merged private snapshot remains available for the initial onboarding gate',
);
assert.match(
  updateProfile[0],
  /if \(isOnboardingComplete\(resultingProfile\)\) \{[\s\S]*?syncPublicProfileFromCurrentPrivate\(\{/,
  'completed profiles use the shared transaction-based public sync',
);
assert.match(
  updateProfile[0],
  /buildWritePayload: \(currentPrivate\) => \(\{[\s\S]*?toPublicProfilePayload\(currentPrivate, uid\),[\s\S]*?onboardingComplete: true/,
  'the transaction projects current private state through the existing allowlist and stamps completion',
);
assert.doesNotMatch(
  updateProfile[0],
  /toPublicProfilePayload\(resultingProfile, uid\)|setDoc\(publicRef/,
  'updateProfile never writes its stale full-profile projection directly',
);
assert.ok(
  updateProfile[0].indexOf('await setDoc(privateRef')
    < updateProfile[0].indexOf('await syncPublicProfileFromCurrentPrivate'),
  'the private merge is committed before the current-state public transaction starts',
);

const initialProfile = {
  uid: 'firebase-client-overlap-user',
  onboardingComplete: true,
  displayName: 'Concurrent User',
  bio: 'Old bio',
  avatar: 'https://example.test/old-avatar.jpg',
};
const concurrentState = {
  privateProfile: { ...initialProfile },
  publicProfile: {
    ...buildPayload(initialProfile, initialProfile.uid),
    onboardingComplete: true,
  },
};
const privateRef = { kind: 'private' };
const publicRef = { kind: 'public' };
let stalePrivateReads = 0;
let currentPrivateReads = 0;
let currentPublicReads = 0;
const getDocMock = async (ref) => {
  assert.equal(ref, privateRef);
  stalePrivateReads += 1;
  return {
    exists: () => true,
    data: () => ({ ...initialProfile }),
  };
};
const setDocMock = async (ref, nextPayload, options) => {
  assert.equal(ref, privateRef);
  assert.deepEqual(options, { merge: true });
  concurrentState.privateProfile = {
    ...concurrentState.privateProfile,
    ...nextPayload,
  };
};
const runCurrentStateTransaction = async (_db, operation) => operation({
  get: async (ref) => {
    if (ref === privateRef) currentPrivateReads += 1;
    if (ref === publicRef) currentPublicReads += 1;
    const data = ref === privateRef
      ? concurrentState.privateProfile
      : concurrentState.publicProfile;
    return {
      exists: () => true,
      data: () => ({ ...data }),
    };
  },
  set: (ref, nextPayload, options) => {
    assert.equal(ref, publicRef);
    assert.deepEqual(options, { merge: true });
    concurrentState.publicProfile = {
      ...concurrentState.publicProfile,
      ...nextPayload,
    };
  },
});

const executableUpdateProfileSource = updateProfile[0]
  .replace(/^export const /, 'const ')
  .replace(/\n\nexport const publishPost$/, '');
const updateProfileUnderTest = Function(
  'getDoc',
  'doc',
  'db',
  'logFirestoreOp',
  'setDoc',
  'serverTimestamp',
  'isOnboardingComplete',
  'syncPublicProfileFromCurrentPrivate',
  'runTransaction',
  'toPublicProfilePayload',
  `${executableUpdateProfileSource}; return updateProfile;`,
)(
  getDocMock,
  (_db, collectionName) => (collectionName === 'users' ? privateRef : publicRef),
  {},
  () => {},
  setDocMock,
  () => 'timestamp',
  isOnboardingComplete,
  syncPublicProfileFromCurrentPrivate,
  runCurrentStateTransaction,
  buildPayload,
);

await Promise.all([
  updateProfileUnderTest(initialProfile.uid, { bio: 'New bio' }),
  updateProfileUnderTest(initialProfile.uid, { avatar: 'https://example.test/new-avatar.jpg' }),
]);
assert.equal(stalePrivateReads, 2, 'both callers start from the same stale private snapshot');
assert.equal(currentPrivateReads, 2, 'each public transaction re-reads current private state');
assert.equal(currentPublicReads, 2, 'each public transaction re-reads current public state');
assert.equal(concurrentState.publicProfile.bio, 'New bio', 'avatar update cannot revert the concurrent bio update');
assert.equal(
  concurrentState.publicProfile.avatar,
  'https://example.test/new-avatar.jpg',
  'bio update cannot revert the concurrent avatar update',
);
assert.equal(concurrentState.publicProfile.onboardingComplete, true, 'public sync retains the completion stamp');

console.log('PASS firebaseClient.publicProfilePayload.client.test');
