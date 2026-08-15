import assert from 'node:assert/strict';
import { reconcileCodexDevIsolation } from '../functions/scripts/reconcileCodexDevIsolation.js';

const noModeratorAuth = { getUser: async () => ({ email: null }) };
const DELETE_FIELD = Symbol('DELETE_FIELD');

const applyPayload = (current = {}, payload = {}, merge = true) => {
  const next = merge ? { ...current } : {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === DELETE_FIELD) delete next[key];
    else next[key] = value;
  }
  return next;
};

const seed = () => new Map(Object.entries({
  'users/marked-test': { isDevTestUser: true, devActor: 'codex', onboardingComplete: true, contributorId: 'claimed-by-test' },
  'users/real': { onboardingComplete: true, contributorId: 'real-claimed-test-contributor', linkedAgencyId: 'marked-test', linkedAgencyName: 'Codex Agency', linkedAgencyLink: 'https://codex.test/agency', linkedAgencyStatus: 'approved', linkedAgencyApprovedBy: 'marked-test', linkedCompanyId: 'test-agency', linkedCompanyName: 'Codex Company', linkedCompanyLink: 'https://codex.test/company', linkedCompanyStatus: 'pending' },
  'users/other': { onboardingComplete: true },
  'users/suspicious-marker': { isDevTestUser: true, devActor: 'codex', onboardingComplete: true },
  'publicUsers/marked-test': { displayName: 'Legacy Codex' },
  'publicUsers/real': { displayName: 'Real', fansCount: 3, fanOfCount: 4, linkedAgencyId: 'marked-test', linkedAgencyName: 'Codex Agency', linkedAgencyLink: 'https://codex.test/agency', linkedAgencyStatus: 'approved', linkedCompanyId: 'test-agency', linkedCompanyName: 'Codex Company', linkedCompanyLink: 'https://codex.test/company', linkedCompanyStatus: 'pending' },
  'publicUsers/other': { displayName: 'Other', fanOfCount: 5 },
  'publicUsers/suspicious-marker': { displayName: 'Ordinary historical user' },
  'posts/test-post': { authorId: 'marked-test' },
  'posts/test-managed-post': { authorId: 'test-agency', authorUid: 'marked-test' },
  'posts/ordinary-managed-post': { authorId: 'real-agency', authorUid: 'real' },
  'posts/test-post/comments/comment': { authorId: 'marked-test' },
  'posts/test-post/likes/real': { createdAt: 1 },
  'posts/real-post': { authorId: 'real' },
  'users/real/moodboards/inspo': { ownerUid: 'real', postCount: 4, coverPostIds: ['real-empty', 'test-post', 'real-post'], coverImageUrls: ['', 'https://codex.test/post.jpg', 'https://real.test/post.jpg'] },
  'users/real/moodboards/inspo/items/real-empty': { postId: 'real-empty', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: '', title: 'No cover', authorId: 'real' } },
  'users/real/moodboards/inspo/items/test-post': { postId: 'test-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://codex.test/post.jpg', title: 'Codex snapshot', authorId: 'marked-test' } },
  'users/real/moodboards/inspo/items/stale-codex': { postId: 'already-deleted-codex', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://codex.test/stale.jpg', title: 'Stale Codex snapshot', authorId: 'marked-test' } },
  'users/real/moodboards/inspo/items/real-post': { postId: 'real-post', ownerUid: 'real', moodboardId: 'inspo', postSnapshot: { imageUrl: 'https://real.test/post.jpg', title: 'Real snapshot', authorId: 'real' } },
  'posts/real-post/comments/test-engagement': { authorId: 'marked-test' },
  'posts/real-post/comments/real-engagement': { authorId: 'real' },
  'posts/real-post/likes/marked-test': { createdAt: 1 },
  'posts/real-post/likes/real': { createdAt: 1 },
  'profiles/test-agency': { ownerUid: 'marked-test', type: 'agency', status: 'active' },
  'profiles/real-agency': { ownerUid: 'real', type: 'agency', status: 'active' },
  'reviewCases/test-review': { userId: 'marked-test', status: 'inReview' },
  'reviewCases/real-review': { userId: 'real', status: 'inReview' },
  'reviewCases/test-report': { userId: 'real', reportedByUid: 'marked-test', status: 'inReview' },
  'reviewCases/approved-test-report': { caseType: 'report', userId: 'real', reportedByUid: 'marked-test', status: 'approved', reportedPostId: 'deleted-real-post', reportedPostPath: 'posts/deleted-real-post', evidenceSnapshot: { title: 'Recovery evidence' } },
  'moderationExamples/test-example': { uploaderUid: 'marked-test' },
  'moderationExamples/real-example': { uploaderUid: 'real' },
  'moderationExamples/report-linked-example': { uploaderUid: 'real', reviewCaseId: 'test-report' },
  'moderationExamples/approved-report-linked-example': { uploaderUid: 'real', reviewCaseId: 'approved-test-report' },
  'moderationExamples/real-linked-example': { uploaderUid: 'real', reviewCaseId: 'real-review' },
  'userModeration/real': { blockedFingerprints: [{ sha256: 'codex', reviewCaseId: 'test-report' }, { sha256: 'approved-codex', reviewCaseId: 'approved-test-report' }, { sha256: 'real', reviewCaseId: 'real-review' }], strikes: 2 },
  'contributors/test-contributor': { createdByUid: 'marked-test' },
  'contributors/test-claimed-by-codex': { createdByUid: 'marked-test', claimedByUid: 'marked-test', status: 'claimed' },
  'contributors/pending-claim-contributor': { createdByUid: 'marked-test', status: 'unclaimed' },
  'contributors/moderation-claim-contributor': { createdByUid: 'marked-test', status: 'unclaimed' },
  'contributors/denied-claim-contributor': { createdByUid: 'marked-test', status: 'unclaimed' },
  'contributors/real-claimed-test-contributor': { createdByUid: 'marked-test', claimedByUid: 'real', status: 'claimed' },
  'contributors/real-contributor': { createdByUid: 'real' },
  'contributors/claimed-by-test': { createdByUid: 'real', claimedByUid: 'marked-test', status: 'claimed' },
  'contributors/merge-primary': { createdByUid: 'real', displayName: 'Merge Primary' },
  'contributors/merge-secondary': { createdByUid: 'marked-test', claimedByUid: 'marked-test', status: 'merged', displayName: 'Merge Secondary Recovery', mergedInto: 'merge-primary' },
  'contributorAliases/test-alias': { contributorId: 'test-contributor', createdByUid: 'marked-test', type: 'instagram' },
  'contributorAliases/codex-claimed-test-alias': { contributorId: 'test-claimed-by-codex', createdByUid: 'marked-test', type: 'domain' },
  'contributorAliases/pending-claim-alias': { contributorId: 'pending-claim-contributor', createdByUid: 'marked-test', type: 'instagram' },
  'contributorAliases/moderation-claim-alias': { contributorId: 'moderation-claim-contributor', createdByUid: 'marked-test', type: 'domain' },
  'contributorAliases/denied-claim-alias': { contributorId: 'denied-claim-contributor', createdByUid: 'marked-test', type: 'email' },
  'contributorAliases/real-claimed-test-alias': { contributorId: 'real-claimed-test-contributor', createdByUid: 'marked-test', type: 'instagram' },
  'contributorAliases/real-claimed-email-alias': { contributorId: 'real-claimed-test-contributor', createdByUid: 'marked-test', type: 'email' },
  'contributorAliases/real-claimed-domain-alias': { contributorId: 'real-claimed-test-contributor', type: 'domain' },
  'contributorAliases/real-alias': { contributorId: 'real-contributor' },
  'claimInvites/test-invite': { contributorId: 'test-contributor', createdByUid: 'marked-test' },
  'claimInvites/test-invite-real-contributor': { contributorId: 'real-contributor', createdByUid: 'marked-test' },
  'claimInvites/real-invite': { contributorId: 'real-contributor', createdByUid: 'real' },
  'contributorContentRequests/test-content-request': { contributorId: 'real-contributor', requesterUid: 'marked-test' },
  'contributorContentRequests/real-content-request': { contributorId: 'real-contributor', requesterUid: 'real' },
  'claimRequests/test-claim': { contributorId: 'real-contributor', requestedByUid: 'marked-test', status: 'pending' },
  'claimVouches/test-claim/votes/voter': { voterUid: 'real', vote: 'yes' },
  'claimRequests/real-claim': { contributorId: 'real-contributor', requestedByUid: 'real', status: 'needsModeration', statusReason: 'vouch conflict', yesCount: 1, noCount: 1 },
  'claimRequests/pending-ordinary-claim': { contributorId: 'pending-claim-contributor', requestedByUid: 'real', status: 'pending' },
  'claimRequests/moderation-ordinary-claim': { contributorId: 'moderation-claim-contributor', requestedByUid: 'other', status: 'needsModeration' },
  'claimRequests/denied-ordinary-claim': { contributorId: 'denied-claim-contributor', requestedByUid: 'real', status: 'denied' },
  'claimVouches/moderation-ordinary-claim/votes/voter': { voterUid: 'real', vote: 'yes' },
  'claimRequests/proof-review-claim': { contributorId: 'real-contributor', requestedByUid: 'real', status: 'needsModeration', statusReason: 'proof required', yesCount: 1, noCount: 1 },
  'claimRequests/approved-test-claim': { contributorId: 'claimed-by-test', requestedByUid: 'marked-test', status: 'approved' },
  'claimRequests/approved-test-merge': { contributorId: 'merge-primary', requestedByUid: 'marked-test', mode: 'merge', status: 'approved', primaryContributorId: 'merge-primary', secondaryContributorId: 'merge-secondary', mergeAudit: { updatedPosts: 2 } },
  'claimRequests/ordinary-approved-merge': { contributorId: 'ordinary-primary', requestedByUid: 'real', mode: 'merge', status: 'approved', primaryContributorId: 'ordinary-primary', secondaryContributorId: 'ordinary-secondary' },
  'contributorAliases/merge-evidence-alias': { contributorId: 'merge-primary', createdByUid: 'marked-test', type: 'instagram' },
  'contributorAliases/merge-secondary-evidence-alias': { contributorId: 'merge-secondary', createdByUid: 'marked-test', type: 'instagram' },
  'claimVouches/real-claim/votes/voter': { voterUid: 'other', vote: 'yes' },
  'claimVouches/real-claim/votes/marked-test': { voterUid: 'marked-test', vote: 'no' },
  'claimVouches/proof-review-claim/votes/voter': { voterUid: 'other', vote: 'yes' },
  'claimVouches/proof-review-claim/votes/marked-test': { voterUid: 'marked-test', vote: 'no' },
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
  'threads/support_real': { type: 'support', userUid: 'real', lastMessageText: 'Codex decision', lastMessageAt: 3, lastSenderUid: 'system' },
  'threads/support_real/messages/user-message': { type: 'text', senderUid: 'real', text: 'Real question', createdAt: 1 },
  'threads/support_real/messages/codex-decision': { type: 'moderation_decision', senderUid: 'system', text: 'Codex decision', createdAt: 3, metadata: { reviewCaseId: 'test-report' } },
  'threads/support_real/messages/approved-codex-decision': { type: 'moderation_decision', senderUid: 'system', text: 'Approved Codex decision', createdAt: 4, metadata: { reviewCaseId: 'approved-test-report' } },
  'threads/support_real/messages/real-decision': { type: 'moderation_decision', senderUid: 'system', text: 'Real decision', createdAt: 2, metadata: { reviewCaseId: 'real-review' } },
  'users/real/threadIndex/support_real': { threadId: 'support_real', lastMessageAt: 3 },
  'users/marked-test/following/real': { targetUid: 'real', countersApplied: true },
  'users/marked-test/following/no-counter': { targetUid: 'no-counter', countersApplied: false },
  'users/real/following/marked-test': { targetUid: 'marked-test', countersApplied: true },
  'users/other/following/marked-test': { targetUid: 'marked-test', countersApplied: true },
  'codexDevCounterRepairs/other__marked-test': { repaired: 'fanOfCount' },
  'users/real/following/other': { targetUid: 'other', countersApplied: true },
}));

