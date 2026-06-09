import assert from 'node:assert/strict';
import {
  buildPublicUserBackfillPayload,
  runBackfill,
} from '../functions/scripts/backfillPublicUsersFromUsers.js';

const fakeTimestamp = () => '__SERVER_TIMESTAMP__';
const fakeDelete = () => '__DELETE__';

const payload = buildPublicUserBackfillPayload('user_1234', {
  username: 'Codex User!',
  displayName: 'Codex User',
  profileId: 'spoofed_profile',
  ownerUid: 'spoofed_owner',
  photoURL: 'https://example.com/photo.jpg',
  avatar: 'https://example.com/avatar.jpg',
  roles: ['assistant', '', 42, 'model'],
  themes: ['Product', null, 'Conceptual'],
  bio: 'Public bio',
  headerImage: 'https://example.com/header.jpg',
  headerPosition: 'center',
  linkedAgencyName: 'Agency',
  linkedCompanyName: 'Company',
  linkedAgencyId: 'agency_1',
  linkedCompanyId: 'company_1',
  linkedAgencyStatus: 'approved',
  linkedCompanyStatus: 'pending',
  linkedAgencyLink: null,
  linkedCompanyLink: 'https://example.com/company',
  quickProfilePreviewMode: 'manual',
  quickProfilePostIds: ['post_1', 42, '', 'post_2'],
  email: 'private@example.com',
  legalName: 'Private Legal Name',
  didit: { status: 'approved' },
  idv: { sessionId: 'private-session' },
  ageVerified: true,
  isAdult: true,
  preferences: { triggerVisibility: { test: 'hideFeed' } },
  supportThreadId: 'support_private',
}, { serverTimestamp: fakeTimestamp });

assert.equal(payload.uid, 'user_1234');
assert.equal(payload.profileId, 'user_1234');
assert.equal(payload.ownerUid, 'user_1234');
assert.equal(payload.username, 'codexuser');
assert.equal(payload.displayName, 'Codex User');
assert.equal(payload.displayNameLower, 'codex user');
assert.equal(payload.quickProfilePreviewMode, 'manual');
assert.deepEqual(payload.quickProfilePostIds, ['post_1', 'post_2']);
assert.deepEqual(payload.roles, ['assistant', 'model']);
assert.deepEqual(payload.themes, ['Product', 'Conceptual']);
assert.equal(payload.updatedAt, '__SERVER_TIMESTAMP__');

for (const privateField of ['email', 'legalName', 'didit', 'idv', 'ageVerified', 'isAdult', 'preferences', 'supportThreadId']) {
  assert.equal(Object.prototype.hasOwnProperty.call(payload, privateField), false, `${privateField} must not be public`);
}

const invalidQuickPayload = buildPublicUserBackfillPayload('user_invalid', {
  displayName: 'Invalid Quick Data',
  quickProfilePreviewMode: 123,
  quickProfilePostIds: 'post_1',
  roles: 'assistant',
  themes: null,
}, { serverTimestamp: fakeTimestamp });

assert.equal(Object.prototype.hasOwnProperty.call(invalidQuickPayload, 'quickProfilePreviewMode'), false);
assert.equal(Object.prototype.hasOwnProperty.call(invalidQuickPayload, 'quickProfilePostIds'), false);
assert.deepEqual(invalidQuickPayload.roles, []);
assert.deepEqual(invalidQuickPayload.themes, []);

const docs = [
  {
    id: 'eligible_user',
    data: () => ({
      displayName: 'Eligible User',
      profileId: 'spoofed_profile',
      ownerUid: 'spoofed_owner',
      themes: ['Product'],
      quickProfilePreviewMode: 'manual',
      quickProfilePostIds: ['post_1', 'post_2'],
      onboardingComplete: true,
      ageVerified: true,
      isAdult: true,
    }),
  },
  {
    id: 'not_eligible_user',
    data: () => ({
      displayName: 'Not Eligible User',
      onboardingComplete: true,
      ageVerified: true,
      isAdult: false,
    }),
  },
];

