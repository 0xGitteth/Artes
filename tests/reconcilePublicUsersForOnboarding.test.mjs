import assert from 'node:assert/strict';
import {
  PRIVATE_FIELDS,
  buildPublicProfile,
  isOnboardingComplete,
  parseArgs,
  reconcile,
} from '../functions/scripts/reconcilePublicUsersForOnboarding.js';

assert.equal(isOnboardingComplete({ onboardingStep: 5 }), true);
assert.equal(isOnboardingComplete({ onboardingStep: '5' }), true);
assert.equal(isOnboardingComplete({ ageVerified: true, isAdult: true, onboardingStep: 2 }), false);
assert.deepEqual(parseArgs(['--apply', '--uid', 'abc', '--project=p']), {
  apply: true,
  deleteOrphans: false,
  uid: 'abc',
  project: 'p',
  dryRun: false,
});

const payload = buildPublicProfile('abcdef', {
  displayName: 'Codex',
  email: 'private@x',
  birthDate: 'x',
  onboardingStep: 5,
  ageVerified: false,
}, () => 1);
assert.equal(payload.onboardingComplete, true);
assert.equal(payload.email, undefined);
assert.equal(payload.birthDate, undefined);
assert.equal(payload.onboardingStep, 5);
assert.ok(
  ['triggerVisibility', 'authDisplayName', 'firebaseDisplayName', 'googleDisplayName']
    .every((field) => PRIVATE_FIELDS.includes(field)),
);

const malformed = buildPublicProfile('abcdef', {
  displayName: 7,
  roles: 'maker',
  themes: [null, ' portrait ', 4],
  photoURL: { url: 'private' },
  headerImage: [],
  linkedAgencyStatus: { bad: true },
  quickProfilePreviewMode: 42,
  quickProfilePostIds: 'post',
  onboardingStep: '5',
}, () => 1);
assert.equal(malformed.displayName, '');
assert.deepEqual(malformed.roles, []);
assert.deepEqual(malformed.themes, ['portrait']);
assert.equal(malformed.photoURL, undefined);
assert.equal(malformed.headerImage, undefined);
assert.equal(malformed.linkedAgencyStatus, undefined);
assert.equal(malformed.quickProfilePreviewMode, undefined);
assert.equal(malformed.quickProfilePostIds, undefined);
assert.equal(malformed.onboardingStep, 5);

const DELETE_TOKEN = Symbol('delete');