const fakeDb = (docs) => {
  const refFor = (path) => ({
    path,
    id: path.split('/').at(-1),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    delete: async () => docs.delete(path),
    set: async (payload, options) => docs.set(path, applyPayload(docs.get(path) || {}, payload, options?.merge === true)),
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
      .filter(([path, data]) => {
        if (path.split('/').at(-2) !== name) return false;
        const actual = String(field).split('.').reduce((current, key) => current?.[key], data);
        return actual === value;
      })
      .map(([path, data]) => ({ id: path.split('/').at(-1), ref: refFor(path), data: () => data })) }) }) }),
    recursiveDelete: async (ref) => [...docs.keys()].filter((path) => path === ref.path || path.startsWith(`${ref.path}/`)).forEach((path) => docs.delete(path)),
    runTransaction: async (callback) => {
      const pending = [];
      const result = await callback({
        get: async (ref) => ref.get(),
        delete: (ref) => pending.push(() => docs.delete(ref.path)),
        update: (ref, payload) => pending.push(() => docs.set(ref.path, applyPayload(docs.get(ref.path) || {}, payload, true))),
        set: (ref, payload, options) => pending.push(() => docs.set(ref.path, applyPayload(docs.get(ref.path) || {}, payload, options?.merge === true))),
      });
      if (pending.length > 500) throw new Error(`fake Firestore transaction write limit exceeded: ${pending.length}`);
      pending.forEach((apply) => apply());
      return result;
    },
  };
};

