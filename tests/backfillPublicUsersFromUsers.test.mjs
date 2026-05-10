import assert from 'node:assert/strict';
import {
  buildPublicUserBackfillPayload,
  runBackfill,
} from '../functions/scripts/backfillPublicUsersFromUsers.js';

const fakeTimestamp = () => '__SERVER_TIMESTAMP__';

const payload = buildPublicUserBackfillPayload('user_1234', {
  username: 'Codex User!',
  displayName: 'Codex User',
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

let batchSetCalls = 0;
const fakeDb = {
  collection: (name) => {
    if (name === 'users') return { get: async () => ({ docs }) };
    if (name === 'publicUsers') return { doc: (id) => ({ path: `publicUsers/${id}` }) };
    throw new Error(`Unexpected collection ${name}`);
  },
  batch: () => ({
    set: () => { batchSetCalls += 1; },
    commit: async () => {},
  }),
};

const stats = await runBackfill({ db: fakeDb, dryRun: true, serverTimestamp: fakeTimestamp });
assert.deepEqual(stats, {
  scanned: 2,
  eligible: 1,
  skippedNotEligible: 1,
  wouldWrite: 1,
  written: 0,
  failed: 0,
});
assert.equal(batchSetCalls, 0, 'dry run must not enqueue writes');

console.log('PASS backfillPublicUsersFromUsers.test');
