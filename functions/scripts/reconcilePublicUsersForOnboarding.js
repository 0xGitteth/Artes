#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import {
  LEGACY_PRIVATE_PUBLIC_USER_FIELDS,
  PUBLIC_ARRAY_FIELDS,
  PUBLIC_NULLABLE_STRING_FIELDS,
  PUBLIC_STRING_ONLY_FIELDS,
  buildLegacyPrivateFieldDeletes,
  buildPublicUserBackfillPayload,
} from './backfillPublicUsersFromUsers.js';
import { isAvailablePersonalPublicProfile } from '../publicProfileAvailability.js';
import { isDiditSafetyDeactivatedPrivateProfile } from '../publicProfileUnpublish.js';
import { isCodexDevPrivateProfile } from '../codexDevIdentity.js';

export const DEFAULT_PAGE_SIZE = 200;
export const PRIVATE_FIELDS = LEGACY_PRIVATE_PUBLIC_USER_FIELDS;
export const PROFILE_PROJECTION_FIELDS = [
  'uid',
  'profileId',
  'ownerUid',
  'username',
  'displayName',
  'displayNameLower',
  ...PUBLIC_NULLABLE_STRING_FIELDS,
  ...PUBLIC_STRING_ONLY_FIELDS,
  ...PUBLIC_ARRAY_FIELDS,
  'quickProfilePostIds',
  'onboardingComplete',
  'onboardingStep',
];

const hasOwn = (value, field) => Object.prototype.hasOwnProperty.call(value || {}, field);
const valuesEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const isOnboardingComplete = (profile = {}) => (
  profile?.onboardingComplete === true || Number(profile?.onboardingStep || 0) >= 5
);

export const buildPublicProfile = (uid, user = {}, now = () => new Date()) => {
  const result = {
    ...buildPublicUserBackfillPayload(uid, user, { serverTimestamp: now }),
    onboardingComplete: true,
  };
  const step = Number(user.onboardingStep);
  if (Number.isInteger(step) && step >= 0 && step <= 10) result.onboardingStep = step;
  return result;
};