const fakeBucket = (paths) => ({
  getFiles: async ({ prefix }) => [[...paths].filter((path) => path.startsWith(prefix)).map((path) => ({ name: path, delete: async () => paths.delete(path) }))],
});
const fakeFieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP', delete: () => DELETE_FIELD };

const dryDocs = seed();
const dryProofs = new Set(['claimProofs/test-claim/marked-test.png', 'claimProofs/real-claim/real.png']);
const dryStats = await reconcileCodexDevIsolation({ db: fakeDb(dryDocs), bucket: fakeBucket(dryProofs), apply: false, env: {}, uid: 'marked-test' });
assert.equal(dryStats.targetUid, 'marked-test');
assert.equal(dryStats.posts, 2);
assert.equal(dryStats.affiliationUsers, 1);
assert.equal(dryStats.affiliationPublicUsers, 1);
assert.equal(dryStats.affiliationsCleared, 4);
assert.equal(dryStats.moodboardItems, 2);
assert.equal(dryStats.moodboardsRepaired, 1);
assert.equal(dryStats.reviewCases, 2);
assert.equal(dryStats.autoCleanableReviewCases, 2);
assert.equal(dryStats.contentRecoveryReviewCases, 1);
assert.equal(dryStats.linkedModerationExamples, 2);
assert.equal(dryStats.claimVotes, 2);
assert.equal(dryStats.blockedFingerprints, 2);
assert.equal(dryStats.supportDecisionMessages, 2);
assert.equal(dryStats.manualReviewRequired.some((item) => item.reason === 'codex_report_content_recovery' && item.reviewCaseId === 'approved-test-report'), true);
assert.equal(dryStats.manualReviewRequired.some((item) => item.reason === 'codex_created_contributor_claimed_by_real_user' && item.contributorId === 'real-claimed-test-contributor'), true);
assert.equal(dryStats.contributorContentRequests, 1);
assert.equal(dryStats.outgoingFollows, 2);
assert.equal(dryStats.incomingFollows, 2);
assert.equal(dryStats.followCounterRepairs, 3);
assert.equal(dryStats.preservedContributors, 4);
assert.equal(dryStats.preservedContributorAliases, 7);
assert.equal(dryStats.manualReviewRequired.some((item) => item.reason === 'codex_created_contributor_with_active_ordinary_claim' && item.contributorId === 'pending-claim-contributor'), true);
assert.equal(dryStats.manualReviewRequired.some((item) => item.reason === 'codex_created_contributor_with_active_ordinary_claim' && item.contributorId === 'moderation-claim-contributor'), true);
assert.equal(dryStats.manualReviewRequired.some((item) => item.reason === 'codex_approved_merge_claim_recovery' && item.claimRequestId === 'approved-test-merge'), true);
assert.deepEqual(dryStats.ambiguousMarkerUids, ['suspicious-marker']);
assert.equal(dryStats.targetUidAlreadyRegistered, false);
assert.equal(dryStats.applyWouldEnsureRegistration, true);
assert.equal(dryDocs.has('codexDevActorRegistry/marked-test'), false, 'dry run does not register target');
assert.equal(dryDocs.has('posts/test-post'), true, 'dry run does not mutate');
assert.equal(dryProofs.size, 2, 'dry run preserves claim proof objects');