function createFakeDb(initialUsers, initialPublicUsers, {
  registeredCodexUids = [],
  beforeFirstTransaction = null,
  failTransaction = false,
} = {}) {
  const stores = {
    users: new Map(initialUsers.map(([id, data]) => [id, structuredClone(data)])),
    publicUsers: new Map(initialPublicUsers.map(([id, data]) => [id, structuredClone(data)])),
    codexDevActorRegistry: new Map(registeredCodexUids.map((id) => [id, { productionDenyOnly: true }])),
  };
  const pageReads = [];
  const transactionWrites = [];
  let transactionCalls = 0;
  let hookCalled = false;

  const makeRef = (name, id) => ({
    id,
    path: `${name}/${id}`,
    get: async () => makeSnap(name, id),
  });
  const makeSnap = (name, id) => {
    const exists = stores[name].has(id);
    const data = exists ? structuredClone(stores[name].get(id)) : undefined;
    return {
      id,
      exists,
      ref: makeRef(name, id),
      data: () => structuredClone(data),
    };
  };
  const makeQuery = (name, state = {}) => ({
    orderBy: (field) => makeQuery(name, { ...state, field }),
    limit: (limit) => makeQuery(name, { ...state, limit }),
    startAfter: (cursor) => makeQuery(name, { ...state, cursor }),
    get: async () => {
      assert.ok(state.field, `${name} query must be ordered for bounded pagination`);
      assert.ok(Number.isInteger(state.limit), `${name} query must have a page limit`);
      const ids = [...stores[name].keys()].sort()
        .filter((id) => state.cursor === undefined || id > state.cursor)
        .slice(0, state.limit);
      pageReads.push({ collection: name, limit: state.limit, count: ids.length, cursor: state.cursor });
      return { docs: ids.map((id) => makeSnap(name, id)) };
    },
  });
  const applyPayload = (name, id, nextPayload, merge) => {
    const next = merge ? { ...(stores[name].get(id) || {}) } : {};
    Object.entries(nextPayload).forEach(([key, value]) => {
      if (value === DELETE_TOKEN) delete next[key];
      else next[key] = value;
    });
    stores[name].set(id, next);
  };

  const db = {
    stores,
    pageReads,
    transactionWrites,
    get transactionCalls() { return transactionCalls; },
    collection: (name) => ({
      doc: (id) => makeRef(name, id),
      orderBy: (field) => makeQuery(name, { field }),
      get: async () => { throw new Error(`unbounded ${name}.get() is forbidden`); },
    }),
    runTransaction: async (callback) => {
      transactionCalls += 1;
      if (!hookCalled && beforeFirstTransaction) {
        hookCalled = true;
        await beforeFirstTransaction(stores);
      }
      if (failTransaction) throw new Error('transaction failed');
      const pending = [];
      const transaction = {
        get: async (ref) => {
          const [name, id] = ref.path.split('/');
          return makeSnap(name, id);
        },
        set: (ref, data, options = {}) => pending.push({ action: 'set', ref, data, options }),
        delete: (ref) => pending.push({ action: 'delete', ref }),
      };
      const result = await callback(transaction);
      pending.forEach((write) => {
        transactionWrites.push(write);
        const [name, id] = write.ref.path.split('/');
        if (write.action === 'delete') stores[name].delete(id);
        else applyPayload(name, id, write.data, write.options.merge === true);
      });
      return result;
    },
  };
  return db;
}

const users = [
  ['done', { displayName: 'Done', onboardingStep: 5 }],
  ['pending', { onboardingComplete: false, ageVerified: true, isAdult: true }],
];
const publicUsers = [
  ['pending', { onboardingComplete: true }],
  ['orphan', { onboardingComplete: true }],
];

const dryRunDb = createFakeDb(users, publicUsers);
const dryRunStats = await reconcile({ db: dryRunDb, pageSize: 1 });
assert.equal(dryRunStats.privateUsersScanned, 2);
assert.equal(dryRunStats.writes, 1);
assert.equal(dryRunStats.deletes, 1);
assert.equal(dryRunStats.publicProfilesDeleted, 1);
assert.equal(dryRunStats.diditSafetyProfilesPreserved, 0);
assert.equal(dryRunStats.orphanPublicProfiles, 1);
assert.equal(dryRunDb.transactionCalls, 0, 'dry run remains strictly read-only');
assert.ok(dryRunDb.pageReads.length >= 4, 'both collections are read across bounded pages');
assert.ok(dryRunDb.pageReads.every((page) => page.limit === 1 && page.count <= 1));

const applyDb = createFakeDb(users, publicUsers);
const applyStats = await reconcile({ db: applyDb, apply: true, pageSize: 1, deleteValue: () => DELETE_TOKEN });
assert.equal(applyStats.writes, 1);
assert.equal(applyStats.deletes, 1);
assert.equal(applyStats.publicProfilesDeleted, 1);
assert.equal(applyStats.diditSafetyProfilesPreserved, 0);
assert.equal(applyDb.stores.publicUsers.has('pending'), false);
assert.equal(applyDb.stores.publicUsers.has('done'), true);
assert.ok(applyDb.transactionCalls >= 2, 'apply decisions use transactions instead of reusable batches');

