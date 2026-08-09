#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { cleanPublicStringArray } from '../../src/utils/publicProfileFieldNormalization.js';

const BATCH_LIMIT = 400;

export const PUBLIC_NULLABLE_STRING_FIELDS = [
  'photoURL',
  'avatar',
  'headerImage',
  'linkedAgencyName',
  'linkedCompanyName',
  'linkedAgencyId',
  'linkedCompanyId',
  'linkedAgencyLink',
  'linkedCompanyLink',
];

export const PUBLIC_STRING_ONLY_FIELDS = [
  'bio',
  'headerPosition',
  'linkedAgencyStatus',
  'linkedCompanyStatus',
  'quickProfilePreviewMode',
];

export const PUBLIC_ARRAY_FIELDS = [
  'roles',
  'themes',
];

export const LEGACY_PRIVATE_PUBLIC_USER_FIELDS = [
  'email',
  'normalizedEmail',
  'legalName',
  'realName',
  'birthDate',
  'dateOfBirth',
  'didit',
  'diditStatus',
  'idv',
  'idvStatus',
  'ageVerified',
  'ageVerifiedAt',
  'isAdult',
  'authProvider',
  'providerData',
  'authDisplayName',
  'firebaseDisplayName',
  'googleDisplayName',
  'preferences',
  'triggerVisibility',
  'moderation',
  'support',
  'private',
];

const parseServiceAccount = () => {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is geen geldige JSON.');
  }
};

const initAdmin = async () => {
  const { initializeApp, applicationDefault, cert } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  const serviceAccount = parseServiceAccount();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount), projectId: projectId || serviceAccount.project_id });
  } else {
    initializeApp({ credential: applicationDefault(), projectId });
  }
  return { db: getFirestore(), serverTimestamp: FieldValue.serverTimestamp };
};

const normalizeUsername = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .slice(0, 20);

const generateUsername = (displayName, uid) => {
  const base = normalizeUsername(displayName) || 'artes';
  const suffix = uid ? uid.slice(0, 4).toLowerCase() : Math.random().toString(36).slice(2, 6);
  const maxBaseLength = Math.max(0, 20 - suffix.length);
  return `${base.slice(0, maxBaseLength)}${suffix}`;
};

export const cleanStringArray = cleanPublicStringArray;

const copyNullableString = (payload, source, field) => {
  if (!(field in source)) return;
  if (typeof source[field] === 'string' || source[field] === null) {
    payload[field] = source[field];
  }
};

const copyStringOnly = (payload, source, field) => {
  if (!(field in source)) return;
  if (typeof source[field] === 'string') {
    payload[field] = source[field];
  }
};

export const isPublishEligibleUser = (userData = {}) => (
  userData?.onboardingComplete === true
  || Number(userData?.onboardingStep || 0) >= 5
);

export const getLegacyPrivatePublicUserFields = (publicUserData = {}) => LEGACY_PRIVATE_PUBLIC_USER_FIELDS
  .filter((field) => Object.prototype.hasOwnProperty.call(publicUserData || {}, field));

export const buildLegacyPrivateFieldDeletes = (publicUserData = {}, { deleteValue = () => undefined } = {}) => (
  getLegacyPrivatePublicUserFields(publicUserData).reduce((patch, field) => {
    patch[field] = deleteValue();
    return patch;
  }, {})
);

export const buildPublicUserBackfillPayload = (uid, userData = {}, { serverTimestamp = () => new Date() } = {}) => {
  const displayName = typeof userData.displayName === 'string' ? userData.displayName : '';
  const payload = {
    uid,
    profileId: uid,
    ownerUid: uid,
    username: normalizeUsername(userData.username) || generateUsername(displayName, uid),
    displayName,
    displayNameLower: displayName.toLowerCase(),
    roles: cleanStringArray(userData.roles),
    themes: cleanStringArray(userData.themes),
    onboardingComplete: true,
    updatedAt: serverTimestamp(),
  };

  PUBLIC_NULLABLE_STRING_FIELDS.forEach((field) => copyNullableString(payload, userData, field));
  PUBLIC_STRING_ONLY_FIELDS.forEach((field) => copyStringOnly(payload, userData, field));

  PUBLIC_ARRAY_FIELDS.forEach((field) => {
    payload[field] = cleanStringArray(userData[field]);
  });

  if (Array.isArray(userData.quickProfilePostIds)) {
    payload.quickProfilePostIds = cleanStringArray(userData.quickProfilePostIds);
  }

  // Always recompute displayNameLower from the final public displayName.
  payload.displayNameLower = String(payload.displayName || '').toLowerCase();

  return payload;
};