const applyDocs = seed();
const applyProofs = new Set(dryProofs);
const applyStats = await reconcileCodexDevIsolation({ db: fakeDb(applyDocs), bucket: fakeBucket(applyProofs), apply: true, auth: noModeratorAuth, env: {}, uid: 'marked-test', skipStorage: false, fieldValue: fakeFieldValue });
assert.equal(applyDocs.get('codexDevActorRegistry/marked-test').uid, 'marked-test');
assert.equal(applyDocs.get('codexDevActorRegistry/marked-test').actor, 'codex');
assert.equal(applyDocs.get('codexDevActorRegistry/marked-test').productionDenyOnly, true);
assert.deepEqual(applyDocs.get('codexDevActorRegistry/marked-test').cleanupManagedProfileIds, ['test-agency']);
assert.deepEqual(applyDocs.get('codexDevActorRegistry/marked-test').cleanupPostIds, ['test-managed-post', 'test-post']);
assert.equal(applyStats.targetUidRegistered, true);
assert.equal(applyDocs.has('codexDevActorRegistry/suspicious-marker'), false, 'ambiguous marker is never registered');
assert.equal(applyStats.deletes, 42);
for (const removed of ['publicUsers/marked-test', 'posts/test-post', 'posts/test-managed-post', 'posts/test-post/comments/comment', 'users/real/moodboards/inspo/items/test-post', 'users/real/moodboards/inspo/items/stale-codex', 'posts/real-post/comments/test-engagement', 'posts/real-post/likes/marked-test', 'profiles/test-agency', 'reviewCases/test-review', 'reviewCases/test-report', 'moderationExamples/test-example', 'moderationExamples/report-linked-example', 'moderationExamples/approved-report-linked-example', 'contributors/test-contributor', 'contributors/test-claimed-by-codex', 'contributors/denied-claim-contributor', 'contributorAliases/test-alias', 'contributorAliases/codex-claimed-test-alias', 'contributorAliases/denied-claim-alias', 'claimInvites/test-invite', 'claimInvites/test-invite-real-contributor', 'contributorContentRequests/test-content-request', 'claimRequests/test-claim', 'claimRequests/approved-test-claim', 'claimVouches/test-claim/votes/voter', 'claimVouches/real-claim/votes/marked-test', 'claimVouches/proof-review-claim/votes/marked-test', 'communities/art/topics/topic/comments/test-comment', 'threads/dm_test_real', 'users/real/threadIndex/dm_test_real', 'threads/support_marked-test', 'users/marked-test/threadIndex/support_marked-test', 'threads/support_real/messages/codex-decision', 'threads/support_real/messages/approved-codex-decision', 'users/marked-test/following/real', 'users/marked-test/following/no-counter', 'users/real/following/marked-test', 'users/other/following/marked-test']) {
  assert.equal(applyDocs.has(removed), false, `${removed} removed`);
}
assert.equal(applyDocs.get('contributors/claimed-by-test').status, 'unclaimed');
assert.equal(applyDocs.get('contributors/claimed-by-test').claimedByUid, null);
assert.equal(applyDocs.get('contributors/merge-secondary').displayName, 'Merge Secondary Recovery');
assert.equal(applyDocs.get('contributors/merge-secondary').mergedInto, 'merge-primary');
assert.equal(applyDocs.get('users/marked-test').contributorId, null);
assert.equal(applyDocs.get('reviewCases/approved-test-report').evidenceSnapshot.title, 'Recovery evidence');
assert.deepEqual(applyDocs.get('userModeration/real').blockedFingerprints, [{ sha256: 'real', reviewCaseId: 'real-review' }]);
assert.equal(applyDocs.get('userModeration/real').strikes, 2);
assert.equal(applyDocs.get('threads/support_real').lastMessageText, 'Real decision');
assert.equal(applyDocs.get('threads/support_real').lastMessageAt, 2);
assert.equal(applyDocs.get('claimRequests/real-claim').status, 'pending');
assert.equal(applyDocs.get('claimRequests/real-claim').statusReason, null);
assert.equal(applyDocs.get('claimRequests/real-claim').yesCount, 1);
assert.equal(applyDocs.get('claimRequests/real-claim').noCount, 0);
assert.equal(applyDocs.get('claimRequests/proof-review-claim').status, 'needsModeration');
assert.equal(applyDocs.get('claimRequests/proof-review-claim').statusReason, 'proof required');
assert.equal(applyDocs.get('publicUsers/real').fansCount, 2);
assert.equal(applyDocs.get('publicUsers/real').fanOfCount, 3);
const privateProfile = applyDocs.get('users/real');
assert.equal(privateProfile.linkedAgencyId, null, 'private direct Codex agency affiliation cleared');
assert.equal(privateProfile.linkedAgencyName, '');
assert.equal(privateProfile.linkedAgencyLink, null);
assert.equal(privateProfile.linkedAgencyStatus, null);
assert.equal(privateProfile.linkedCompanyId, null, 'private Codex-managed company affiliation cleared');
assert.equal(privateProfile.linkedCompanyName, '');
assert.equal(privateProfile.linkedCompanyLink, null);
assert.equal(privateProfile.linkedCompanyStatus, null);
const publicProfile = applyDocs.get('publicUsers/real');
assert.equal(publicProfile.linkedAgencyId, null, 'public direct Codex agency affiliation cleared');
assert.equal(publicProfile.linkedAgencyName, '');
assert.equal(publicProfile.linkedAgencyLink, null);
assert.equal('linkedAgencyStatus' in publicProfile, false, 'public agency status removed instead of stored as null');
assert.equal('linkedAgencyApprovedBy' in publicProfile, false, 'private approval metadata never leaks into public projection');
assert.equal(publicProfile.linkedCompanyId, null, 'public Codex-managed company affiliation cleared');
assert.equal(publicProfile.linkedCompanyName, '');
assert.equal(publicProfile.linkedCompanyLink, null);
assert.equal('linkedCompanyStatus' in publicProfile, false, 'public company status removed instead of stored as null');
assert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverPostIds, ['real-empty', 'real-post']);
assert.deepEqual(applyDocs.get('users/real/moodboards/inspo').coverImageUrls, ['', 'https://real.test/post.jpg'], 'cover image positions remain aligned');
assert.equal(applyDocs.get('users/real/moodboards/inspo').postCount, 2);
assert.equal(applyDocs.get('publicUsers/other').fanOfCount, 5, 'existing repair marker prevents double decrement');
assert.deepEqual([...applyProofs], ['claimProofs/real-claim/real.png']);
for (const preserved of ['publicUsers/real', 'publicUsers/suspicious-marker', 'posts/real-post', 'posts/ordinary-managed-post', 'posts/real-post/comments/real-engagement', 'posts/real-post/likes/real', 'users/real/moodboards/inspo', 'users/real/moodboards/inspo/items/real-empty', 'users/real/moodboards/inspo/items/real-post', 'profiles/real-agency', 'reviewCases/real-review', 'reviewCases/approved-test-report', 'moderationExamples/real-example', 'moderationExamples/real-linked-example', 'contributors/real-contributor', 'contributors/real-claimed-test-contributor', 'contributors/pending-claim-contributor', 'contributors/moderation-claim-contributor', 'contributors/merge-secondary', 'contributorAliases/real-alias', 'contributorAliases/real-claimed-test-alias', 'contributorAliases/real-claimed-email-alias', 'contributorAliases/real-claimed-domain-alias', 'contributorAliases/pending-claim-alias', 'contributorAliases/moderation-claim-alias', 'contributorAliases/merge-evidence-alias', 'contributorAliases/merge-secondary-evidence-alias', 'claimInvites/real-invite', 'contributorContentRequests/real-content-request', 'claimRequests/real-claim', 'claimRequests/proof-review-claim', 'claimRequests/pending-ordinary-claim', 'claimRequests/moderation-ordinary-claim', 'claimRequests/denied-ordinary-claim', 'claimRequests/approved-test-merge', 'claimRequests/ordinary-approved-merge', 'claimVouches/moderation-ordinary-claim/votes/voter', 'claimVouches/real-claim/votes/voter', 'claimVouches/proof-review-claim/votes/voter', 'communities/art/topics/topic/comments/real-comment', 'threads/dm_real_other', 'users/real/threadIndex/dm_real_other', 'threads/support_real', 'threads/support_real/messages/user-message', 'threads/support_real/messages/real-decision', 'users/real/following/other']) {
  assert.equal(applyDocs.has(preserved), true, `${preserved} preserved`);
}
const secondStats = await reconcileCodexDevIsolation({ db: fakeDb(applyDocs), bucket: fakeBucket(applyProofs), apply: true, auth: noModeratorAuth, env: {}, uid: 'marked-test', skipStorage: false, fieldValue: fakeFieldValue });
assert.equal(secondStats.deletes, 0, 'second apply is idempotent');
assert.equal(secondStats.targetUidAlreadyRegistered, true, 'registration is idempotent');
assert.equal(secondStats.manualReviewRequired.filter((item) => item.reviewCaseId === 'approved-test-report').length, 1);
assert.equal(secondStats.manualReviewRequired.filter((item) => item.claimRequestId === 'approved-test-merge').length, 1);