const codexIsolationUsers = [
  ['retired-no-public', { displayName: 'Retired', onboardingComplete: true }],
  ['retired-with-public', { displayName: 'Retired', onboardingComplete: true }],
  ['codex-dev-user', { displayName: 'Current Codex', onboardingComplete: true }],
  ['spoofed-markers', {
    displayName: 'Ordinary Spoof', onboardingComplete: true, isDevTestUser: true, devActor: 'codex',
  }],
];
const codexIsolationPublicUsers = [
  ['retired-with-public', { onboardingComplete: true, displayName: 'Retired' }],
  ['codex-dev-user', { onboardingComplete: true, displayName: 'Current Codex' }],
];
const isolationOptions = { registeredCodexUids: ['retired-no-public', 'retired-with-public'] };
const codexDryRunDb = createFakeDb(codexIsolationUsers, codexIsolationPublicUsers, isolationOptions);
const codexDryRunStats = await reconcile({ db: codexDryRunDb, pageSize: 10 });
assert.equal(codexDryRunStats.testActorsSkipped, 3);
assert.equal(codexDryRunStats.publicProfilesDeleted, 2, 'dry run reports current and retired projection deletion');
assert.equal(codexDryRunStats.writes, 1, 'spoofed private markers remain non-authoritative and publish normally');
assert.equal(codexDryRunDb.transactionCalls, 0);
assert.equal(codexDryRunDb.transactionWrites.length, 0, 'dry run performs zero writes');
assert.equal(codexDryRunDb.stores.publicUsers.has('retired-with-public'), true);

const codexApplyDb = createFakeDb(codexIsolationUsers, codexIsolationPublicUsers, isolationOptions);
await reconcile({ db: codexApplyDb, apply: true, pageSize: 10 });
assert.equal(codexApplyDb.stores.publicUsers.has('retired-no-public'), false);
assert.equal(codexApplyDb.stores.publicUsers.has('retired-with-public'), false);
assert.equal(codexApplyDb.stores.publicUsers.has('codex-dev-user'), false);
assert.equal(codexApplyDb.stores.publicUsers.has('spoofed-markers'), true);

const actorOrphans = [
  ['retired-orphan', { onboardingComplete: true, displayName: 'Retired orphan' }],
  ['codex-dev-user', { onboardingComplete: true, displayName: 'Current Codex orphan' }],
  ['ordinary-orphan', { onboardingComplete: true, displayName: 'Ordinary orphan' }],
];
const orphanDryRunDb = createFakeDb([], actorOrphans, { registeredCodexUids: ['retired-orphan'] });
const orphanDryRunStats = await reconcile({ db: orphanDryRunDb, pageSize: 10 });
assert.equal(orphanDryRunStats.publicProfilesDeleted, 2, 'dry run reports both registry-denied orphan projections');
assert.equal(orphanDryRunStats.deletes, 2);
assert.equal(orphanDryRunStats.orphanPublicProfiles, 1, 'ordinary orphan retention is unchanged');
assert.equal(orphanDryRunDb.transactionCalls, 0, 'orphan dry run remains read-only');
assert.equal(orphanDryRunDb.transactionWrites.length, 0);
assert.equal(orphanDryRunDb.stores.publicUsers.size, 3);

const orphanApplyDb = createFakeDb([], actorOrphans, { registeredCodexUids: ['retired-orphan'] });
const orphanApplyStats = await reconcile({ db: orphanApplyDb, apply: true, pageSize: 10 });
assert.equal(orphanApplyStats.publicProfilesDeleted, 2);
assert.equal(orphanApplyDb.stores.publicUsers.has('retired-orphan'), false);
assert.equal(orphanApplyDb.stores.publicUsers.has('codex-dev-user'), false);
assert.equal(
  orphanApplyDb.stores.publicUsers.has('ordinary-orphan'),
  true,
  'ordinary orphan remains when deleteOrphans is false',
);