export const parseArgs = (argv = process.argv.slice(2)) => {
  const out = { apply: false, deleteOrphans: false, uid: null, project: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--delete-orphans') out.deleteOrphans = true;
    else if (arg === '--uid' || arg === '--project') out[arg.slice(2)] = argv[++index] || null;
    else if (arg.startsWith('--uid=')) out.uid = arg.slice(6);
    else if (arg.startsWith('--project=')) out.project = arg.slice(10);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Onbekende parameter: ${arg}`);
  }
  return { ...out, dryRun: !out.apply };
};

export async function* paginateCollection(collectionRef, {
  pageSize = DEFAULT_PAGE_SIZE,
  documentId = '__name__',
} = {}) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize moet een positief geheel getal zijn.');
  let cursor = null;
  while (true) {
    let query = collectionRef.orderBy(documentId).limit(pageSize);
    if (cursor !== null) query = query.startAfter(cursor);
    const page = await query.get();
    const docs = page.docs || [];
    if (!docs.length) return;
    yield docs;
    if (docs.length < pageSize) return;
    cursor = docs[docs.length - 1].id;
  }
}

const emptyStats = () => ({
  privateUsersScanned: 0,
  completedUsers: 0,
  incompleteUsers: 0,
  missingPublicProfiles: 0,
  publicProfilesRestored: 0,
  publicProfilesDeleted: 0,
  diditSafetyProfilesPreserved: 0,
  orphanPublicProfiles: 0,
  writes: 0,
  deletes: 0,
  errors: 0,
  testActorsSkipped: 0,
});

const addStats = (stats, changes = {}) => {
  Object.entries(changes).forEach(([key, amount]) => {
    stats[key] += amount;
  });
};

const decideUserReconciliation = ({
  uid,
  privateSnap,
  publicSnap,
  deleteValue,
  serverTimestamp,
}) => {
  if (!privateSnap.exists) return { action: 'none', stats: {} };

  const userData = privateSnap.data() || {};
  const publicExists = publicSnap.exists;
  const publicData = publicExists ? (publicSnap.data() || {}) : {};

  if (isCodexDevPrivateProfile(uid, userData)) {
    return publicExists
      ? { action: 'delete', stats: { testActorsSkipped: 1, publicProfilesDeleted: 1, deletes: 1 } }
      : { action: 'none', stats: { testActorsSkipped: 1 } };
  }

  if (!isOnboardingComplete(userData)) {
    if (!publicExists) return { action: 'none', stats: { incompleteUsers: 1 } };
    if (
      isDiditSafetyDeactivatedPrivateProfile(userData)
      && !isAvailablePersonalPublicProfile(publicData)
    ) {
      return {
        action: 'preserve',
        stats: { incompleteUsers: 1, diditSafetyProfilesPreserved: 1 },
      };
    }
    return {
      action: 'delete',
      stats: { incompleteUsers: 1, publicProfilesDeleted: 1, deletes: 1 },
    };
  }

  const desired = buildPublicProfile(uid, userData, serverTimestamp);
  const cleanup = buildLegacyPrivateFieldDeletes(publicData, { deleteValue });
  PROFILE_PROJECTION_FIELDS.forEach((field) => {
    if (hasOwn(publicData, field) && !hasOwn(desired, field)) cleanup[field] = deleteValue();
  });
  const comparableDesired = { ...desired };
  delete comparableDesired.updatedAt;
  const changed = !publicExists
    || Object.keys(cleanup).length > 0
    || Object.entries(comparableDesired).some(([key, value]) => !valuesEqual(publicData[key], value));
  const baseStats = {
    completedUsers: 1,
    ...(!publicExists ? { missingPublicProfiles: 1 } : {}),
  };
  if (!changed) return { action: 'none', stats: baseStats };
  return {
    action: 'set',
    payload: { ...desired, ...cleanup },
    stats: { ...baseStats, publicProfilesRestored: 1, writes: 1 },
  };
};

const executeUserDecision = (writer, publicRef, decision) => {
  if (decision.action === 'set') writer.set(publicRef, decision.payload, { merge: true });
  else if (decision.action === 'delete') writer.delete(publicRef);
};

const reconcileDiscoveredUser = async ({
  db,
  discoveredSnap,
  apply,
  deleteValue,
  serverTimestamp,
}) => {
  const userRef = db.collection('users').doc(discoveredSnap.id);
  const publicRef = db.collection('publicUsers').doc(discoveredSnap.id);

  if (!apply) {
    const publicSnap = await publicRef.get();
    return decideUserReconciliation({
      uid: discoveredSnap.id,
      privateSnap: discoveredSnap,
      publicSnap,
      deleteValue,
      serverTimestamp,
    });
  }

  return db.runTransaction(async (transaction) => {
    const currentPrivateSnap = await transaction.get(userRef);
    const currentPublicSnap = await transaction.get(publicRef);
    const decision = decideUserReconciliation({
      uid: discoveredSnap.id,
      privateSnap: currentPrivateSnap,
      publicSnap: currentPublicSnap,
      deleteValue,
      serverTimestamp,
    });
    executeUserDecision(transaction, publicRef, decision);
    return decision;
  });
};

const inspectDiscoveredPublicProfile = async ({
  db,
  discoveredSnap,
  apply,
  deleteOrphans,
}) => {
  const userRef = db.collection('users').doc(discoveredSnap.id);
  const publicRef = db.collection('publicUsers').doc(discoveredSnap.id);

  if (!apply || !deleteOrphans) {
    const privateSnap = await userRef.get();
    if (privateSnap.exists) return { action: 'none', stats: {} };
    return {
      action: 'none',
      stats: {
        orphanPublicProfiles: 1,
        ...(deleteOrphans ? { deletes: 1 } : {}),
      },
    };
  }

  return db.runTransaction(async (transaction) => {
    const currentPrivateSnap = await transaction.get(userRef);
    const currentPublicSnap = await transaction.get(publicRef);
    if (currentPrivateSnap.exists || !currentPublicSnap.exists) return { action: 'none', stats: {} };
    transaction.delete(publicRef);
    return {
      action: 'delete',
      stats: { orphanPublicProfiles: 1, deletes: 1 },
    };
  });
};

export async function reconcile({
  db,
  apply = false,
  deleteOrphans = false,
  uid = null,
  deleteValue = () => undefined,
  serverTimestamp = () => new Date(),
  pageSize = DEFAULT_PAGE_SIZE,
  documentId = '__name__',
}) {
  if (!db) throw new Error('Firestore db is verplicht.');
  const stats = emptyStats();
  const processUser = async (snap) => {
    stats.privateUsersScanned += 1;
    try {
      const result = await reconcileDiscoveredUser({
        db,
        discoveredSnap: snap,
        apply,
        deleteValue,
        serverTimestamp,
      });
      addStats(stats, result.stats);
    } catch (error) {
      stats.errors += 1;
      console.error(`[reconcile] ${snap.id}:`, error.message);
      if (apply) throw error;
    }
  };

  if (uid) {
    const privateSnap = await db.collection('users').doc(uid).get();
    if (privateSnap.exists) await processUser(privateSnap);
    const publicSnap = await db.collection('publicUsers').doc(uid).get();
    if (publicSnap.exists && !privateSnap.exists) {
      const result = await inspectDiscoveredPublicProfile({ db, discoveredSnap: publicSnap, apply, deleteOrphans });
      addStats(stats, result.stats);
    }
    return stats;
  }

  for await (const page of paginateCollection(db.collection('users'), { pageSize, documentId })) {
    for (const snap of page) await processUser(snap);
  }

  for await (const page of paginateCollection(db.collection('publicUsers'), { pageSize, documentId })) {
    for (const snap of page) {
      try {
        const result = await inspectDiscoveredPublicProfile({
          db,
          discoveredSnap: snap,
          apply,
          deleteOrphans,
        });
        addStats(stats, result.stats);
      } catch (error) {
        stats.errors += 1;
        console.error(`[reconcile] orphan ${snap.id}:`, error.message);
        if (apply) throw error;
      }
    }
  }
  return stats;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    console.log('Gebruik: npm run reconcile-public-users -- [--apply] [--uid <uid>] [--project <id>] [--delete-orphans]');
    return;
  }
  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldPath, FieldValue } = await import('firebase-admin/firestore');
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const service = raw ? JSON.parse(raw) : null;
  initializeApp({
    credential: service ? cert(service) : applicationDefault(),
    projectId: options.project || service?.project_id || process.env.GOOGLE_CLOUD_PROJECT,
  });
  const stats = await reconcile({
    db: getFirestore(),
    ...options,
    deleteValue: FieldValue.delete,
    serverTimestamp: FieldValue.serverTimestamp,
    documentId: FieldPath.documentId(),
  });
  console.log(options.apply ? 'APPLY' : 'DRY RUN', stats);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