applyDocs.set('users/real', { ...applyDocs.get('users/real'), linkedCompanyId: 'test-agency', linkedCompanyName: 'Late Codex Company', linkedCompanyStatus: 'approved' });
applyDocs.set('publicUsers/real', { ...applyDocs.get('publicUsers/real'), linkedCompanyId: 'test-agency', linkedCompanyName: 'Late Codex Company', linkedCompanyStatus: 'approved' });
applyDocs.set('users/real/moodboards/inspo/items/late-codex', {
  postId: 'test-post', ownerUid: 'real', moodboardId: 'inspo',
  postSnapshot: { imageUrl: 'https://codex.test/late.jpg', authorId: 'test-agency' },
});
applyDocs.set('users/real/moodboards/inspo', { ...applyDocs.get('users/real/moodboards/inspo'), postCount: 3 });
const provenanceStats = await reconcileCodexDevIsolation({
  db: fakeDb(applyDocs), bucket: fakeBucket(applyProofs), apply: true, auth: noModeratorAuth, env: {},
  uid: 'marked-test', skipStorage: false, fieldValue: fakeFieldValue,
});
assert.equal(provenanceStats.affiliationUsers, 1, 'stored managed-profile provenance repairs late private dependency');
assert.equal(provenanceStats.affiliationPublicUsers, 1, 'stored managed-profile provenance repairs late public dependency');
assert.equal(provenanceStats.moodboardItems, 1, 'stored post/profile provenance repairs late moodboard dependency');
assert.equal(applyDocs.has('users/real/moodboards/inspo/items/late-codex'), false);
assert.equal(applyDocs.get('users/real').linkedCompanyId, null);
assert.equal(applyDocs.get('publicUsers/real').linkedCompanyId, null);

