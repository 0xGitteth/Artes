import assert from 'node:assert/strict';
import { reconcileCodexDevIsolation } from '../functions/scripts/reconcileCodexDevIsolation.js';

const seed = () => new Map(Object.entries({
  'users/marked-test': { isDevTestUser: true, devActor: 'codex', onboardingComplete: true, contributorId: 'claimed-by-test' },
  'users/real': { onboardingComplete: true },
  'users/suspicious-marker': { isDevTestUser: true, devActor: 'codex', onboardingComplete: true },
  'publicUsers/marked-test': { displayName: 'Legacy Codex' },
  'publicUsers/real': { displayName: 'Real' },
  'publicUsers/suspicious-marker': { displayName: 'Ordinary historical user' },
  'posts/test-post': { authorId: 'marked-test' },
  'posts/test-managed-post': { authorId: 'test-agency', authorUid: 'marked-test' },
  'posts/ordinary-managed-post': { authorId: 'real-agency', authorUid: 'real' },
  'posts/test-post/comments/comment': { authorId: 'marked-test' },
  'posts/test-post/likes/real': { createdAt: 1 },
  'posts/real-post': { authorId: 'real' },
  'posts/real-post/comments/test-engagement': { authorId: 'marked-test' },
  'posts/real-post/comments/real-engagement': { authorId: 'real' },
  'posts/real-post/likes/marked-test': { createdAt: 1 },
  'posts/real-post/likes/real': { createdAt: 1 },
  'profiles/test-agency': { ownerUid: 'marked-test', type: 'agency', status: 'active' },
  'profiles/real-agency': { ownerUid: 'real', type: 'agency', status: 'active' },
  'reviewCases/test-review': { userId: 'marked-test', status: 'inReview' },
  'reviewCases/real-review': { userId: 'real', status: 'inReview' },
  'reviewCases/test-report': { userId: 'real', reportedByUid: 'marked-test', status: 'inReview' },
  'moderationExamples/test-example': { uploaderUid: 'marked-test' },
  'moderationExamples/real-example': { uploaderUid: 'real' },
  'moderationExamples/report-linked-example': { uploaderUid: 'real', reviewCaseId: 'test-report' },
  'moderationExamples/real-linked-example': { uploaderUid: 'real', reviewCaseId: 'real-review' },
  'contributors/test-contributor': { createdByUid: 'marked-test' },
  'contributors/real-contributor': { createdByUid: 'real' },
  'contributors/claimed-by-test': { createdByUid: 'real', claimedByUid: 'marked-test', status: 'claimed' },
  'contributorAliases/test-alias': { contributorId: 'test-contributor' },
  'contributorAliases/real-alias': { contributorId: 'real-contributor' },
  'claimInvites/test-invite': { contributorId: 'test-contributor', createdByUid: 'marked-test' },
  'claimInvites/test-invite-real-contributor': { contributorId: 'real-contributor', createdByUid: 'marked-test' },
  'claimInvites/real-invite': { contributorId: 'real-contributor', createdByUid: 'real' },
  'claimRequests/test-claim': { contributorId: 'real-contributor', requestedByUid: 'marked-test', status: 'pending' },
  'claimVouches/test-claim/votes/voter': { voterUid: 'real', vote: 'yes' },
  'claimRequests/real-claim': { contributorId: 'real-contributor', requestedByUid: 'real', status: 'pending' },
  'claimRequests/approved-test-claim': { contributorId: 'claimed-by-test', requestedByUid: 'marked-test', status: 'approved' },
  'claimVouches/real-claim/votes/voter': { voterUid: 'other', vote: 'yes' },
  'claimVouches/real-claim/votes/marked-test': { voterUid: 'marked-test', vote: 'no' },
  'communities/art/topics/topic/comments/test-comment': { authorId: 'marked-test' },
  'communities/art/topics/topic/comments/real-comment': { authorId: 'real' },
  'threads/dm_test_real': { type: 'dm', participantUids: ['marked-test', 'real'] },
  'threads/dm_test_real/messages/message': { senderUid: 'real' },
  'users/marked-test/threadIndex/dm_test_real': { threadId: 'dm_test_real' },
  'users/real/threadIndex/dm_test_real': { threadId: 'dm_test_real' },
  'threads/dm_real_other': { type: 'dm', participantUids: ['real', 'other'] },
  'users/real/threadIndex/dm_real_other': { threadId: 'dm_real_other' },
  'threads/support_marked-test': { type: 'support', userUid: 'marked-test' },
  'threads/support_marked-test/messages/test-support': { senderUid: 'marked-test' },
  'users/marked-test/threadIndex/support_marked-test': { threadId: 'support_marked-test' },
  'threads/support_real': { type: 'support', userUid: 'real' },
  'users/real/threadIndex/support_real': { threadId: 'support_real' },
}));

