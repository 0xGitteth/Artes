#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { normalizeProfileRoles } from '../../src/utils/roles.js';
import { isKnownCodexDevActorUid } from '../codexDevActorRegistry.js';

const BATCH_LIMIT = 400;

const arraysEqual = (a, b) => Array.isArray(a)
  && Array.isArray(b)
  && a.length === b.length
  && a.every((value, index) => value === b[index]);

export const buildExclusiveFanRoleRepair = (roles) => {
  if (!Array.isArray(roles)) return { changed: false, roles };
  const normalizedRoles = normalizeProfileRoles(roles);
  return {
    changed: !arraysEqual(roles, normalizedRoles),
    roles: normalizedRoles,
  };
};

export const parseArgs = (argv = process.argv.slice(2)) => {
  const options = { apply: false, uid: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--uid=')) options.uid = arg.slice('--uid='.length).trim() || null;
    else if (arg === '--uid') {
      options.uid = String(argv[index + 1] || '').trim() || null;
      index += 1;
    } else throw new Error(`Onbekende parameter: ${arg}`);
  }
  return { ...options, dryRun: !options.apply };
};

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

const getUserSnapshots = async (db, uid = null) => {
  if (uid) {
    const snapshot = await db.collection('users').doc(uid).get();
    return snapshot.exists ? [snapshot] : [];
  }
  return (await db.collection('users').get()).docs;
};

export const reconcileExclusiveFanProfileRoles = async ({
  db,
  serverTimestamp = () => new Date(),
  dryRun = true,
  uid = null,
  log = console.log,
  isExcludedUid = async () => false,
} = {}) => {
  if (!db) throw new Error('Firestore db ontbreekt.');

  const snapshots = await getUserSnapshots(db, uid);
  const stats = {
    dryRun,
    scanned: 0,
    excluded: 0,
    privateChanged: 0,
    publicChanged: 0,
    writes: 0,
  };

  let batch = dryRun ? null : db.batch();
  let queued = 0;
  const flush = async () => {
    if (dryRun || queued === 0) return;
    await batch.commit();
    stats.writes += queued;
    batch = db.batch();
    queued = 0;
  };

  for (const snapshot of snapshots) {
    stats.scanned += 1;
    const userUid = snapshot.id;
    if (await isExcludedUid(userUid)) {
      stats.excluded += 1;
      continue;
    }

    const privateData = snapshot.data() || {};
    if (!Array.isArray(privateData.roles)) continue;

    const privateRepair = buildExclusiveFanRoleRepair(privateData.roles);
    const targetRoles = privateRepair.roles;
    if (privateRepair.changed) {
      stats.privateChanged += 1;
      log(`[${dryRun ? 'dry-run' : 'apply'}] users/${userUid}: ${JSON.stringify(privateData.roles)} -> ${JSON.stringify(targetRoles)}`);
      if (!dryRun) {
        batch.update(snapshot.ref, { roles: targetRoles, updatedAt: serverTimestamp() });
        queued += 1;
      }
    }

    const publicRef = db.collection('publicUsers').doc(userUid);
    const publicSnapshot = await publicRef.get();
    if (publicSnapshot.exists) {
      const publicData = publicSnapshot.data() || {};
      if (!arraysEqual(publicData.roles, targetRoles)) {
        stats.publicChanged += 1;
        log(`[${dryRun ? 'dry-run' : 'apply'}] publicUsers/${userUid}: ${JSON.stringify(publicData.roles)} -> ${JSON.stringify(targetRoles)}`);
        if (!dryRun) {
          batch.update(publicRef, { roles: targetRoles, updatedAt: serverTimestamp() });
          queued += 1;
        }
      }
    }

    if (queued >= BATCH_LIMIT) await flush();
  }

  await flush();
  log(`Fan-role reconciliation klaar: ${JSON.stringify(stats)}`);
  return stats;
};

const printHelp = () => {
  console.log(`
Herstel exclusieve Fan-profielrol in users en publicUsers.

Dry run (default):
  node functions/scripts/reconcileExclusiveFanProfileRoles.js

Eén profiel in dry run:
  node functions/scripts/reconcileExclusiveFanProfileRoles.js --uid <uid>

Echte run:
  node functions/scripts/reconcileExclusiveFanProfileRoles.js --apply
`);
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const { db, serverTimestamp } = await initAdmin();
  await reconcileExclusiveFanProfileRoles({
    db,
    serverTimestamp,
    dryRun: options.dryRun,
    uid: options.uid,
    isExcludedUid: (candidateUid) => isKnownCodexDevActorUid({ db, uid: candidateUid }),
  });
}