const acceptedLegacyDocs = new Map([
  ['users/marked-test', { isDevTestUser: true, devActor: 'codex', onboardingComplete: true }],
  ['users/legacy-owner', { onboardingComplete: true, linkedAgencyId: 'already-deleted-agency', linkedAgencyName: 'Old Codex Agency', linkedAgencyStatus: 'approved' }],
  ['publicUsers/legacy-owner', { username: 'legacyowner', onboardingComplete: true, linkedAgencyId: 'already-deleted-agency', linkedAgencyName: 'Old Codex Agency', linkedAgencyStatus: 'approved', linkedAgencyApprovedBy: 'marked-test' }],
  ['users/legacy-owner/moodboards/legacy', { ownerUid: 'legacy-owner', postCount: 1, coverPostIds: ['already-deleted-post'], coverImageUrls: ['https://codex.test/deleted.jpg'] }],
  ['users/legacy-owner/moodboards/legacy/items/old', { postId: 'already-deleted-post', ownerUid: 'legacy-owner', moodboardId: 'legacy', postSnapshot: { authorId: 'already-deleted-agency' } }],
]);
const acceptedLegacyStats = await reconcileCodexDevIsolation({
  db: fakeDb(acceptedLegacyDocs), apply: true, auth: noModeratorAuth, uid: 'marked-test', skipStorage: true, fieldValue: fakeFieldValue,
  legacyManagedProfileIds: ['already-deleted-agency'], legacyPostIds: ['already-deleted-post'],
});
assert.equal(acceptedLegacyStats.affiliationUsers, 1);
assert.equal(acceptedLegacyStats.affiliationPublicUsers, 1);
assert.equal(acceptedLegacyStats.moodboardItems, 1);
assert.equal(acceptedLegacyDocs.get('users/legacy-owner').linkedAgencyId, null);
assert.equal('linkedAgencyStatus' in acceptedLegacyDocs.get('publicUsers/legacy-owner'), false);
assert.equal('linkedAgencyApprovedBy' in acceptedLegacyDocs.get('publicUsers/legacy-owner'), false);
assert.equal(acceptedLegacyDocs.has('users/legacy-owner/moodboards/legacy/items/old'), false);
assert.deepEqual(acceptedLegacyDocs.get('codexDevActorRegistry/marked-test').cleanupManagedProfileIds, ['already-deleted-agency']);
assert.deepEqual(acceptedLegacyDocs.get('codexDevActorRegistry/marked-test').cleanupPostIds, ['already-deleted-post']);

