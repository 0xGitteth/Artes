#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { CODEX_DEV_UID_DEFAULT, hasCodexDevPrivateMarkers } from '../codexDevIdentity.js';
import { applyFollowingDeletedCounters } from '../followCounters.js';
import { FieldValue } from 'firebase-admin/firestore';

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
  claimVotes: 0,
  claimVoteRequestsRecomputed: 0,
  manualReviewRequired: [],
  deletes: 0,
});

const uniqueDocs = (docs = []) => [...new Map(docs.map((doc) => [doc.ref?.path || doc.id, doc])).values()];

const queryDocs = async (query) => (await query.get()).docs || [];

const timestampMillis = (value) => value?.toMillis?.()
  ?? Number(value?.seconds ?? value?._seconds ?? value ?? 0) * 1000;

export const reconcileCodexDevIsolation = async ({ db, bucket = null, apply = false, env = process.env, uid = null, uidSource = null, skipStorage = false } = {}) => {
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

    const actorPosts = uniqueDocs((await Promise.all([
      queryDocs(db.collection('posts').where('authorId', '==', uid)),
      queryDocs(db.collection('posts').where('authorUid', '==', uid)),
    ])).flat());
    const actorPostIds = new Set(actorPosts.map((post) => post.id));
    for (const post of actorPosts) {
      await deleteRef(post.ref, 'posts', { recursive: true });
    }
    for (const profile of await queryDocs(db.collection('profiles').where('ownerUid', '==', uid))) {
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

    const contributors = await queryDocs(db.collection('contributors').where('createdByUid', '==', uid));
    const deletableContributors = [];
    for (const contributor of contributors) {
      const data = contributor.data() || {};
      const claimedByUid = data.claimedByUid || null;
      const ownerSnap = claimedByUid && claimedByUid !== uid ? await db.collection('users').doc(claimedByUid).get() : null;
      const referencedOwner = users.find((user) => user.id !== uid && user.data()?.contributorId === contributor.id);
      const ordinaryOwnerUid = claimedByUid && claimedByUid !== uid ? claimedByUid : referencedOwner?.id || null;
      const legitimateOwner = Boolean(ordinaryOwnerUid)
        && (ownerSnap?.data()?.contributorId === contributor.id || referencedOwner || data.status === 'claimed');
      if (legitimateOwner) {
        stats.preservedContributors += 1;
        stats.manualReviewRequired.push({ reason: 'codex_created_contributor_claimed_by_real_user', contributorId: contributor.id, claimedByUid: ordinaryOwnerUid, createdByUid: data.createdByUid, status: data.status || null });
      } else {
        deletableContributors.push(contributor);
      }
    }
    const contributorIds = new Set(deletableContributors.map((doc) => doc.id));
    const aliasQueries = await Promise.all([
      queryDocs(db.collection('contributorAliases').where('createdByUid', '==', uid)),
      ...[...contributorIds].map((id) => queryDocs(db.collection('contributorAliases').where('contributorId', '==', id))),
    ]);
    const inviteQueries = await Promise.all([
      queryDocs(db.collection('claimInvites').where('createdByUid', '==', uid)),
      ...[...contributorIds].map((id) => queryDocs(db.collection('claimInvites').where('contributorId', '==', id))),
    ]);
    for (const alias of uniqueDocs(aliasQueries.flat())) await deleteRef(alias.ref, 'contributorAliases');
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
        await applyFollowingDeletedCounters({ db, relationData: relation.data() || {}, uid: fanUid, targetUid, fieldValue: FieldValue, codexUid: uid });
        await relation.ref.delete();
      }
    }

    const claimRequests = await queryDocs(db.collection('claimRequests').where('requestedByUid', '==', uid));
    for (const claimRequest of claimRequests) {
      const requestData = claimRequest.data() || {};
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
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');
  const bucketName = options.bucket || process.env.FIREBASE_STORAGE_BUCKET || null;
  const appOptions = { credential: applicationDefault(), projectId: options.project || process.env.GOOGLE_CLOUD_PROJECT };
  if (bucketName) appOptions.storageBucket = bucketName;
  initializeApp(appOptions);
  const bucket = bucketName ? getStorage().bucket(bucketName) : null;
  const stats = await reconcileCodexDevIsolation({ db: getFirestore(), bucket, apply: options.apply, uid: options.uid, uidSource: options.uid ? '--uid' : null, skipStorage: options.skipStorage });
  console.log(options.apply ? 'APPLY' : 'DRY RUN', stats);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
