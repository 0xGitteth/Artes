#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { CODEX_DEV_UID_DEFAULT, hasCodexDevPrivateMarkers } from '../codexDevIdentity.js';
import { applyFollowingDeletedCounters } from '../followCounters.js';
import {
  CODEX_DEV_ACTOR_REGISTRY_COLLECTION,
  ensureCodexDevActorRegistered,
  isRegisteredCodexDevActorUid,
} from '../codexDevActorRegistry.js';

const emptyStats = () => ({
  actors: 0,
  publicUsers: 0,
  posts: 0,
  managedProfiles: 0,
  communityComments: 0,
  reviewCases: 0,
  autoCleanableReviewCases: 0,
  contentRecoveryReviewCases: 0,
  moderationExamples: 0,
  contributors: 0,
  preservedContributors: 0,
  incomingFollows: 0,
  outgoingFollows: 0,
  followCounterRepairs: 0,
  contributorAliases: 0,
  preservedContributorAliases: 0,
  claimInvites: 0,
  claimRequests: 0,
  claimVouches: 0,
  claimProofObjects: 0,
  contributorClaimResets: 0,
  supportThreads: 0,
  postComments: 0,
  postLikes: 0,
  dmThreads: 0,
  threadIndexes: 0,
  linkedModerationExamples: 0,
  blockedFingerprintUsers: 0,
  blockedFingerprints: 0,
  supportDecisionThreads: 0,
  supportDecisionMessages: 0,
  contributorContentRequests: 0,
  affiliationUsers: 0,
  affiliationPublicUsers: 0,
  affiliationsCleared: 0,
  moodboardItems: 0,
  moodboardsRepaired: 0,
  cleanupManagedProfileIds: 0,
  cleanupPostIds: 0,
  publicAffiliationProjectionRepairs: 0,
  claimVotes: 0,
  claimVoteRequestsRecomputed: 0,
  manualReviewRequired: [],
  deletes: 0,
});

const uniqueDocs = (docs = []) => [...new Map(docs.map((doc) => [doc.ref?.path || doc.id, doc])).values()];

const queryDocs = async (query) => (await query.get()).docs || [];

const timestampMillis = (value) => value?.toMillis?.()
  ?? Number(value?.seconds ?? value?._seconds ?? value ?? 0) * 1000;

const ACTIVE_ORDINARY_CLAIM_STATUSES = new Set(['pending', 'needsModeration']);

const normalizeStringIds = (...values) => [...new Set(values.flatMap((value) => {
  if (Array.isArray(value)) return value;
  return String(value || '').split(',');
}).map((value) => String(value || '').trim()).filter(Boolean))];

const affiliationKindsToClear = (data = {}, targetIds = new Set()) => ['Agency', 'Company'].filter((kind) => {
  const linkedId = String(data?.[`linked${kind}Id`] || '').trim();
  return Boolean(linkedId) && targetIds.has(linkedId);
});

const buildPrivateAffiliationClearPatch = (data = {}, targetIds = new Set()) => {
  const patch = {};
  const kinds = affiliationKindsToClear(data, targetIds);
  for (const kind of kinds) {
    patch[`linked${kind}Id`] = null;
    patch[`linked${kind}Name`] = '';
    patch[`linked${kind}Link`] = null;
    patch[`linked${kind}Status`] = null;
    patch[`linked${kind}StatusUpdatedAt`] = null;
    patch[`linked${kind}ApprovedAt`] = null;
    patch[`linked${kind}ApprovedBy`] = null;
  }
  return { patch, cleared: kinds.length, repaired: 0 };
};

const buildPublicAffiliationClearPatch = (data = {}, targetIds = new Set(), deleteField = null) => {
  const patch = {};
  const kinds = affiliationKindsToClear(data, targetIds);
  let repaired = 0;
  for (const kind of kinds) {
    patch[`linked${kind}Id`] = null;
    patch[`linked${kind}Name`] = '';
    patch[`linked${kind}Link`] = null;
    for (const suffix of ['Status', 'StatusUpdatedAt', 'ApprovedAt', 'ApprovedBy']) {
      patch[`linked${kind}${suffix}`] = deleteField;
    }
  }
  for (const kind of ['Agency', 'Company']) {
    const statusField = `linked${kind}Status`;
    if (Object.prototype.hasOwnProperty.call(data, statusField) && data[statusField] === null) {
      patch[statusField] = deleteField;
      repaired += 1;
    }
    for (const suffix of ['StatusUpdatedAt', 'ApprovedAt', 'ApprovedBy']) {
      const field = `linked${kind}${suffix}`;
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        patch[field] = deleteField;
        repaired += 1;
      }
    }
  }
  return { patch, cleared: kinds.length, repaired };
};

