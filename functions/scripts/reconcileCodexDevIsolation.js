#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { isCodexDevPrivateProfile } from '../codexDevIdentity.js';

const emptyStats = () => ({
  actors: 0,
  publicUsers: 0,
  posts: 0,
  managedProfiles: 0,
  communityComments: 0,
  reviewCases: 0,
  moderationExamples: 0,
  contributors: 0,
  contributorAliases: 0,
  claimInvites: 0,
  supportThreads: 0,
  postComments: 0,
  postLikes: 0,
  dmThreads: 0,
  threadIndexes: 0,
  deletes: 0,
});

const uniqueDocs = (docs = []) => [...new Map(docs.map((doc) => [doc.ref?.path || doc.id, doc])).values()];

const queryDocs = async (query) => (await query.get()).docs || [];

export const reconcileCodexDevIsolation = async ({ db, apply = false, env = process.env } = {}) => {
  if (!db) throw new Error('Firestore db is verplicht.');
  const stats = emptyStats();
  const users = await queryDocs(db.collection('users'));
  const actors = users.filter((doc) => isCodexDevPrivateProfile(doc.id, doc.data() || {}, env));
  stats.actors = actors.length;

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

    const actorPosts = await queryDocs(db.collection('posts').where('authorId', '==', uid));
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
    for (const reviewCase of uniqueDocs(reviewCaseQueries.flat())) {
      await deleteRef(reviewCase.ref, 'reviewCases', { recursive: true });
    }
    const exampleQueries = await Promise.all([
      queryDocs(db.collection('moderationExamples').where('userId', '==', uid)),
      queryDocs(db.collection('moderationExamples').where('uploaderUid', '==', uid)),
    ]);
    for (const example of uniqueDocs(exampleQueries.flat())) {
      await deleteRef(example.ref, 'moderationExamples', { recursive: true });
    }

    const contributors = await queryDocs(db.collection('contributors').where('createdByUid', '==', uid));
    const contributorIds = new Set(contributors.map((doc) => doc.id));
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
    for (const contributor of contributors) await deleteRef(contributor.ref, 'contributors', { recursive: true });

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

const parseArgs = (argv) => ({
  apply: argv.includes('--apply'),
  project: argv.find((arg) => arg.startsWith('--project='))?.slice('--project='.length) || null,
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ credential: applicationDefault(), projectId: options.project || process.env.GOOGLE_CLOUD_PROJECT });
  const stats = await reconcileCodexDevIsolation({ db: getFirestore(), apply: options.apply });
  console.log(options.apply ? 'APPLY' : 'DRY RUN', stats);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