export const parseArgs = (argv = process.argv.slice(2)) => {
  const options = {
    apply: false,
    uid: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg.startsWith('--uid=')) {
      options.uid = arg.slice('--uid='.length).trim() || null;
      continue;
    }
    if (arg === '--uid') {
      options.uid = String(argv[i + 1] || '').trim() || null;
      i += 1;
      continue;
    }
    throw new Error(`Onbekende parameter: ${arg}`);
  }

  return {
    ...options,
    dryRun: !options.apply,
  };
};

const printHelp = () => {
  console.log(`
Backfill publicUsers vanuit users (admin eenmalig script).

Dry run (default, schrijft niets):
  node functions/scripts/backfillPublicUsersFromUsers.js

Eén profiel testen in dry run:
  node functions/scripts/backfillPublicUsersFromUsers.js --uid <uid>

Echte run (alleen expliciet):
  node functions/scripts/backfillPublicUsersFromUsers.js --apply
`);
};

const getUserSnapshots = async (db, uid = null) => {
  if (uid) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? [snap] : [];
  }
  const snap = await db.collection('users').get();
  return snap.docs;
};

const commitBatch = async ({ batch, count, legacyDeleteCount, dryRun, stats }) => {
  if (!count) return;
  if (dryRun) return;
  try {
    await batch.commit();
    stats.written += count;
    stats.legacyPrivateFieldsDeleted += legacyDeleteCount;
  } catch (error) {
    stats.failed += count;
    console.error('[backfillPublicUsersFromUsers] Batch write failed:', error?.message || error);
  }
};

export const runBackfill = async ({ db, uid = null, dryRun = true, serverTimestamp = () => new Date(), deleteValue = () => undefined } = {}) => {
  if (!db) throw new Error('Firestore db is verplicht.');

  const stats = {
    scanned: 0,
    eligible: 0,
    skippedNotEligible: 0,
    wouldWrite: 0,
    written: 0,
    failed: 0,
    legacyPrivateFieldsFound: 0,
    legacyPrivateFieldsDeleted: 0,
  };

  const userDocs = await getUserSnapshots(db, uid);
  let batch = db.batch();
  let batchCount = 0;
  let batchLegacyDeleteCount = 0;

  for (const docSnap of userDocs) {
    stats.scanned += 1;
    const userData = docSnap.data() || {};
    if (!isPublishEligibleUser(userData)) {
      stats.skippedNotEligible += 1;
      continue;
    }

    stats.eligible += 1;
    const publicRef = db.collection('publicUsers').doc(docSnap.id);
    const publicSnap = await publicRef.get();
    const publicData = publicSnap.exists ? (publicSnap.data() || {}) : {};
    const legacyPrivateFields = getLegacyPrivatePublicUserFields(publicData);
    const legacyDeletePatch = buildLegacyPrivateFieldDeletes(publicData, { deleteValue });
    stats.legacyPrivateFieldsFound += legacyPrivateFields.length;

    const payload = {
      ...buildPublicUserBackfillPayload(docSnap.id, userData, { serverTimestamp }),
      ...legacyDeletePatch,
    };
    stats.wouldWrite += 1;

    if (!dryRun) {
      batch.set(publicRef, payload, { merge: true });
      batchCount += 1;
      batchLegacyDeleteCount += legacyPrivateFields.length;
      if (batchCount >= BATCH_LIMIT) {
        await commitBatch({ batch, count: batchCount, legacyDeleteCount: batchLegacyDeleteCount, dryRun, stats });
        batch = db.batch();
        batchCount = 0;
        batchLegacyDeleteCount = 0;
      }
    }
  }

  await commitBatch({ batch, count: batchCount, legacyDeleteCount: batchLegacyDeleteCount, dryRun, stats });
  return stats;
};

const main = async () => {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  const { db, serverTimestamp } = await initAdmin();
  const { FieldValue } = await import('firebase-admin/firestore');
  const stats = await runBackfill({
    db,
    uid: options.uid,
    dryRun: options.dryRun,
    serverTimestamp,
    deleteValue: FieldValue.delete,
  });

  console.log('[backfillPublicUsersFromUsers] Done', {
    dryRun: options.dryRun,
    uid: options.uid,
    ...stats,
  });

  if (options.dryRun) {
    console.log('Dry run: geen writes uitgevoerd. Gebruik --apply om publicUsers te schrijven.');
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('[backfillPublicUsersFromUsers] Failed:', error);
    process.exitCode = 1;
  });
}