const readCodexCleanupProvenance = async ({ db, uid }) => {
  const snapshot = await db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid).get();
  const data = snapshot.exists ? snapshot.data() || {} : {};
  return {
    managedProfileIds: normalizeStringIds(data.cleanupManagedProfileIds),
    postIds: normalizeStringIds(data.cleanupPostIds),
  };
};

const persistCodexCleanupProvenance = async ({ db, uid, managedProfileIds, postIds }) => {
  const ref = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('Codex Dev registry entry is required before persisting cleanup provenance.');
    const current = snapshot.data() || {};
    transaction.set(ref, {
      cleanupManagedProfileIds: normalizeStringIds(current.cleanupManagedProfileIds, managedProfileIds).sort(),
      cleanupPostIds: normalizeStringIds(current.cleanupPostIds, postIds).sort(),
      cleanupProvenanceUpdatedAt: new Date(),
    }, { merge: true });
  });
};

const moodboardItemPathParts = (path = '') => {
  const match = String(path).match(/^users\/([^/]+)\/moodboards\/([^/]+)\/items\/([^/]+)$/);
  return match ? { ownerUid: match[1], moodboardId: match[2], itemId: match[3] } : null;
};

const MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT = 400;

const isCodexMoodboardItem = ({ data = {}, itemId = '', actorPostIds, actorAffiliationTargetIds }) => {
  const postId = String(data?.postId || itemId || '').trim();
  const snapshotAuthorId = String(data?.postSnapshot?.authorId || '').trim();
  return actorPostIds.has(postId) || actorAffiliationTargetIds.has(snapshotAuthorId);
};

const clearAffiliationsIfStillCodex = async ({
  db, ref, actorAffiliationTargetIds, publicProjection = false, fieldValue = null,
}) => db.runTransaction(async (transaction) => {
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) return { cleared: 0, repaired: 0 };
  const deleteField = publicProjection ? fieldValue?.delete?.() : null;
  if (publicProjection && !deleteField) throw new Error('fieldValue.delete is required for public affiliation repair.');
  const result = publicProjection
    ? buildPublicAffiliationClearPatch(snapshot.data() || {}, actorAffiliationTargetIds, deleteField)
    : buildPrivateAffiliationClearPatch(snapshot.data() || {}, actorAffiliationTargetIds);
  if (!Object.keys(result.patch).length) return { cleared: 0, repaired: 0 };
  transaction.set(ref, { ...result.patch, updatedAt: new Date() }, { merge: true });
  return { cleared: result.cleared, repaired: result.repaired };
});