const cleanupDb = createFakeDb(
  [['done', { displayName: 'Current', onboardingStep: '5', roles: ['maker'], themes: [] }]],
  [['done', {
    displayName: 'Old',
    onboardingStep: 5,
    bio: 'stale',
    photoURL: 'stale.jpg',
    headerImage: 'stale.jpg',
    fansCount: 9,
    createdAt: 1,
    triggerVisibility: {},
    authDisplayName: 'Private',
    firebaseDisplayName: 'Private',
    googleDisplayName: 'Private',
  }]],
);
await reconcile({
  db: cleanupDb,
  apply: true,
  uid: 'done',
  deleteValue: () => DELETE_TOKEN,
  serverTimestamp: () => 2,
});
const cleaned = cleanupDb.stores.publicUsers.get('done');
for (const field of [
  'bio', 'photoURL', 'headerImage', 'triggerVisibility',
  'authDisplayName', 'firebaseDisplayName', 'googleDisplayName',
]) {
  assert.equal(Object.hasOwn(cleaned, field), false, `${field} is deleted`);
}
assert.equal(cleaned.fansCount, 9, 'server-managed counter is preserved');
assert.equal(cleaned.createdAt, 1, 'server-managed timestamp is preserved');
assert.equal(cleaned.onboardingStep, 5, 'legacy string step is normalized');

const diditSafetyPrivateProfile = {
  onboardingComplete: false,
  onboardingStep: 2,
  ageVerified: false,
  isAdult: false,
  didit: { status: 'underage' },
};
const diditSafetyPublicProfile = {
  uid: 'didit-safety',
  onboardingComplete: true,
  displayName: 'Safety Profile',
  hidden: true,
  status: 'inactive',
  visibility: 'private',
  publicVisibility: 'private',
  deactivatedReason: 'underage',
  fansCount: 7,
  fanOfCount: 4,
};

const diditSafetyDryRunDb = createFakeDb(
  [['didit-safety', diditSafetyPrivateProfile]],
  [['didit-safety', diditSafetyPublicProfile]],
);
const diditSafetyDryRunStats = await reconcile({
  db: diditSafetyDryRunDb,
  uid: 'didit-safety',
  deleteValue: () => DELETE_TOKEN,
});
assert.equal(diditSafetyDryRunStats.incompleteUsers, 1);
assert.equal(diditSafetyDryRunStats.diditSafetyProfilesPreserved, 1);
assert.equal(diditSafetyDryRunStats.publicProfilesDeleted, 0);
assert.equal(diditSafetyDryRunStats.writes, 0);
assert.equal(diditSafetyDryRunStats.deletes, 0);
assert.equal(diditSafetyDryRunDb.transactionCalls, 0, 'Didit safety dry-run remains read-only');
assert.deepEqual(
  diditSafetyDryRunDb.stores.publicUsers.get('didit-safety'),
  diditSafetyPublicProfile,
  'dry-run does not alter preserved Didit recovery data',
);

const diditSafetyApplyDb = createFakeDb(
  [['didit-safety', diditSafetyPrivateProfile]],
  [['didit-safety', diditSafetyPublicProfile]],
);
const diditSafetyApplyStats = await reconcile({
  db: diditSafetyApplyDb,
  apply: true,
  uid: 'didit-safety',
  deleteValue: () => DELETE_TOKEN,
});
assert.equal(diditSafetyApplyStats.incompleteUsers, 1);
assert.equal(diditSafetyApplyStats.diditSafetyProfilesPreserved, 1);
assert.equal(diditSafetyApplyStats.publicProfilesDeleted, 0);
assert.equal(diditSafetyApplyStats.writes, 0);
assert.equal(diditSafetyApplyStats.deletes, 0);
assert.equal(diditSafetyApplyDb.transactionCalls, 1, 'apply rechecks Didit safety state transactionally');
assert.equal(diditSafetyApplyDb.transactionWrites.length, 0, 'preserving a safety profile performs no write');
assert.deepEqual(
  diditSafetyApplyDb.stores.publicUsers.get('didit-safety'),
  diditSafetyPublicProfile,
  'preserved safety counters and recovery fields remain unchanged',
);

