import assert from 'node:assert/strict';
import {
  buildPublicUserBackfillPayload,
  isPublishEligibleUser,
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
assert.equal(payload.onboardingComplete, true);
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
assert.equal(isPublishEligibleUser({ onboardingComplete: true }), true, 'completed onboarding does not require age fields');
assert.equal(isPublishEligibleUser({ onboardingStep: 5 }), true, 'legacy step 5 is publish eligible');
assert.equal(isPublishEligibleUser({ onboardingStep: '5' }), true, 'legacy string step 5 is publish eligible');
assert.equal(isPublishEligibleUser({ onboardingStep: 4, ageVerified: true, isAdult: true }), false, 'age fields do not publish incomplete onboarding');

const docs = [
  {
    id: 'retired-registered-no-public',
    data: () => ({ onboardingComplete: true, displayName: 'Retired No Public' }),
  },
  {
    id: 'retired-registered-public',
    data: () => ({ onboardingComplete: true, displayName: 'Retired Public' }),
  },
  {
    id: 'non-default-codex',
    data: () => ({ onboardingComplete: true, isDevTestUser: true, devActor: 'codex' }),
  },
  { id: 'codex-dev-user', data: () => ({ onboardingComplete: true }) },
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
    }),
  },
  {
    id: 'legacy_step_user',
    data: () => ({
      displayName: 'Legacy Step User',
      onboardingStep: 5,
    }),
  },
  {
    id: 'not_eligible_user',
    data: () => ({
      displayName: 'Not Eligible User',
      onboardingStep: 4,
      ageVerified: true,
      isAdult: true,
    }),
  },
];

const createFakeDb = () => {
  const publicUsers = new Map([
    ['retired-registered-public', { displayName: 'Retired Public' }],
    ['non-default-codex', { displayName: 'Marked Codex', ageVerified: true }],
    ['codex-dev-user', { displayName: 'Configured Codex', ageVerified: true }],
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
  const registry = new Set(['retired-registered-no-public', 'retired-registered-public']);
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
      if (name === 'codexDevActorRegistry') return {
        doc: (id) => ({ get: async () => ({ exists: registry.has(id) }) }),
      };
      throw new Error(`Unexpected collection ${name}`);
    },
    batch: () => {
      const pending = [];
      return {
        set: (ref, nextPayload, options) => {
          batchSetCalls += 1;
          pending.push({ ref, payload: nextPayload, options });
        },
        delete: (ref) => pending.push({ ref, delete: true }),
        commit: async () => {
          pending.forEach((write) => {
            queuedWrites.push(write);
            if (write.delete) {
              publicUsers.delete(write.ref.id);
              return;
            }
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
  scanned: 7,
  eligible: 3,
  skippedNotEligible: 1,
  wouldWrite: 3,
  written: 0,
  failed: 0,
  legacyPrivateFieldsFound: 6,
  legacyPrivateFieldsDeleted: 0,
  codexPublicProfilesWouldDelete: 2,
  codexPublicProfilesDeleted: 0,
});
assert.equal(dryRunDb.batchSetCalls, 0, 'dry run must not enqueue writes');
assert.equal(dryRunDb.queuedWrites.length, 0, 'dry run must perform zero writes, including deletes');

const applyDb = createFakeDb();
const applyStats = await runBackfill({ db: applyDb, dryRun: false, serverTimestamp: fakeTimestamp, deleteValue: fakeDelete });
assert.deepEqual(applyStats, {
  scanned: 7,
  eligible: 3,
  skippedNotEligible: 1,
  wouldWrite: 3,
  written: 5,
  failed: 0,
  legacyPrivateFieldsFound: 6,
  legacyPrivateFieldsDeleted: 6,
  codexPublicProfilesWouldDelete: 2,
  codexPublicProfilesDeleted: 2,
});
assert.equal(applyDb.batchSetCalls, 3, 'apply should enqueue every onboarding-eligible publicUsers write');
assert.equal(applyDb.publicUsers.has('codex-dev-user'), false, 'apply deletes the legacy Codex projection');
assert.equal(applyDb.publicUsers.has('retired-registered-public'), false, 'apply deletes a retired registered Codex projection');
assert.equal(applyDb.publicUsers.has('retired-registered-no-public'), false, 'apply never publishes a retired registered Codex actor');
assert.equal(applyDb.publicUsers.has('non-default-codex'), true, 'historical markers alone never select an ordinary user destructively');
const secondApplyStats = await runBackfill({ db: applyDb, dryRun: false, serverTimestamp: fakeTimestamp, deleteValue: fakeDelete });
assert.equal(secondApplyStats.codexPublicProfilesWouldDelete, 0);
assert.equal(secondApplyStats.codexPublicProfilesDeleted, 0, 'second apply is idempotent for Codex deletion');

const writtenPayload = applyDb.queuedWrites.find((write) => write.ref.id === 'eligible_user').payload;
for (const legacyField of ['email', 'didit', 'idv', 'ageVerified', 'isAdult']) {
  assert.equal(writtenPayload[legacyField], '__DELETE__', `${legacyField} should be deleted in the merge payload`);
}
assert.equal(writtenPayload.displayName, 'Eligible User');
assert.equal(writtenPayload.profileId, 'eligible_user');
assert.equal(writtenPayload.ownerUid, 'eligible_user');
assert.deepEqual(writtenPayload.themes, ['Product']);
assert.equal(writtenPayload.quickProfilePreviewMode, 'manual');
assert.deepEqual(writtenPayload.quickProfilePostIds, ['post_1', 'post_2']);
assert.equal(writtenPayload.onboardingComplete, true);

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
assert.equal(updatedPublicUser.onboardingComplete, true);

const legacyStepPublicUser = applyDb.publicUsers.get('legacy_step_user');
assert.equal(legacyStepPublicUser.onboardingComplete, true, 'legacy step publication stamps the public completion marker');

console.log('PASS backfillPublicUsersFromUsers.test');
