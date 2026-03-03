#!/usr/bin/env node
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const parseServiceAccount = () => {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON');
  }
};

const initAdmin = () => {
  const serviceAccount = parseServiceAccount();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
  if (serviceAccount) {
    initializeApp({ credential: cert(serviceAccount), projectId: projectId || serviceAccount.project_id });
    return;
  }
  initializeApp({ credential: applicationDefault(), projectId });
};

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: !args.has('--apply'),
  };
};

const hasUserMessage = async (threadRef, userUid) => {
  const byRole = await threadRef.collection('messages').where('senderRole', '==', 'user').limit(1).get();
  if (!byRole.empty) return true;

  const byUid = await threadRef.collection('messages').where('senderUid', '==', userUid).limit(1).get();
  return !byUid.empty;
};

const run = async () => {
  const { dryRun } = parseArgs();
  initAdmin();
  const db = getFirestore();

  const snapshot = await db.collection('threads').where('type', '==', 'support').get();
  let scanned = 0;
  let missing = 0;
  let wouldSetTrue = 0;
  let wouldSetFalse = 0;
  let updated = 0;

  for (const threadDoc of snapshot.docs) {
    scanned += 1;
    const data = threadDoc.data() || {};
    if (typeof data.hasUserMessage === 'boolean') continue;

    missing += 1;
    const threadRef = threadDoc.ref;
    const userUid = data.userUid || null;
    const value = await hasUserMessage(threadRef, userUid);
    if (value) {
      wouldSetTrue += 1;
    } else {
      wouldSetFalse += 1;
    }

    if (!dryRun) {
      await threadRef.set(
        {
          hasUserMessage: value,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      updated += 1;
    }
  }

  console.log(JSON.stringify({
    dryRun,
    scanned,
    missing,
    wouldSetTrue,
    wouldSetFalse,
    updated,
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