const fakeDb = (docs) => {
  const refFor = (path) => ({
    path,
    id: path.split('/').at(-1),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    delete: async () => docs.delete(path),
    set: async (payload, options) => docs.set(path, { ...(options?.merge ? (docs.get(path) || {}) : {}), ...payload }),
    collection: (name) => collectionFor(`${path}/${name}`),
  });
  const snapshots = (prefix, direct = true) => [...docs.entries()]
    .filter(([path]) => path.startsWith(`${prefix}/`) && (!direct || path.split('/').length === prefix.split('/').length + 1))
    .map(([path, data]) => ({ id: path.split('/').at(-1), ref: refFor(path), data: () => data }));
  const collectionFor = (path) => ({
    doc: (id) => refFor(`${path}/${id}`),
    get: async () => ({ docs: snapshots(path) }),
    where: (field, op, value) => ({ get: async () => ({ docs: snapshots(path).filter((doc) => {
      const actual = doc.data()?.[field];
      return op === 'array-contains' ? Array.isArray(actual) && actual.includes(value) : actual === value;
    }) }) }),
  });
  return {
    collection: collectionFor,
    collectionGroup: (name) => ({ where: (field, _op, value) => ({ get: async () => ({ docs: [...docs.entries()]
      .filter(([path, data]) => path.split('/').at(-2) === name && data?.[field] === value)
      .map(([path, data]) => ({ id: path.split('/').at(-1), ref: refFor(path), data: () => data })) }) }) }),
    recursiveDelete: async (ref) => [...docs.keys()].filter((path) => path === ref.path || path.startsWith(`${ref.path}/`)).forEach((path) => docs.delete(path)),
  };
};

const fakeBucket = (paths) => ({
  getFiles: async ({ prefix }) => [[...paths].filter((path) => path.startsWith(prefix)).map((path) => ({ name: path, delete: async () => paths.delete(path) }))],
});

const dryDocs = seed();
const dryProofs = new Set(['claimProofs/test-claim/marked-test.png', 'claimProofs/real-claim/real.png']);
const dryStats = await reconcileCodexDevIsolation({ db: fakeDb(dryDocs), bucket: fakeBucket(dryProofs), apply: false, env: {}, uid: 'marked-test' });
assert.equal(dryStats.targetUid, 'marked-test');
assert.equal(dryStats.posts, 2);
assert.equal(dryStats.reviewCases, 2);
assert.equal(dryStats.linkedModerationExamples, 1);
assert.equal(dryStats.claimVotes, 1);
assert.deepEqual(dryStats.ambiguousMarkerUids, ['suspicious-marker']);
assert.equal(dryDocs.has('posts/test-post'), true, 'dry run does not mutate');
assert.equal(dryProofs.size, 2, 'dry run preserves claim proof objects');

const applyDocs = seed();
const applyProofs = new Set(dryProofs);
const applyStats = await reconcileCodexDevIsolation({ db: fakeDb(applyDocs), bucket: fakeBucket(applyProofs), apply: true, env: {}, uid: 'marked-test', skipStorage: false });
assert.equal(applyStats.deletes, 25);
for (const removed of ['publicUsers/marked-test', 'posts/test-post', 'posts/test-managed-post', 'posts/test-post/comments/comment', 'posts/real-post/comments/test-engagement', 'posts/real-post/likes/marked-test', 'profiles/test-agency', 'reviewCases/test-review', 'reviewCases/test-report', 'moderationExamples/test-example', 'moderationExamples/report-linked-example', 'contributors/test-contributor', 'contributorAliases/test-alias', 'claimInvites/test-invite', 'claimInvites/test-invite-real-contributor', 'claimRequests/test-claim', 'claimRequests/approved-test-claim', 'claimVouches/test-claim/votes/voter', 'claimVouches/real-claim/votes/marked-test', 'communities/art/topics/topic/comments/test-comment', 'threads/dm_test_real', 'users/real/threadIndex/dm_test_real', 'threads/support_marked-test', 'users/marked-test/threadIndex/support_marked-test']) {
  assert.equal(applyDocs.has(removed), false, `${removed} removed`);
}
assert.equal(applyDocs.get('contributors/claimed-by-test').status, 'unclaimed');
assert.equal(applyDocs.get('contributors/claimed-by-test').claimedByUid, null);
assert.equal(applyDocs.get('users/marked-test').contributorId, null);
assert.deepEqual([...applyProofs], ['claimProofs/real-claim/real.png']);
for (const preserved of ['publicUsers/real', 'publicUsers/suspicious-marker', 'posts/real-post', 'posts/ordinary-managed-post', 'posts/real-post/comments/real-engagement', 'posts/real-post/likes/real', 'profiles/real-agency', 'reviewCases/real-review', 'moderationExamples/real-example', 'moderationExamples/real-linked-example', 'contributors/real-contributor', 'contributorAliases/real-alias', 'claimInvites/real-invite', 'claimRequests/real-claim', 'claimVouches/real-claim/votes/voter', 'communities/art/topics/topic/comments/real-comment', 'threads/dm_real_other', 'users/real/threadIndex/dm_real_other', 'threads/support_real']) {
  assert.equal(applyDocs.has(preserved), true, `${preserved} preserved`);
}
assert.equal((await reconcileCodexDevIsolation({ db: fakeDb(applyDocs), bucket: fakeBucket(applyProofs), apply: true, env: {}, uid: 'marked-test', skipStorage: false })).deletes, 0, 'second apply is idempotent');

const missingUser = new Map([['publicUsers/canonical-missing-user', { displayName: 'legacy' }]]);
const missingStats = await reconcileCodexDevIsolation({ db: fakeDb(missingUser), apply: true, uid: 'canonical-missing-user', skipStorage: true });
assert.equal(missingStats.publicUsers, 1, 'canonical UID cleanup does not require users/{uid}');
assert.equal(missingUser.size, 0);
await assert.rejects(reconcileCodexDevIsolation({ db: fakeDb(new Map()), apply: true, skipStorage: true, env: {} }), /trustworthy canonical UID/);

console.log('PASS codexDevLegacyCleanup.test');
