import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyFollowingCreatedCounters,
  applyFollowingDeletedCounters,
} from '../functions/followCounters.js';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const fieldValue = {
  increment: (amount) => ({ operation: 'increment', amount }),
  serverTimestamp: () => ({ operation: 'serverTimestamp' }),
};

const applyPayload = (existing = {}, payload = {}) => Object.entries(payload).reduce((next, [key, value]) => {
  if (value?.operation === 'increment') {
    next[key] = (Number(next[key]) || 0) + value.amount;
  } else if (value?.operation === 'serverTimestamp') {
    next[key] = 'timestamp';
  } else {
    next[key] = clone(value);
  }
  return next;
}, { ...existing });

const createFakeDb = (entries = []) => {
  const docs = new Map(entries.map(([path, data]) => [path, clone(data)]));
  const refs = new Map();
  const ref = (path) => {
    if (!refs.has(path)) refs.set(path, { path });
    return refs.get(path);
  };
  let transactionCalls = 0;

  return {
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    ref,
    has: (path) => docs.has(path),
    get: (path) => clone(docs.get(path)),
    put: (path, data) => docs.set(path, clone(data)),
    remove: (path) => docs.delete(path),
    get transactionCalls() { return transactionCalls; },
    runTransaction: async (operation) => {
      transactionCalls += 1;
      const writes = [];
      const result = await operation({
        get: async (documentRef) => ({
          exists: docs.has(documentRef.path),
          data: () => clone(docs.get(documentRef.path)),
        }),
        set: (documentRef, payload, options) => writes.push({ type: 'set', documentRef, payload, options }),
        update: (documentRef, payload) => writes.push({ type: 'update', documentRef, payload }),
        delete: (documentRef) => writes.push({ type: 'delete', documentRef }),
      });

      writes.forEach(({ type, documentRef, payload, options }) => {
        if (type === 'delete') {
          docs.delete(documentRef.path);
          return;
        }
        if (type === 'update') {
          assert.equal(docs.has(documentRef.path), true, `update must not create ${documentRef.path}`);
          docs.set(documentRef.path, applyPayload(docs.get(documentRef.path), payload));
          return;
        }
        const existing = options?.merge ? (docs.get(documentRef.path) || {}) : {};
        docs.set(documentRef.path, applyPayload(existing, payload));
      });
      return result;
    },
  };
};

const relationPath = 'users/fan/following/target';
const validEntries = () => [
  ['users/fan', { onboardingStep: '5' }],
  ['publicUsers/fan', { onboardingComplete: true, fanOfCount: 2 }],
  ['users/target', { onboardingComplete: true }],
  ['publicUsers/target', { onboardingComplete: true, fansCount: 4 }],
  [relationPath, { targetUid: 'target', createdAt: 'created' }],
];
const applyCreate = (db) => applyFollowingCreatedCounters({
  db,
  relationRef: db.ref(relationPath),
  uid: 'fan',
  targetUid: 'target',
  fieldValue,
});
const applyDelete = (db, relationData = { countersApplied: true }) => applyFollowingDeletedCounters({
  db,
  relationData,
  uid: 'fan',
  targetUid: 'target',
  fieldValue,
});

const validCreateDb = createFakeDb(validEntries());
const validCreateResult = await applyCreate(validCreateDb);
assert.equal(validCreateResult.status, 'applied');
assert.equal(validCreateDb.get('publicUsers/fan').fanOfCount, 3);
assert.equal(validCreateDb.get('publicUsers/target').fansCount, 5);
assert.equal(validCreateDb.get(relationPath).countersApplied, true);
assert.equal('ageVerified' in validCreateDb.get('users/fan'), false, 'legacy step 5 needs no age gate');

const unavailableCases = [
  ['incomplete fan', (db) => db.put('users/fan', { onboardingStep: 4, ageVerified: true, isAdult: true })],
  ['hidden fan', (db) => db.put('publicUsers/fan', { onboardingComplete: true, hidden: true, fanOfCount: 2 })],
  ['inactive fan', (db) => db.put('publicUsers/fan', { onboardingComplete: true, status: 'inactive', fanOfCount: 2 })],
  ['private fan', (db) => db.put('publicUsers/fan', { onboardingComplete: true, visibility: 'private', fanOfCount: 2 })],
  ['private public visibility', (db) => db.put('publicUsers/fan', { onboardingComplete: true, publicVisibility: 'private', fanOfCount: 2 })],
  ['deactivated fan', (db) => db.put('publicUsers/fan', { onboardingComplete: true, deactivatedReason: 'underage', fanOfCount: 2 })],
  ['hidden target', (db) => db.put('publicUsers/target', { onboardingComplete: true, hidden: true, fansCount: 4 })],
  ['missing target', (db) => {
    db.remove('users/target');
    db.remove('publicUsers/target');
  }],
];

