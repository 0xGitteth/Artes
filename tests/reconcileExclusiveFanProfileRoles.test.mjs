import assert from 'node:assert/strict';
import {
  buildExclusiveFanRoleRepair,
  parseArgs,
  reconcileExclusiveFanProfileRoles,
} from '../functions/scripts/reconcileExclusiveFanProfileRoles.js';

const clone = (value) => structuredClone(value);

const createFakeDb = ({ users, publicUsers }) => {
  const stores = {
    users: new Map(Object.entries(clone(users))),
    publicUsers: new Map(Object.entries(clone(publicUsers))),
  };
  let committedWrites = 0;

  const makeRef = (collectionName, id) => ({
    collectionName,
    id,
    async get() {
      const value = stores[collectionName].get(id);
      return {
        exists: value !== undefined,
        id,
        ref: makeRef(collectionName, id),
        data: () => clone(value || {}),
      };
    },
  });

  const db = {
    collection(collectionName) {
      return {
        doc(id) {
          return makeRef(collectionName, id);
        },
        async get() {
          return {
            docs: [...stores[collectionName].entries()].map(([id, value]) => ({
              id,
              ref: makeRef(collectionName, id),
              data: () => clone(value),
            })),
          };
        },
      };
    },
    batch() {
      const updates = [];
      return {
        update(ref, patch) {
          updates.push({ ref, patch: clone(patch) });
        },
        async commit() {
          for (const { ref, patch } of updates) {
            stores[ref.collectionName].set(ref.id, {
              ...stores[ref.collectionName].get(ref.id),
              ...patch,
            });
          }
          committedWrites += updates.length;
        },
      };
    },
  };

  return {
    db,
    stores,
    get committedWrites() { return committedWrites; },
  };
};

assert.deepEqual(buildExclusiveFanRoleRepair(['fan']), { changed: false, roles: ['fan'] });
assert.deepEqual(buildExclusiveFanRoleRepair(['fan', 'photographer']), {
  changed: true,
  roles: ['photographer'],
});
assert.deepEqual(buildExclusiveFanRoleRepair(['photographer', 'fan', 'artist']), {
  changed: true,
  roles: ['photographer', 'artist'],
});
assert.deepEqual(parseArgs([]), { apply: false, uid: null, help: false, dryRun: true });
assert.deepEqual(parseArgs(['--apply']), { apply: true, uid: null, help: false, dryRun: false });

const fixture = createFakeDb({
  users: {
    mixed: { roles: ['fan', 'photographer'], bio: 'mixed' },
    fanonly: { roles: ['fan'], bio: 'fan' },
    makers: { roles: ['photographer', 'artist'], bio: 'makers' },
  },
  publicUsers: {
    mixed: { roles: ['fan', 'photographer'] },
    fanonly: { roles: ['fan'] },
    makers: { roles: ['photographer', 'artist'] },
  },
});

const beforeDryRun = clone({
  users: Object.fromEntries(fixture.stores.users),
  publicUsers: Object.fromEntries(fixture.stores.publicUsers),
});
const dryStats = await reconcileExclusiveFanProfileRoles({
  db: fixture.db,
  dryRun: true,
  log: () => {},
});
assert.equal(dryStats.privateChanged, 1);
assert.equal(dryStats.publicChanged, 1);
assert.equal(dryStats.writes, 0);
assert.equal(fixture.committedWrites, 0);
assert.deepEqual(Object.fromEntries(fixture.stores.users), beforeDryRun.users);
assert.deepEqual(Object.fromEntries(fixture.stores.publicUsers), beforeDryRun.publicUsers);

const applyStats = await reconcileExclusiveFanProfileRoles({
  db: fixture.db,
  dryRun: false,
  serverTimestamp: () => 'timestamp',
  log: () => {},
});
assert.equal(applyStats.privateChanged, 1);
assert.equal(applyStats.publicChanged, 1);
assert.deepEqual(fixture.stores.users.get('mixed').roles, ['photographer']);
assert.deepEqual(fixture.stores.publicUsers.get('mixed').roles, ['photographer']);
assert.deepEqual(fixture.stores.users.get('fanonly').roles, ['fan']);
assert.deepEqual(fixture.stores.users.get('makers').roles, ['photographer', 'artist']);

const writesAfterFirstApply = fixture.committedWrites;
const secondStats = await reconcileExclusiveFanProfileRoles({
  db: fixture.db,
  dryRun: false,
  serverTimestamp: () => 'timestamp-2',
  log: () => {},
});
assert.equal(secondStats.privateChanged, 0);
assert.equal(secondStats.publicChanged, 0);
assert.equal(secondStats.writes, 0);
assert.equal(fixture.committedWrites, writesAfterFirstApply);

console.log('reconcileExclusiveFanProfileRoles.test.mjs passed');
