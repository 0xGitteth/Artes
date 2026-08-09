import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isOnboardingComplete,
  normalizeOnboardingWritePatch,
} from '../src/utils/firestoreGate.js';
import { isAvailablePersonalPublicProfile } from '../functions/publicProfileAvailability.js';
import { unpublishIncompletePersonalProfileFromCurrentState } from '../functions/publicProfileUnpublish.js';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

const createFakeDb = (entries = [], { beforeTransaction = null } = {}) => {
  const docs = new Map(entries.map(([path, data]) => [path, clone(data)]));
  const refs = new Map();
  const ref = (path) => {
    if (!refs.has(path)) refs.set(path, { path });
    return refs.get(path);
  };

  return {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    has: (path) => docs.has(path),
    get: (path) => clone(docs.get(path)),
    put: (path, data) => docs.set(path, clone(data)),
    runTransaction: async (operation) => {
      beforeTransaction?.(docs);
      const deletes = [];
      const result = await operation({
        get: async (documentRef) => ({
          exists: docs.has(documentRef.path),
          data: () => clone(docs.get(documentRef.path)),
        }),
        delete: (documentRef) => deletes.push(documentRef.path),
      });
      deletes.forEach((path) => docs.delete(path));
      return result;
    },
  };
};

const uid = 'reset-user';
const privatePath = `users/${uid}`;
const publicPath = `publicUsers/${uid}`;
const managedPath = 'profiles/managed-agency';
const managedProfile = { ownerUid: uid, type: 'agency', status: 'active', displayName: 'Managed Agency' };
const completedPrivate = { onboardingComplete: true, onboardingStep: 5 };
const explicitReset = { onboardingComplete: false, onboardingStep: 2 };
const normalizedReset = normalizeOnboardingWritePatch(completedPrivate, explicitReset);
assert.deepEqual(normalizedReset, explicitReset, 'an explicit incomplete state may reset a completed private profile');
assert.equal(isOnboardingComplete({ ...completedPrivate, ...normalizedReset }), false);

const lowerStepOnly = normalizeOnboardingWritePatch(completedPrivate, { onboardingStep: 2 });
assert.deepEqual(lowerStepOnly, { onboardingStep: 5 }, 'a lower step without an explicit reset remains monotonic');

const publishedProfile = {
  uid,
  onboardingComplete: true,
  displayName: 'Reset User',
  username: 'resetuser',
  fansCount: 3,
};
const resetDb = createFakeDb([
  [privatePath, { ...explicitReset, ageVerified: true, isAdult: true }],
  [publicPath, publishedProfile],
  [managedPath, managedProfile],
]);
const resetResult = await unpublishIncompletePersonalProfileFromCurrentState({ db: resetDb, uid });
assert.equal(resetResult.status, 'unpublished');
assert.equal(resetDb.has(publicPath), false, 'ordinary onboarding reset deletes the stale published projection');
assert.equal(isAvailablePersonalPublicProfile(resetDb.get(publicPath)), false, 'stale public completion cannot remain available');
assert.deepEqual(resetDb.get(managedPath), managedProfile, 'personal unpublish never touches managed external profiles');
assert.equal((await unpublishIncompletePersonalProfileFromCurrentState({ db: resetDb, uid })).status, 'already-unpublished');

const recompletedDb = createFakeDb([
  [privatePath, explicitReset],
  [publicPath, publishedProfile],
], {
  beforeTransaction: (docs) => docs.set(privatePath, { onboardingComplete: true, onboardingStep: '5' }),
});
const recompletedResult = await unpublishIncompletePersonalProfileFromCurrentState({ db: recompletedDb, uid });
assert.equal(recompletedResult.status, 'still-complete');
assert.deepEqual(recompletedDb.get(publicPath), publishedProfile, 'current re-completion wins over a stale unpublish request');

const diditPublicProfile = {
  ...publishedProfile,
  hidden: true,
  status: 'inactive',
  visibility: 'private',
  publicVisibility: 'private',
  deactivatedReason: 'underage',
};
const diditDb = createFakeDb([
  [privatePath, {
    ...explicitReset,
    ageVerified: false,
    isAdult: false,
    didit: { status: 'underage' },
  }],
  [publicPath, diditPublicProfile],
]);
const diditResult = await unpublishIncompletePersonalProfileFromCurrentState({ db: diditDb, uid });
assert.equal(diditResult.status, 'preserved-didit-safety-profile');
assert.deepEqual(diditDb.get(publicPath), diditPublicProfile, 'Didit safety profile remains stored for manual recovery only');
assert.equal(isAvailablePersonalPublicProfile(diditDb.get(publicPath)), false);

const diditStaleVisibleDb = createFakeDb([
  [privatePath, {
    ...explicitReset,
    ageVerified: false,
    isAdult: false,
    idv: { status: 'underage' },
  }],
  [publicPath, publishedProfile],
]);
assert.equal(
  (await unpublishIncompletePersonalProfileFromCurrentState({ db: diditStaleVisibleDb, uid })).status,
  'unpublished',
);
assert.equal(diditStaleVisibleDb.has(publicPath), false, 'a not-yet-hidden stale Didit projection cannot remain available');

const unavailableDb = createFakeDb([
  [privatePath, explicitReset],
  [publicPath, { ...publishedProfile, hidden: true }],
]);
assert.equal(
  (await unpublishIncompletePersonalProfileFromCurrentState({ db: unavailableDb, uid })).status,
  'already-unavailable',
);
assert.equal(unavailableDb.has(publicPath), true, 'an already unavailable safety projection is not blindly deleted');

const functionsSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const callableSource = functionsSource.match(/export const unpublishIncompletePersonalProfile = onCall[\s\S]*?\n\}\);/);
assert.ok(callableSource, 'authenticated unpublish callable is exported');
assert.match(callableSource[0], /request\.auth\?\.uid/);
assert.match(callableSource[0], /unpublishIncompletePersonalProfileFromCurrentState\(\{ db, uid \}\)/);

const firebaseSource = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const updateSource = firebaseSource.match(/export const updateUserProfile = async \(uid, data\) => \{[\s\S]*?\n\};\n\n\/\*\*/)[0];
assert.match(updateSource, /isExplicitOnboardingReset\(safeData\)/);
assert.match(updateSource, /requestIncompletePersonalProfileUnpublish\(\)/);
assert.ok(
  updateSource.indexOf('safeUserWrite(resolvedUid, updatePayload, authUser)')
    < updateSource.indexOf('requestIncompletePersonalProfileUnpublish()'),
  'private reset is committed before the server re-reads state for unpublishing',
);

const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const idCheckHandlers = [...appSource.matchAll(/const handleOpenIdCheck = async \(\) => \{[\s\S]*?\n[ \t]+\};/g)];
assert.equal(idCheckHandlers.length, 2, 'both personal ID-check routing paths remain covered');
idCheckHandlers.forEach(([handler]) => {
  assert.match(handler, /updateUserProfile\(authUser\.uid, \{[\s\S]*?onboardingStep: 2,[\s\S]*?onboardingComplete: false/);
});

console.log('PASS publicProfileUnpublish.test');