const largeBoardDocs = new Map([
  ['users/marked-test', { isDevTestUser: true, devActor: 'codex', onboardingComplete: true }],
  ['users/large-owner', { onboardingComplete: true }],
  ['users/large-owner/moodboards/huge', { ownerUid: 'large-owner', postCount: 501, coverPostIds: [], coverImageUrls: [] }],
]);
for (let index = 0; index < 501; index += 1) {
  largeBoardDocs.set(`users/large-owner/moodboards/huge/items/codex-${index}`, {
    postId: `deleted-codex-${index}`,
    ownerUid: 'large-owner',
    postSnapshot: { imageUrl: `https://example.test/${index}.jpg`, authorId: 'marked-test' },
  });
}
const largeBoardStats = await reconcileCodexDevIsolation({
  db: fakeDb(largeBoardDocs), apply: true, auth: noModeratorAuth, uid: 'marked-test', skipStorage: true, fieldValue: fakeFieldValue,
});
assert.equal(largeBoardStats.moodboardItems, 501);
assert.equal(largeBoardStats.moodboardsRepaired, 1);
assert.equal(largeBoardDocs.get('users/large-owner/moodboards/huge').postCount, 0);
assert.equal([...largeBoardDocs.keys()].some((itemPath) => itemPath.startsWith('users/large-owner/moodboards/huge/items/')), false, 'large moodboard cleanup stays below transaction write limit');

const missingUser = new Map([['publicUsers/canonical-missing-user', { displayName: 'legacy' }]]);
const missingStats = await reconcileCodexDevIsolation({ db: fakeDb(missingUser), apply: true, auth: noModeratorAuth, uid: 'canonical-missing-user', skipStorage: true });
assert.equal(missingStats.publicUsers, 1, 'canonical UID cleanup does not require users/{uid}');
assert.deepEqual([...missingUser.keys()], ['codexDevActorRegistry/canonical-missing-user']);
await assert.rejects(reconcileCodexDevIsolation({ db: fakeDb(new Map()), apply: true, skipStorage: true, env: {} }), /trustworthy canonical UID/);
await assert.rejects(reconcileCodexDevIsolation({ db: fakeDb(new Map([['users/canonical/following/real', { targetUid: 'real', countersApplied: true }]])), apply: true, auth: noModeratorAuth, uid: 'canonical', skipStorage: true }), /fieldValue\.serverTimestamp/);

console.log('PASS codexDevLegacyCleanup.test');