const createFakeDb = () => {
  const publicUsers = new Map([
    ['eligible_user', {
      displayName: 'Stale Eligible User',
      themes: ['Old Theme'],
      email: 'legacy@example.com',
      didit: { status: 'approved' },
      idv: { status: 'approved' },
      ageVerified: true,
      isAdult: true,
    }],
  ]);
  const queuedWrites = [];
  let batchSetCalls = 0;

  const makePublicRef = (id) => ({
    id,
    path: `publicUsers/${id}`,
    get: async () => {
      const data = publicUsers.get(id);
      return {
        exists: Boolean(data),
        data: () => ({ ...(data || {}) }),
      };
    },
  });

  return {
    get batchSetCalls() { return batchSetCalls; },
    get queuedWrites() { return queuedWrites; },
    get publicUsers() { return publicUsers; },
    collection: (name) => {
      if (name === 'users') return { get: async () => ({ docs }) };
      if (name === 'publicUsers') return { doc: makePublicRef };
      throw new Error(`Unexpected collection ${name}`);
    },
    batch: () => {
      const pending = [];
      return {
        set: (ref, nextPayload, options) => {
          batchSetCalls += 1;
          pending.push({ ref, payload: nextPayload, options });
        },
        commit: async () => {
          pending.forEach((write) => {
            queuedWrites.push(write);
            const existing = publicUsers.get(write.ref.id) || {};
            const next = { ...existing };
            Object.entries(write.payload).forEach(([key, value]) => {
              if (value === '__DELETE__') {
                delete next[key];
              } else {
                next[key] = value;
              }
            });
            publicUsers.set(write.ref.id, next);
          });
        },
      };
    },
  };
};

const dryRunDb = createFakeDb();
const dryRunStats = await runBackfill({ db: dryRunDb, dryRun: true, serverTimestamp: fakeTimestamp, deleteValue: fakeDelete });
assert.deepEqual(dryRunStats, {
  scanned: 2,
  eligible: 1,
  skippedNotEligible: 1,
  wouldWrite: 1,
  written: 0,
  failed: 0,
  legacyPrivateFieldsFound: 5,
  legacyPrivateFieldsDeleted: 0,
});
assert.equal(dryRunDb.batchSetCalls, 0, 'dry run must not enqueue writes');

const applyDb = createFakeDb();
const applyStats = await runBackfill({ db: applyDb, dryRun: false, serverTimestamp: fakeTimestamp, deleteValue: fakeDelete });
assert.deepEqual(applyStats, {
  scanned: 2,
  eligible: 1,
  skippedNotEligible: 1,
  wouldWrite: 1,
  written: 1,
  failed: 0,
  legacyPrivateFieldsFound: 5,
  legacyPrivateFieldsDeleted: 5,
});
assert.equal(applyDb.batchSetCalls, 1, 'apply should enqueue one eligible publicUsers write');

const writtenPayload = applyDb.queuedWrites[0].payload;
for (const legacyField of ['email', 'didit', 'idv', 'ageVerified', 'isAdult']) {
  assert.equal(writtenPayload[legacyField], '__DELETE__', `${legacyField} should be deleted in the merge payload`);
}
assert.equal(writtenPayload.displayName, 'Eligible User');
assert.equal(writtenPayload.profileId, 'eligible_user');
assert.equal(writtenPayload.ownerUid, 'eligible_user');
assert.deepEqual(writtenPayload.themes, ['Product']);
assert.equal(writtenPayload.quickProfilePreviewMode, 'manual');
assert.deepEqual(writtenPayload.quickProfilePostIds, ['post_1', 'post_2']);

const updatedPublicUser = applyDb.publicUsers.get('eligible_user');
for (const legacyField of ['email', 'didit', 'idv', 'ageVerified', 'isAdult']) {
  assert.equal(Object.prototype.hasOwnProperty.call(updatedPublicUser, legacyField), false, `${legacyField} should be removed`);
}
assert.equal(updatedPublicUser.displayName, 'Eligible User');
assert.equal(updatedPublicUser.profileId, 'eligible_user');
assert.equal(updatedPublicUser.ownerUid, 'eligible_user');
assert.deepEqual(updatedPublicUser.themes, ['Product']);
assert.equal(updatedPublicUser.quickProfilePreviewMode, 'manual');
assert.deepEqual(updatedPublicUser.quickProfilePostIds, ['post_1', 'post_2']);

console.log('PASS backfillPublicUsersFromUsers.test');
