import assert from 'node:assert/strict';
import { reconcileCodexDevIsolation } from '../functions/scripts/reconcileCodexDevIsolation.js';

const seed = () => new Map(Object.entries({
  'users/marked-test': { isDevTestUser: true, devActor: 'codex', onboardingComplete: true },
  'users/real': { onboardingComplete: true },
  'publicUsers/marked-test': { displayName: 'Legacy Codex' },
  'publicUsers/real': { displayName: 'Real' },
  'posts/test-post': { authorId: 'marked-test' },
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
  'contributors/test-contributor': { createdByUid: 'marked-test' },
  'contributors/real-contributor': { createdByUid: 'real' },
  'contributorAliases/test-alias': { contributorId: 'test-contributor' },
  'contributorAliases/real-alias': { contributorId: 'real-contributor' },
  'claimInvites/test-invite': { contributorId: 'test-contributor', createdByUid: 'marked-test' },
  'claimInvites/test-invite-real-contributor': { contributorId: 'real-contributor', createdByUid: 'marked-test' },
  'claimInvites/real-invite': { contributorId: 'real-contributor', createdByUid: 'real' },
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

const dryDocs = seed();
const dryStats = await reconcileCodexDevIsolation({ db: fakeDb(dryDocs), apply: false, env: {} });
assert.deepEqual(dryStats, { actors: 1, publicUsers: 1, posts: 1, managedProfiles: 1, communityComments: 1, reviewCases: 2, moderationExamples: 1, contributors: 1, contributorAliases: 1, claimInvites: 2, supportThreads: 1, postComments: 1, postLikes: 1, dmThreads: 1, threadIndexes: 3, deletes: 18 });
assert.equal(dryDocs.has('posts/test-post'), true, 'dry run does not mutate');

const applyDocs = seed();
const applyStats = await reconcileCodexDevIsolation({ db: fakeDb(applyDocs), apply: true, env: {} });
assert.equal(applyStats.deletes, 18);
for (const removed of ['publicUsers/marked-test', 'posts/test-post', 'posts/test-post/comments/comment', 'posts/real-post/comments/test-engagement', 'posts/real-post/likes/marked-test', 'profiles/test-agency', 'reviewCases/test-review', 'reviewCases/test-report', 'moderationExamples/test-example', 'contributors/test-contributor', 'contributorAliases/test-alias', 'claimInvites/test-invite', 'claimInvites/test-invite-real-contributor', 'communities/art/topics/topic/comments/test-comment', 'threads/dm_test_real', 'users/real/threadIndex/dm_test_real', 'threads/support_marked-test', 'users/marked-test/threadIndex/support_marked-test']) {
  assert.equal(applyDocs.has(removed), false, `${removed} removed`);
}
for (const preserved of ['publicUsers/real', 'posts/real-post', 'posts/real-post/comments/real-engagement', 'posts/real-post/likes/real', 'profiles/real-agency', 'reviewCases/real-review', 'moderationExamples/real-example', 'contributors/real-contributor', 'contributorAliases/real-alias', 'claimInvites/real-invite', 'communities/art/topics/topic/comments/real-comment', 'threads/dm_real_other', 'users/real/threadIndex/dm_real_other', 'threads/support_real']) {
  assert.equal(applyDocs.has(preserved), true, `${preserved} preserved`);
}
assert.equal((await reconcileCodexDevIsolation({ db: fakeDb(applyDocs), apply: true, env: {} })).deletes, 0, 'second apply is idempotent');

console.log('PASS codexDevLegacyCleanup.test');