const diditStaleVisibleDb = createFakeDb(
  [['didit-visible', {
    onboardingComplete: false,
    onboardingStep: 2,
    ageVerified: false,
    isAdult: false,
    idv: { status: 'underage' },
  }]],
  [['didit-visible', {
    uid: 'didit-visible',
    onboardingComplete: true,
    displayName: 'Stale Visible Profile',
    fansCount: 5,
  }]],
);
const diditStaleVisibleStats = await reconcile({
  db: diditStaleVisibleDb,
  apply: true,
  uid: 'didit-visible',
  deleteValue: () => DELETE_TOKEN,
});
assert.equal(diditStaleVisibleStats.incompleteUsers, 1);
assert.equal(diditStaleVisibleStats.diditSafetyProfilesPreserved, 0);
assert.equal(diditStaleVisibleStats.publicProfilesDeleted, 1);
assert.equal(diditStaleVisibleStats.deletes, 1);
assert.equal(
  diditStaleVisibleDb.stores.publicUsers.has('didit-visible'),
  false,
  'a stale visible Didit profile is deleted instead of preserved',
);

const onboardingRaceDb = createFakeDb(
  [['racing', { displayName: 'Pending', onboardingStep: 4, onboardingComplete: false }]],
  [['racing', { onboardingComplete: true, displayName: 'Old public profile' }]],
  {
    beforeFirstTransaction: (stores) => {
      stores.users.set('racing', { displayName: 'Now Complete', onboardingStep: 5, onboardingComplete: true });
      stores.publicUsers.set('racing', {
        uid: 'racing',
        profileId: 'racing',
        ownerUid: 'racing',
        username: 'nowcomplete',
        displayName: 'Now Complete',
        displayNameLower: 'now complete',
        roles: [],
        themes: [],
        onboardingComplete: true,
        onboardingStep: 5,
      });
    },
  },
);
const onboardingRaceStats = await reconcile({
  db: onboardingRaceDb,
  apply: true,
  uid: 'racing',
  deleteValue: () => DELETE_TOKEN,
});
assert.equal(onboardingRaceDb.stores.publicUsers.has('racing'), true, 'a newly valid public profile is not deleted');
assert.equal(onboardingRaceStats.publicProfilesDeleted, 0);
assert.equal(onboardingRaceStats.diditSafetyProfilesPreserved, 0);
assert.equal(
  onboardingRaceDb.transactionWrites.some((write) => write.action === 'delete'),
  false,
  'stale incomplete discovery never causes a destructive apply write',
);

const profileEditRaceDb = createFakeDb(
  [['editing', { displayName: 'Old Name', onboardingStep: 5 }]],
  [['editing', { displayName: 'Old Name', onboardingComplete: true }]],
  {
    beforeFirstTransaction: (stores) => {
      stores.users.set('editing', { displayName: 'Current Name', bio: 'Current bio', onboardingStep: 5 });
    },
  },
);
await reconcile({ db: profileEditRaceDb, apply: true, uid: 'editing', deleteValue: () => DELETE_TOKEN });
assert.equal(profileEditRaceDb.stores.publicUsers.get('editing').displayName, 'Current Name');
assert.equal(profileEditRaceDb.stores.publicUsers.get('editing').bio, 'Current bio');

const orphanRaceDb = createFakeDb(
  [],
  [['new-user', { onboardingComplete: true, displayName: 'New User' }]],
  {
    beforeFirstTransaction: (stores) => {
      stores.users.set('new-user', { displayName: 'New User', onboardingStep: 5 });
    },
  },
);
await reconcile({ db: orphanRaceDb, apply: true, deleteOrphans: true, pageSize: 1 });
assert.equal(orphanRaceDb.stores.publicUsers.has('new-user'), true, 'orphan deletion rechecks current private state');

const failingDb = createFakeDb(
  [['first', { displayName: 'First', onboardingStep: 5 }], ['second', { displayName: 'Second', onboardingStep: 5 }]],
  [],
  { failTransaction: true },
);
await assert.rejects(
  () => reconcile({ db: failingDb, apply: true, pageSize: 1 }),
  /transaction failed/,
);
assert.equal(failingDb.transactionCalls, 1, 'apply stops without reusing or retrying a failed writer');
assert.equal(failingDb.transactionWrites.length, 0, 'failed transaction writes are never reported as committed');

console.log('PASS reconcilePublicUsersForOnboarding.test');
