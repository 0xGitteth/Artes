import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeOnboardingWritePatch } from '../src/utils/firestoreGate.js';
import { isAvailablePersonalPublicProfile } from '../functions/publicProfileAvailability.js';
import { resetPersonalOnboardingAtomically } from '../functions/publicProfileUnpublish.js';

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const createFakeDb = (entries = [], { fail = false } = {}) => {
  const docs = new Map(entries.map(([path, value]) => [path, clone(value)]));
  const ref = (path) => ({ path });
  return {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    get: (path) => clone(docs.get(path)),
    has: (path) => docs.has(path),
    runTransaction: async (operation) => {
      const pending = [];
      const result = await operation({
        get: async (documentRef) => ({
          exists: docs.has(documentRef.path),
          data: () => clone(docs.get(documentRef.path)),
        }),
        set: (documentRef, value) => pending.push(['set', documentRef.path, clone(value)]),
        delete: (documentRef) => pending.push(['delete', documentRef.path]),
      });
      if (fail) throw new Error('simulated server failure');
      pending.forEach(([kind, path, value]) => {
        if (kind === 'delete') docs.delete(path);
        else docs.set(path, { ...(docs.get(path) || {}), ...value });
      });
      return result;
    },
  };
};

const uid = 'reset-user';
const privatePath = `users/${uid}`;
const publicPath = `publicUsers/${uid}`;
const managedPath = 'profiles/managed-agency';
const completed = { onboardingComplete: true, onboardingStep: 5, displayName: 'Reset User' };
const visible = { onboardingComplete: true, displayName: 'Reset User', username: 'resetuser' };
const managed = { type: 'agency', ownerUid: uid, status: 'active' };

assert.deepEqual(
  normalizeOnboardingWritePatch(completed, { onboardingStep: 2 }),
  { onboardingStep: 5 },
  'ordinary lower-step writes remain monotonic',
);
assert.deepEqual(
  normalizeOnboardingWritePatch(completed, { onboardingStep: 2, onboardingComplete: false }),
  { onboardingStep: 5, onboardingComplete: true },
  'ordinary updateUserProfile writes cannot bypass the atomic reset',
);
assert.deepEqual(
  normalizeOnboardingWritePatch({}, { onboardingStep: 2, onboardingComplete: false }),
  { onboardingStep: 2, onboardingComplete: false },
  'a genuinely new account can initialize onboarding normally',
);

const db = createFakeDb([[privatePath, completed], [publicPath, visible], [managedPath, managed]]);
assert.equal((await resetPersonalOnboardingAtomically({ db, uid })).status, 'reset-unpublished');
assert.deepEqual(db.get(privatePath), { ...completed, onboardingStep: 2, onboardingComplete: false });
assert.equal(db.has(publicPath), false, 'the stale visible projection is deleted in the same commit');
assert.deepEqual(db.get(managedPath), managed, 'managed external profiles are untouched');
assert.equal((await resetPersonalOnboardingAtomically({ db, uid })).status, 'reset-already-unpublished');
assert.equal(db.has(publicPath), false, 'repeated reset remains safe');

const failing = createFakeDb([[privatePath, completed], [publicPath, visible]], { fail: true });
await assert.rejects(resetPersonalOnboardingAtomically({ db: failing, uid }), /simulated server failure/);
assert.deepEqual(failing.get(privatePath), completed, 'transaction failure commits no private reset');
assert.deepEqual(failing.get(publicPath), visible, 'transaction failure commits no public deletion');

const missing = createFakeDb([[privatePath, completed]]);
assert.equal((await resetPersonalOnboardingAtomically({ db: missing, uid })).status, 'reset-already-unpublished');
assert.equal(missing.get(privatePath).onboardingComplete, false);

const diditPrivate = { ...completed, ageVerified: false, isAdult: false, didit: { status: 'underage' } };
const diditHidden = { ...visible, hidden: true, status: 'inactive', visibility: 'private' };
const didit = createFakeDb([[privatePath, diditPrivate], [publicPath, diditHidden]]);
assert.equal((await resetPersonalOnboardingAtomically({ db: didit, uid })).status, 'reset-preserved-unavailable-profile');
assert.deepEqual(didit.get(publicPath), diditHidden);
assert.equal(isAvailablePersonalPublicProfile(didit.get(publicPath)), false);

const staleDidit = createFakeDb([[privatePath, diditPrivate], [publicPath, visible]]);
assert.equal((await resetPersonalOnboardingAtomically({ db: staleDidit, uid })).status, 'reset-unpublished');
assert.equal(staleDidit.has(publicPath), false, 'visible Didit projection is never preserved');

for (const [label, unavailable] of [
  ['hidden', { ...visible, hidden: true, fansCount: 7 }],
  ['inactive/private', { ...visible, status: 'inactive', visibility: 'private', fanOfCount: 4 }],
  ['admin disabled', { ...visible, deactivatedReason: 'disabled-by-admin', fansCount: 9 }],
]) {
  const safetyDb = createFakeDb([[privatePath, completed], [publicPath, unavailable]]);
  assert.equal(
    (await resetPersonalOnboardingAtomically({ db: safetyDb, uid })).status,
    'reset-preserved-unavailable-profile',
    `${label} profile is preserved`,
  );
  assert.deepEqual(safetyDb.get(publicPath), unavailable, `${label} markers and counters remain unchanged`);
}

const functionsSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
assert.match(functionsSource, /export const resetPersonalOnboarding = onCall[\s\S]*?request\.auth\?\.uid[\s\S]*?resetPersonalOnboardingAtomically/);
const firebaseSource = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
assert.match(firebaseSource, /httpsCallable\(getFirebaseFunctions\(\), 'resetPersonalOnboarding'\)/);
assert.doesNotMatch(firebaseSource, /requestIncompletePersonalProfileUnpublish|unpublishIncompletePersonalProfile/);
const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const handlers = [...appSource.matchAll(/const handleOpenIdCheck = async \(\) => \{[\s\S]*?\n[ \t]+\};/g)];
assert.equal(handlers.length, 2);
handlers.forEach(([handler]) => assert.match(handler, /await resetPersonalOnboardingToIdCheck\(\)/));
assert.match(appSource, /shouldInitializeGoogleOnboarding = !isOnboardingComplete\(profile\)/);
assert.match(appSource, /createdNewAccount \|\| !isOnboardingComplete\(profile\)/);
assert.match(firebaseSource, /normalizeOnboardingWritePatch\(existingPrivate, safeData\)/);

console.log('PASS publicProfileUnpublish.test');