for (const [name, mutate] of unavailableCases) {
  const db = createFakeDb(validEntries());
  mutate(db);
  const fanBefore = db.get('publicUsers/fan')?.fanOfCount;
  const targetBefore = db.get('publicUsers/target')?.fansCount;
  const result = await applyCreate(db);
  assert.equal(result.status, 'rejected-unavailable', `${name} is rejected`);
  assert.equal(db.has(relationPath), false, `${name} cannot retain a new public interaction`);
  assert.equal(db.get('publicUsers/fan')?.fanOfCount, fanBefore, `${name} does not change fan counter`);
  assert.equal(db.get('publicUsers/target')?.fansCount, targetBefore, `${name} does not change target counter`);
}

const managedTargetDb = createFakeDb([
  ...validEntries().filter(([path]) => !['users/target', 'publicUsers/target'].includes(path)),
  ['profiles/target', { type: 'agency', status: 'active', fansCount: 8 }],
]);
assert.equal((await applyCreate(managedTargetDb)).status, 'rejected-unavailable');
assert.equal(managedTargetDb.has('publicUsers/target'), false, 'managed target does not create a personal publicUsers stub');
assert.deepEqual(managedTargetDb.get('profiles/target'), { type: 'agency', status: 'active', fansCount: 8 });

const unappliedDeleteDb = createFakeDb(validEntries().filter(([path]) => path !== relationPath));
const unappliedDeleteResult = await applyDelete(unappliedDeleteDb, { countersApplied: false });
assert.equal(unappliedDeleteResult.status, 'not-applied');
assert.equal(unappliedDeleteDb.transactionCalls, 0, 'rejected create deletion cannot decrement counters');

const validDeleteDb = createFakeDb(validEntries().filter(([path]) => path !== relationPath));
const validDeleteResult = await applyDelete(validDeleteDb);
assert.equal(validDeleteResult.status, 'decremented');
assert.deepEqual(validDeleteResult.decremented.sort(), ['fan', 'target']);
assert.equal(validDeleteDb.get('publicUsers/fan').fanOfCount, 1);
assert.equal(validDeleteDb.get('publicUsers/target').fansCount, 3);

const missingFanDeleteDb = createFakeDb(validEntries().filter(([path]) => (
  path !== relationPath && path !== 'users/fan' && path !== 'publicUsers/fan'
)));
const missingFanDeleteResult = await applyDelete(missingFanDeleteDb);
assert.deepEqual(missingFanDeleteResult.decremented, ['target']);
assert.equal(missingFanDeleteDb.get('publicUsers/target').fansCount, 3);
assert.equal(missingFanDeleteDb.has('publicUsers/fan'), false, 'delete counterpart never recreates missing fan profile');

const hiddenTargetDeleteDb = createFakeDb(validEntries().filter(([path]) => path !== relationPath));
hiddenTargetDeleteDb.put('publicUsers/target', {
  onboardingComplete: true,
  hidden: true,
  fansCount: 4,
});
const hiddenTargetDeleteResult = await applyDelete(hiddenTargetDeleteDb);
assert.deepEqual(hiddenTargetDeleteResult.decremented, ['fan']);
assert.equal(hiddenTargetDeleteDb.get('publicUsers/target').fansCount, 4, 'delete does not merge into gated target');
assert.equal(hiddenTargetDeleteDb.get('publicUsers/fan').fanOfCount, 1, 'available counterpart remains accurate');

const functionsSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
assert.match(functionsSource, /onFollowingCreated[\s\S]*?applyFollowingCreatedCounters\(\{/);
assert.match(functionsSource, /onFollowingDeleted[\s\S]*?applyFollowingDeletedCounters\(\{/);

console.log('PASS followCounters.test');