export const reconcileCodexDevIsolation = async ({
  db, auth = null, bucket = null, apply = false, env = process.env, uid = null, uidSource = null,
  skipStorage = false, fieldValue = null, legacyManagedProfileIds = [], legacyPostIds = [],
} = {}) => {
  if (!db) throw new Error('Firestore db is verplicht.');
  const explicitUid = String(uid || env.CODEX_DEV_UID || '').trim();
  const source = uidSource || (uid ? 'argument' : (env.CODEX_DEV_UID ? 'CODEX_DEV_UID' : 'default'));
  const canonicalUid = explicitUid || CODEX_DEV_UID_DEFAULT;
  if (apply && !explicitUid) throw new Error('--apply requires a trustworthy canonical UID via --uid or CODEX_DEV_UID.');
  if (apply && !bucket && !skipStorage) throw new Error('--apply requires --bucket/FIREBASE_STORAGE_BUCKET or explicit --skip-storage.');
  const stats = emptyStats();
  stats.targetUid = canonicalUid;
  stats.targetUidSource = source;
  stats.storageInspection = bucket ? 'complete' : (skipStorage ? 'skipped-explicitly' : 'skipped-missing-bucket');
  stats.targetUidAlreadyRegistered = await isRegisteredCodexDevActorUid({ db, uid: canonicalUid });
  stats.applyWouldEnsureRegistration = !apply;
  stats.targetUidRegistered = stats.targetUidAlreadyRegistered;
  if (apply) {
    await ensureCodexDevActorRegistered({ db, auth, uid: canonicalUid });
    stats.targetUidRegistered = true;
  }
  const users = await queryDocs(db.collection('users'));
  stats.ambiguousMarkerUids = users.filter((doc) => doc.id !== canonicalUid && hasCodexDevPrivateMarkers(doc.data() || {})).map((doc) => doc.id);
  const actors = [{ id: canonicalUid }];
  stats.actors = 1;

  for (const actor of actors) {
    const uid = actor.id;
    const deleteRef = async (ref, type, { recursive = false } = {}) => {
      const snap = await ref.get();
      if (!snap.exists) return;
      stats[type] += 1;
      stats.deletes += 1;
      if (apply) {
        if (recursive && typeof db.recursiveDelete === 'function') await db.recursiveDelete(ref);
        else await ref.delete();
      }
    };

    await deleteRef(db.collection('publicUsers').doc(uid), 'publicUsers');

    const actorManagedProfiles = await queryDocs(db.collection('profiles').where('ownerUid', '==', uid));
    const storedProvenance = await readCodexCleanupProvenance({ db, uid });
    const actorManagedProfileIds = new Set(normalizeStringIds(
      storedProvenance.managedProfileIds,
      legacyManagedProfileIds,
      env.CODEX_DEV_LEGACY_MANAGED_PROFILE_IDS,
      actorManagedProfiles.map((profile) => profile.id),
    ));
    const actorPosts = uniqueDocs((await Promise.all([
      queryDocs(db.collection('posts').where('authorId', '==', uid)),
      queryDocs(db.collection('posts').where('authorUid', '==', uid)),
      ...[...actorManagedProfileIds].map((profileId) => queryDocs(db.collection('posts').where('authorId', '==', profileId))),
    ])).flat());
    const actorPostIds = new Set(normalizeStringIds(
      storedProvenance.postIds,
      legacyPostIds,
      env.CODEX_DEV_LEGACY_POST_IDS,
      actorPosts.map((post) => post.id),
    ));
    stats.cleanupManagedProfileIds = actorManagedProfileIds.size;
    stats.cleanupPostIds = actorPostIds.size;
    if (apply) {
      await persistCodexCleanupProvenance({
        db, uid, managedProfileIds: [...actorManagedProfileIds], postIds: [...actorPostIds],
      });
    }

    const actorAffiliationTargetIds = new Set([uid, ...actorManagedProfileIds]);
    for (const user of users.filter((candidate) => candidate.id !== uid)) {
      const preview = buildPrivateAffiliationClearPatch(user.data() || {}, actorAffiliationTargetIds);
      if (!preview.cleared) continue;
      const result = apply
        ? await clearAffiliationsIfStillCodex({ db, ref: user.ref, actorAffiliationTargetIds })
        : preview;
      if (!result.cleared) continue;
      stats.affiliationUsers += 1;
      stats.affiliationsCleared += result.cleared;
    }
    for (const publicUser of (await queryDocs(db.collection('publicUsers'))).filter((candidate) => candidate.id !== uid)) {
      const preview = buildPublicAffiliationClearPatch(publicUser.data() || {}, actorAffiliationTargetIds, '__DELETE_PREVIEW__');
      if (!preview.cleared && !preview.repaired) continue;
      const result = apply
        ? await clearAffiliationsIfStillCodex({
          db, ref: publicUser.ref, actorAffiliationTargetIds, publicProjection: true, fieldValue,
        })
        : preview;
      if (result.cleared) {
        stats.affiliationPublicUsers += 1;
        stats.affiliationsCleared += result.cleared;
      }
      stats.publicAffiliationProjectionRepairs += result.repaired;
    }

    const ordinaryMoodboardItems = [];
    for (const owner of users.filter((candidate) => candidate.id !== uid)) {
      const moodboards = await queryDocs(owner.ref.collection('moodboards'));
      for (const moodboard of moodboards) {
        const items = await queryDocs(moodboard.ref.collection('items'));
        ordinaryMoodboardItems.push(...items.filter((item) => isCodexMoodboardItem({
          data: item.data() || {},
          itemId: item.id,
          actorPostIds,
          actorAffiliationTargetIds,
        })));
      }
    }
    const moodboardsToRepair = new Map();
    for (const item of ordinaryMoodboardItems) {
      const parts = moodboardItemPathParts(item.ref.path);
      const boardKey = `${parts.ownerUid}/${parts.moodboardId}`;
      const group = moodboardsToRepair.get(boardKey) || { ...parts, items: [] };
      group.items.push(item);
      moodboardsToRepair.set(boardKey, group);
    }
    if (!apply) {
      stats.moodboardItems += ordinaryMoodboardItems.length;
      stats.moodboardsRepaired += moodboardsToRepair.size;
      stats.deletes += ordinaryMoodboardItems.length;
    } else {
      for (const group of moodboardsToRepair.values()) {
        const boardRef = db.collection('users').doc(group.ownerUid).collection('moodboards').doc(group.moodboardId);
        let groupDeleted = 0;
        for (let offset = 0; offset < group.items.length; offset += MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT) {
          const chunk = group.items.slice(offset, offset + MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT);
          const deletedInChunk = await db.runTransaction(async (transaction) => {
            const [boardSnapshot, ...itemSnapshots] = await Promise.all([
              transaction.get(boardRef),
              ...chunk.map((item) => transaction.get(item.ref)),
            ]);
            const matchingItems = chunk.filter((item, index) => {
              const snapshot = itemSnapshots[index];
              return snapshot?.exists && isCodexMoodboardItem({
                data: snapshot.data() || {},
                itemId: item.id,
                actorPostIds,
                actorAffiliationTargetIds,
              });
            });
            if (!matchingItems.length) return 0;
            matchingItems.forEach((item) => transaction.delete(item.ref));
            if (boardSnapshot.exists) {
              const boardData = boardSnapshot.data() || {};
              const removedPostIds = new Set(matchingItems.map((item) => {
                const snapshot = itemSnapshots[chunk.indexOf(item)];
                return String(snapshot?.data()?.postId || item.id || '').trim();
              }).filter(Boolean));
              const currentCoverPostIds = Array.isArray(boardData.coverPostIds) ? boardData.coverPostIds : [];
              const currentCoverImageUrls = Array.isArray(boardData.coverImageUrls) ? boardData.coverImageUrls : [];
              const nextCoverPostIds = [];
              const nextCoverImageUrls = [];
              currentCoverPostIds.forEach((postId, index) => {
                if (removedPostIds.has(String(postId || '').trim())) return;
                nextCoverPostIds.push(postId);
                nextCoverImageUrls.push(typeof currentCoverImageUrls[index] === 'string' ? currentCoverImageUrls[index] : '');
              });
              const numericPostCount = Number(boardData.postCount);
              const boardPatch = {
                updatedAt: new Date(),
                coverPostIds: nextCoverPostIds,
                coverImageUrls: nextCoverImageUrls,
              };
              if (Number.isFinite(numericPostCount)) {
                boardPatch.postCount = Math.max(0, numericPostCount - matchingItems.length);
              }
              transaction.set(boardRef, boardPatch, { merge: true });
            }
            return matchingItems.length;
          });
          groupDeleted += deletedInChunk;
        }
        if (groupDeleted > 0) {
          stats.moodboardItems += groupDeleted;
          stats.moodboardsRepaired += 1;
          stats.deletes += groupDeleted;
        }
      }
    }
    for (const post of actorPosts) {
      await deleteRef(post.ref, 'posts', { recursive: true });
    }
    for (const profile of actorManagedProfiles) {
      await deleteRef(profile.ref, 'managedProfiles', { recursive: true });
    }
    const reviewCaseQueries = await Promise.all([
      queryDocs(db.collection('reviewCases').where('userId', '==', uid)),
      queryDocs(db.collection('reviewCases').where('reportedByUid', '==', uid)),
      queryDocs(db.collection('reviewCases').where('createdByUid', '==', uid)),
    ]);
    const reviewCases = uniqueDocs(reviewCaseQueries.flat());
    const reviewCaseIds = new Set(reviewCases.map((doc) => doc.id));
    for (const reviewCase of reviewCases) {
      const data = reviewCase.data() || {};
      const isReportCase = data.caseType === 'report'
        || Boolean(data.reportedPostId || data.reportedPostPath || data.reportedPost);
      const destructiveReport = isReportCase && data.status === 'approved';
      if (destructiveReport) {
        stats.contentRecoveryReviewCases += 1;
        stats.manualReviewRequired.push({
          reason: 'codex_report_content_recovery',
          reviewCaseId: reviewCase.id,
          reportedPostId: data.reportedPostId || data.reportedPost?.id || null,
          reportedPostPath: data.reportedPostPath || data.reportedPost?.path || null,
          affectedUserUid: data.userId || data.reportedPost?.authorId || null,
          status: data.status,
        });
        continue;
      }
      stats.autoCleanableReviewCases += 1;
      await deleteRef(reviewCase.ref, 'reviewCases', { recursive: true });
    }
    const exampleQueries = await Promise.all([
      queryDocs(db.collection('moderationExamples').where('userId', '==', uid)),
      queryDocs(db.collection('moderationExamples').where('uploaderUid', '==', uid)),
      ...[...reviewCaseIds].map((id) => queryDocs(db.collection('moderationExamples').where('reviewCaseId', '==', id))),
    ]);
    for (const example of uniqueDocs(exampleQueries.flat())) {
      if (reviewCaseIds.has(example.data()?.reviewCaseId)) stats.linkedModerationExamples += 1;
      await deleteRef(example.ref, 'moderationExamples', { recursive: true });
    }

    // Downstream report cleanup is provenance based: ordinary targets are never
    // selected by UID, only entries explicitly linked to a proven Codex case.
    for (const moderation of await queryDocs(db.collection('userModeration'))) {
      const data = moderation.data() || {};
      const blocked = Array.isArray(data.blockedFingerprints) ? data.blockedFingerprints : [];
      const retained = blocked.filter((entry) => !reviewCaseIds.has(entry?.reviewCaseId));
      const removed = blocked.length - retained.length;
      if (!removed) continue;
      stats.blockedFingerprintUsers += 1;
      stats.blockedFingerprints += removed;
      stats.deletes += removed;
      if (apply) await moderation.ref.set({ blockedFingerprints: retained, updatedAt: new Date() }, { merge: true });
    }

    for (const thread of await queryDocs(db.collection('threads'))) {
      const threadData = thread.data() || {};
      if (threadData.type !== 'support') continue;
      const messagesSnap = await thread.ref.collection('messages').get();
      const messages = messagesSnap.docs || [];
      const matching = messages.filter((message) => {
        const data = message.data() || {};
        return data.type === 'moderation_decision' && reviewCaseIds.has(data.metadata?.reviewCaseId || data.reviewCaseId);
      });
      if (!matching.length) continue;
      stats.supportDecisionThreads += 1;
      stats.supportDecisionMessages += matching.length;
      stats.deletes += matching.length;
      if (apply) {
        await Promise.all(matching.map((message) => message.ref.delete()));
        const removedPaths = new Set(matching.map((message) => message.ref.path));
        const remaining = messages.filter((message) => !removedPaths.has(message.ref.path))
          .sort((left, right) => timestampMillis(right.data()?.createdAt) - timestampMillis(left.data()?.createdAt));
        const latest = remaining[0]?.data() || null;
        const patch = {
          lastMessageAt: latest?.createdAt || null,
          lastSenderUid: latest?.senderUid ?? latest?.senderId ?? null,
          updatedAt: new Date(),
        };
        if ('lastMessageText' in threadData) patch.lastMessageText = latest?.text || latest?.message || '';
        if ('lastMessagePreview' in threadData) patch.lastMessagePreview = latest?.text || latest?.message || '';
        await thread.ref.set(patch, { merge: true });
        if (threadData.userUid) {
          const indexRef = db.collection('users').doc(threadData.userUid).collection('threadIndex').doc(thread.id);
          const indexSnap = await indexRef.get();
          if (indexSnap.exists) await indexRef.set({ lastMessageAt: latest?.createdAt || null }, { merge: true });
        }
      }
    }

    const claimRequests = await queryDocs(db.collection('claimRequests').where('requestedByUid', '==', uid));
    const approvedMergeRecoveryContributorIds = new Set();
    for (const claimRequest of claimRequests) {
      const requestData = claimRequest.data() || {};
      if (requestData.mode !== 'merge' || requestData.status !== 'approved') continue;
      const primaryContributorId = requestData.primaryContributorId || requestData.contributorId || null;
      const secondaryContributorId = requestData.secondaryContributorId || null;
      if (primaryContributorId) approvedMergeRecoveryContributorIds.add(primaryContributorId);
      if (secondaryContributorId) approvedMergeRecoveryContributorIds.add(secondaryContributorId);
    }

    const contributors = await queryDocs(db.collection('contributors').where('createdByUid', '==', uid));
    const deletableContributors = [];
    const preservedContributorIds = new Set();
    for (const contributor of contributors) {
      const data = contributor.data() || {};
      const claimedByUid = data.claimedByUid || null;
      const ownerSnap = claimedByUid && claimedByUid !== uid ? await db.collection('users').doc(claimedByUid).get() : null;
      const referencedOwner = users.find((user) => user.id !== uid && user.data()?.contributorId === contributor.id);
      const ordinaryOwnerUid = claimedByUid && claimedByUid !== uid ? claimedByUid : referencedOwner?.id || null;
      const legitimateOwner = Boolean(ordinaryOwnerUid)
        && (ownerSnap?.data()?.contributorId === contributor.id || referencedOwner || data.status === 'claimed');
      const ordinaryClaims = await queryDocs(db.collection('claimRequests').where('contributorId', '==', contributor.id));
      const activeOrdinaryClaims = ordinaryClaims.filter((claim) => {
        const claimData = claim.data() || {};
        return claimData.requestedByUid && claimData.requestedByUid !== uid
          && ACTIVE_ORDINARY_CLAIM_STATUSES.has(claimData.status);
      });
      const requiredForApprovedMergeRecovery = approvedMergeRecoveryContributorIds.has(contributor.id);
      if (legitimateOwner || activeOrdinaryClaims.length > 0 || requiredForApprovedMergeRecovery) {
        preservedContributorIds.add(contributor.id);
        stats.preservedContributors += 1;
        if (legitimateOwner) {
          stats.manualReviewRequired.push({ reason: 'codex_created_contributor_claimed_by_real_user', contributorId: contributor.id, claimedByUid: ordinaryOwnerUid, createdByUid: data.createdByUid, status: data.status || null });
        }
        if (activeOrdinaryClaims.length > 0) {
          stats.manualReviewRequired.push({
            reason: 'codex_created_contributor_with_active_ordinary_claim',
            contributorId: contributor.id,
            createdByUid: data.createdByUid,
            claims: activeOrdinaryClaims.map((claim) => ({ claimRequestId: claim.id, requestedByUid: claim.data()?.requestedByUid, status: claim.data()?.status })),
          });
        }
      } else {
        deletableContributors.push(contributor);
      }
    }
    const contributorIds = new Set(deletableContributors.map((doc) => doc.id));
    const aliasPreservationContributorIds = new Set([
      ...preservedContributorIds,
      ...approvedMergeRecoveryContributorIds,
    ]);
    const aliasQueries = await Promise.all([
      queryDocs(db.collection('contributorAliases').where('createdByUid', '==', uid)),
      ...[...contributorIds].map((id) => queryDocs(db.collection('contributorAliases').where('contributorId', '==', id))),
      ...[...aliasPreservationContributorIds].map((id) => queryDocs(db.collection('contributorAliases').where('contributorId', '==', id))),
    ]);
    const inviteQueries = await Promise.all([
      queryDocs(db.collection('claimInvites').where('createdByUid', '==', uid)),
      ...[...contributorIds].map((id) => queryDocs(db.collection('claimInvites').where('contributorId', '==', id))),
    ]);
    const aliases = uniqueDocs(aliasQueries.flat());
    const preservedAliases = aliases.filter((alias) => aliasPreservationContributorIds.has(alias.data()?.contributorId));
    stats.preservedContributorAliases += preservedAliases.length;
    for (const alias of aliases.filter((candidate) => !aliasPreservationContributorIds.has(candidate.data()?.contributorId))) {
      await deleteRef(alias.ref, 'contributorAliases');
    }
    for (const invite of uniqueDocs(inviteQueries.flat())) await deleteRef(invite.ref, 'claimInvites');
    for (const contributor of deletableContributors) await deleteRef(contributor.ref, 'contributors', { recursive: true });

    const contentRequestQueries = await Promise.all([
      queryDocs(db.collection('contributorContentRequests').where('requesterUid', '==', uid)),
      queryDocs(db.collection('contributorContentRequests').where('createdByUid', '==', uid)),
    ]);
    for (const request of uniqueDocs(contentRequestQueries.flat())) {
      await deleteRef(request.ref, 'contributorContentRequests', { recursive: true });
    }

    const outgoingFollows = await queryDocs(db.collection('users').doc(uid).collection('following'));
    const incomingFollows = (await queryDocs(db.collectionGroup('following').where('targetUid', '==', uid)))
      .filter((doc) => doc.ref.path !== `users/${uid}/following/${doc.id}`);
    stats.outgoingFollows += outgoingFollows.length;
    stats.incomingFollows += incomingFollows.length;
    for (const relation of uniqueDocs([...outgoingFollows, ...incomingFollows])) {
      const parts = relation.ref.path.split('/');
      const fanUid = parts[1];
      const targetUid = relation.data()?.targetUid || relation.id;
      if (relation.data()?.countersApplied === true) stats.followCounterRepairs += 1;
      stats.deletes += 1;
      if (apply) {
        if (!fieldValue?.serverTimestamp) throw new Error('fieldValue.serverTimestamp is required for follow counter repair.');
        await applyFollowingDeletedCounters({ db, relationData: relation.data() || {}, uid: fanUid, targetUid, fieldValue, codexUid: uid });
        await relation.ref.delete();
      }
    }

    for (const claimRequest of claimRequests) {
      const requestData = claimRequest.data() || {};
      const approvedMerge = requestData.mode === 'merge' && requestData.status === 'approved';
      if (approvedMerge) {
        stats.manualReviewRequired.push({
          reason: 'codex_approved_merge_claim_recovery',
          claimRequestId: claimRequest.id,
          requestedByUid: uid,
          primaryContributorId: requestData.primaryContributorId || requestData.contributorId || null,
          secondaryContributorId: requestData.secondaryContributorId || null,
          status: requestData.status,
          mode: requestData.mode,
        });
        continue;
      }
      const contributorId = requestData.contributorId || null;
      if (requestData.status === 'approved' && contributorId) {
        const contributorRef = db.collection('contributors').doc(contributorId);
        const contributorSnap = await contributorRef.get();
        if (contributorSnap.exists && contributorSnap.data()?.claimedByUid === uid) {
          stats.contributorClaimResets += 1;
          if (apply) await contributorRef.set({ claimedByUid: null, claimedAt: null, status: 'unclaimed', updatedAt: new Date() }, { merge: true });
        }
        const actorRef = db.collection('users').doc(uid);
        const actorSnap = await actorRef.get();
        if (apply && actorSnap.exists && actorSnap.data()?.contributorId === contributorId) {
          await actorRef.set({ contributorId: null, updatedAt: new Date() }, { merge: true });
        }
      }
      const vouchRef = db.collection('claimVouches').doc(claimRequest.id);
      const [vouchSnap, votesSnap] = await Promise.all([vouchRef.get(), vouchRef.collection('votes').get()]);
      if (vouchSnap.exists || (votesSnap.docs || []).length > 0) {
        stats.claimVouches += 1;
        stats.deletes += 1;
        if (apply) await db.recursiveDelete(vouchRef);
      }
      if (bucket) {
        const [files] = await bucket.getFiles({ prefix: `claimProofs/${claimRequest.id}/` });
        stats.claimProofObjects += files.length;
        stats.deletes += files.length;
        if (apply) await Promise.all(files.map((file) => file.delete()));
      }
      await deleteRef(claimRequest.ref, 'claimRequests', { recursive: true });
    }

    // Remove the canonical actor's votes on other users' requests. Open requests
    // are recomputed from remaining vote documents; finalized requests are only
    // flagged because ownership rollback is not unambiguous.
    const actorVotes = await queryDocs(db.collectionGroup('votes').where('voterUid', '==', uid));
    for (const vote of actorVotes.filter((doc) => /^claimVouches\/[^/]+\/votes\/[^/]+$/.test(doc.ref.path))) {
      const requestId = vote.ref.path.split('/')[1];
      const requestRef = db.collection('claimRequests').doc(requestId);
      const requestSnap = await requestRef.get();
      if (!requestSnap.exists || requestSnap.data()?.requestedByUid === uid) continue;
      const votesSnap = await db.collection('claimVouches').doc(requestId).collection('votes').get();
      const remaining = (votesSnap.docs || []).filter((doc) => doc.ref.path !== vote.ref.path);
      const yesCount = remaining.filter((doc) => doc.data()?.vote === 'yes').length;
      const noCount = remaining.filter((doc) => doc.data()?.vote === 'no').length;
      const current = requestSnap.data() || {};
      const finalized = !['pending', 'needsModeration'].includes(current.status);
      stats.claimVotes += 1;
      stats.deletes += 1;
      stats.claimVoteRequestsRecomputed += 1;
      if (finalized) stats.manualReviewRequired.push(requestId);
      if (apply) {
        await vote.ref.delete();
        const update = { yesCount, noCount, updatedAt: new Date() };
        if (!finalized && current.status === 'needsModeration' && current.statusReason === 'vouch conflict' && !(yesCount && noCount)) {
          Object.assign(update, { status: 'pending', statusReason: null });
        } else if (!finalized && yesCount && noCount) {
          Object.assign(update, { status: 'needsModeration', statusReason: 'vouch conflict' });
        }
        await requestRef.set(update, { merge: true });
      }
    }

    const allComments = await queryDocs(db.collectionGroup('comments').where('authorId', '==', uid));
    for (const comment of allComments.filter((doc) => /^communities\/[^/]+\/topics\/[^/]+\/comments\/[^/]+$/.test(doc.ref.path))) {
      await deleteRef(comment.ref, 'communityComments');
    }
    for (const comment of allComments.filter((doc) => {
      const match = doc.ref.path.match(/^posts\/([^/]+)\/comments\/[^/]+$/);
      return match && !actorPostIds.has(match[1]);
    })) {
      await deleteRef(comment.ref, 'postComments');
    }
    const productionPosts = await queryDocs(db.collection('posts'));
    for (const post of productionPosts.filter((doc) => doc.data()?.authorId !== uid)) {
      await deleteRef(post.ref.collection('likes').doc(uid), 'postLikes');
    }

    const canonicalThreads = await queryDocs(db.collection('threads').where('participantUids', 'array-contains', uid));
    const legacyThreads = await queryDocs(db.collection('threads').where('participants', 'array-contains', uid));
    for (const thread of uniqueDocs([...canonicalThreads, ...legacyThreads])) {
      const data = thread.data() || {};
      if (data.type !== 'dm') continue;
      const participants = Array.isArray(data.participantUids) ? data.participantUids : (data.participants || []);
      for (const participantUid of participants) {
        await deleteRef(db.collection('users').doc(participantUid).collection('threadIndex').doc(thread.id), 'threadIndexes');
      }
      await deleteRef(thread.ref, 'dmThreads', { recursive: true });
    }
    for (const thread of await queryDocs(db.collection('threads').where('userUid', '==', uid))) {
      if (thread.data()?.type !== 'support') continue;
      await deleteRef(db.collection('users').doc(uid).collection('threadIndex').doc(thread.id), 'threadIndexes');
      await deleteRef(thread.ref, 'supportThreads', { recursive: true });
    }
  }
  return stats;
};

const valueAfter = (argv, flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] || null : null; };

export const parseArgs = (argv) => ({
  apply: argv.includes('--apply'),
  skipStorage: argv.includes('--skip-storage'),
  project: argv.find((arg) => arg.startsWith('--project='))?.slice('--project='.length) || null,
  uid: argv.find((arg) => arg.startsWith('--uid='))?.slice('--uid='.length) || valueAfter(argv, '--uid'),
  bucket: argv.find((arg) => arg.startsWith('--bucket='))?.slice('--bucket='.length) || valueAfter(argv, '--bucket'),
  legacyManagedProfileIds: normalizeStringIds(
    argv.find((arg) => arg.startsWith('--legacy-managed-profile-ids='))?.slice('--legacy-managed-profile-ids='.length),
    valueAfter(argv, '--legacy-managed-profile-ids'),
  ),
  legacyPostIds: normalizeStringIds(
    argv.find((arg) => arg.startsWith('--legacy-post-ids='))?.slice('--legacy-post-ids='.length),
    valueAfter(argv, '--legacy-post-ids'),
  ),
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const { getStorage } = await import('firebase-admin/storage');
  const bucketName = options.bucket || process.env.FIREBASE_STORAGE_BUCKET || null;
  const appOptions = { credential: applicationDefault(), projectId: options.project || process.env.GOOGLE_CLOUD_PROJECT };
  if (bucketName) appOptions.storageBucket = bucketName;
  initializeApp(appOptions);
  const bucket = bucketName ? getStorage().bucket(bucketName) : null;
  const stats = await reconcileCodexDevIsolation({
    db: getFirestore(), auth: getAuth(), bucket, apply: options.apply, uid: options.uid,
    uidSource: options.uid ? '--uid' : null, skipStorage: options.skipStorage, fieldValue: FieldValue,
    legacyManagedProfileIds: options.legacyManagedProfileIds, legacyPostIds: options.legacyPostIds,
  });
  console.log(options.apply ? 'APPLY' : 'DRY RUN', stats);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
