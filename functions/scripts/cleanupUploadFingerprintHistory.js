#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DRY_RUN = String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false';
const EXPORT_DIR = path.join(__dirname, '..', '..', 'tmp', 'cleanup-exports');

const parseServiceAccount = () => {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON is geen geldige JSON.');
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

const parseCsv = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    uploadIds: [],
    sha256: [],
    userId: null,
    before: null,
    applyFlag: false,
    purgeReportedFingerprints: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--apply') {
      options.applyFlag = true;
      continue;
    }
    if (arg === '--purgeReportedFingerprints') {
      options.purgeReportedFingerprints = true;
      continue;
    }
    if (arg.startsWith('--uploadIds=')) {
      options.uploadIds.push(...parseCsv(arg.slice('--uploadIds='.length)));
      continue;
    }
    if (arg === '--uploadIds') {
      options.uploadIds.push(...parseCsv(args[i + 1]));
      i += 1;
      continue;
    }
    if (arg.startsWith('--sha256=')) {
      options.sha256.push(...parseCsv(arg.slice('--sha256='.length)));
      continue;
    }
    if (arg === '--sha256') {
      options.sha256.push(...parseCsv(args[i + 1]));
      i += 1;
      continue;
    }
    if (arg.startsWith('--userId=')) {
      options.userId = arg.slice('--userId='.length).trim() || null;
      continue;
    }
    if (arg === '--userId') {
      options.userId = String(args[i + 1] || '').trim() || null;
      i += 1;
      continue;
    }
    if (arg.startsWith('--before=')) {
      options.before = arg.slice('--before='.length).trim() || null;
      continue;
    }
    if (arg === '--before') {
      options.before = String(args[i + 1] || '').trim() || null;
      i += 1;
      continue;
    }

    throw new Error(`Onbekende parameter: ${arg}`);
  }

  options.uploadIds = [...new Set(options.uploadIds)];
  options.sha256 = [...new Set(options.sha256.map((v) => v.toLowerCase()))];

  const hasScope = options.uploadIds.length > 0 || options.sha256.length > 0 || Boolean(options.userId);
  if (!options.help && !hasScope) {
    throw new Error('Scope verplicht: geef --uploadIds, --sha256 en/of --userId op.');
  }

  let beforeDate = null;
  if (options.before) {
    beforeDate = new Date(options.before);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new Error('--before moet een geldige datum zijn, bijvoorbeeld 2025-01-01 of 2025-01-01T00:00:00Z.');
    }
  }

  return {
    ...options,
    beforeDate,
    dryRun: DEFAULT_DRY_RUN || !options.applyFlag,
  };
};

const printHelp = () => {
  console.log(`
Cleanup utility voor uploadhistorie en fingerprint-data.

Voorbeeld (dry run, default):
  node functions/scripts/cleanupUploadFingerprintHistory.js --uploadIds=abc123,def456

Voorbeeld met sha256 + user + datumgrens:
  node functions/scripts/cleanupUploadFingerprintHistory.js --sha256=<hash> --userId=<uid> --before=2025-01-01

Echte run (alleen expliciet):
  DRY_RUN=false node functions/scripts/cleanupUploadFingerprintHistory.js --uploadIds=abc123 --apply

Optioneel (expliciet):
  --purgeReportedFingerprints  # alleen gebruiken als reportedFingerprints ook opgeschoond moet worden
`);
};

const timestampToDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const fingerprintKey = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const sha = String(entry.sha256 || '').toLowerCase();
  const dhash = String(entry.dhash || '').toLowerCase();
  if (sha) return `sha:${sha}`;
  if (dhash) return `dhash:${dhash}`;
  return null;
};

const isFingerprintMatch = (entry, fingerprintIndex) => {
  const key = fingerprintKey(entry);
  return key ? fingerprintIndex.has(key) : false;
};

const cloneForExport = (data) => JSON.parse(JSON.stringify(data));

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const run = async () => {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  initAdmin();
  const db = getFirestore();

  const uploadDocs = new Map();

  for (const uploadId of options.uploadIds) {
    const snap = await db.collection('uploads').doc(uploadId).get();
    if (snap.exists) uploadDocs.set(snap.id, snap);
  }

  for (const sha of options.sha256) {
    const snap = await db.collection('uploads').where('fingerprints.sha256', '==', sha).get();
    snap.docs.forEach((docSnap) => uploadDocs.set(docSnap.id, docSnap));
  }

  if (options.userId) {
    const snap = await db.collection('uploads').where('userId', '==', options.userId).get();
    snap.docs.forEach((docSnap) => uploadDocs.set(docSnap.id, docSnap));
  }

  let scopedUploads = [...uploadDocs.values()];
  if (options.beforeDate) {
    scopedUploads = scopedUploads.filter((docSnap) => {
      const createdAt = timestampToDate(docSnap.data()?.createdAt);
      return createdAt && createdAt.getTime() < options.beforeDate.getTime();
    });
  }

  const uploadIdsToDelete = new Set(scopedUploads.map((docSnap) => docSnap.id));
  const fingerprintIndex = new Set();
  const userIds = new Set();
  const reviewCaseIdsFromUploads = new Set();

  scopedUploads.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (data.userId) userIds.add(String(data.userId));
    if (data.reviewCaseId) reviewCaseIdsFromUploads.add(String(data.reviewCaseId));
    const fp = data.fingerprints || null;
    const key = fingerprintKey(fp);
    if (key) fingerprintIndex.add(key);
    if (fp?.sha256) fingerprintIndex.add(`sha:${String(fp.sha256).toLowerCase()}`);
    if (fp?.dhash) fingerprintIndex.add(`dhash:${String(fp.dhash).toLowerCase()}`);
  });

  const impactedUserModeration = new Map();
  for (const userId of userIds) {
    const snap = await db.collection('userModeration').doc(userId).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const blocked = Array.isArray(data.blockedFingerprints) ? data.blockedFingerprints : [];
    const overrides = Array.isArray(data.freshEvaluationOverrides) ? data.freshEvaluationOverrides : [];

    const blockedToRemove = blocked.filter((item) => (
      isFingerprintMatch(item, fingerprintIndex)
      || (item?.uploadId && uploadIdsToDelete.has(String(item.uploadId)))
    ));

    const overridesToRemove = overrides.filter((item) => (
      isFingerprintMatch(item, fingerprintIndex)
      || (item?.uploadId && uploadIdsToDelete.has(String(item.uploadId)))
    ));

    if (blockedToRemove.length || overridesToRemove.length) {
      impactedUserModeration.set(userId, {
        snapshot: snap,
        blockedToRemove,
        overridesToRemove,
      });
    }
  }

  const impactedReviewCases = new Map();

  for (const reviewCaseId of reviewCaseIdsFromUploads) {
    const snap = await db.collection('reviewCases').doc(reviewCaseId).get();
    if (snap.exists) impactedReviewCases.set(snap.id, snap);
  }

  for (const uploadId of uploadIdsToDelete) {
    const byUploadId = await db.collection('reviewCases').where('uploadId', '==', uploadId).get();
    byUploadId.docs.forEach((docSnap) => impactedReviewCases.set(docSnap.id, docSnap));

    const byLinked = await db.collection('reviewCases').where('linkedUploadIds', 'array-contains', uploadId).get();
    byLinked.docs.forEach((docSnap) => impactedReviewCases.set(docSnap.id, docSnap));
  }

  const allReviewCases = await db.collection('reviewCases').get();
  allReviewCases.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const fingerprints = Array.isArray(data.fingerprints) ? data.fingerprints : [];
    const hasArrayMatch = fingerprints.some((entry) => isFingerprintMatch(entry, fingerprintIndex));
    const hasReportedMatch = options.purgeReportedFingerprints
      ? isFingerprintMatch(data.reportedFingerprints, fingerprintIndex)
      : false;
    if (hasArrayMatch || hasReportedMatch) {
      impactedReviewCases.set(docSnap.id, docSnap);
    }
  });

  const uploadRefsToPatch = [];
  if (uploadIdsToDelete.size > 0) {
    const allUploads = await db.collection('uploads').get();
    allUploads.docs.forEach((docSnap) => {
      if (uploadIdsToDelete.has(docSnap.id)) return;
      const data = docSnap.data() || {};
      if (data.matchedUploadId && uploadIdsToDelete.has(String(data.matchedUploadId))) {
        uploadRefsToPatch.push({
          snapshot: docSnap,
          action: 'delete matchedUploadId',
        });
      }
    });
  }

  const reviewCasePlans = [];
  for (const snap of impactedReviewCases.values()) {
    const data = snap.data() || {};
    const linkedUploadIds = Array.isArray(data.linkedUploadIds) ? data.linkedUploadIds.map(String) : [];
    const nextLinked = linkedUploadIds.filter((id) => !uploadIdsToDelete.has(id));
    const removedLinked = linkedUploadIds.filter((id) => uploadIdsToDelete.has(id));

    const fingerprints = Array.isArray(data.fingerprints) ? data.fingerprints : [];
    const nextFingerprints = fingerprints.filter((entry) => !isFingerprintMatch(entry, fingerprintIndex));
    const removedFingerprints = fingerprints.filter((entry) => isFingerprintMatch(entry, fingerprintIndex));

    const reportMatch = options.purgeReportedFingerprints
      ? isFingerprintMatch(data.reportedFingerprints, fingerprintIndex)
      : false;

    const patch = {};
    const patchDetails = [];

    if (removedLinked.length > 0) {
      patch.linkedUploadIds = nextLinked;
      patchDetails.push({ field: 'linkedUploadIds', removed: removedLinked });
    }

    const uploadIdValue = data.uploadId ? String(data.uploadId) : null;
    if (uploadIdValue && uploadIdsToDelete.has(uploadIdValue)) {
      if (nextLinked.length > 0) {
        patch.uploadId = nextLinked[0];
        patchDetails.push({ field: 'uploadId', action: `relinked -> ${nextLinked[0]}` });
      } else {
        patch.uploadId = FieldValue.delete();
        patchDetails.push({ field: 'uploadId', action: 'deleted dangling reference' });
      }
    }

    if (removedFingerprints.length > 0) {
      patch.fingerprints = nextFingerprints;
      patchDetails.push({ field: 'fingerprints', removedCount: removedFingerprints.length });
    }

    if (reportMatch) {
      patch.reportedFingerprints = FieldValue.delete();
      patchDetails.push({ field: 'reportedFingerprints', action: 'deleted matched fingerprint object' });
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = FieldValue.serverTimestamp();
      reviewCasePlans.push({
        snapshot: snap,
        patch,
        patchDetails,
        deleteDoc: false,
      });
    }
  }

  const backup = {
    generatedAt: new Date().toISOString(),
    options: {
      uploadIds: options.uploadIds,
      sha256: options.sha256,
      userId: options.userId,
      before: options.before,
      dryRun: options.dryRun,
      applyFlag: options.applyFlag,
      purgeReportedFingerprints: options.purgeReportedFingerprints,
    },
    uploadsToDelete: scopedUploads.map((snap) => ({ id: snap.id, data: cloneForExport(snap.data() || {}) })),
    userModerationToPatch: [...impactedUserModeration.entries()].map(([userId, item]) => ({
      userId,
      data: cloneForExport(item.snapshot.data() || {}),
      blockedToRemove: cloneForExport(item.blockedToRemove),
      overridesToRemove: cloneForExport(item.overridesToRemove),
    })),
    reviewCasesToPatch: reviewCasePlans.map((item) => ({
      id: item.snapshot.id,
      data: cloneForExport(item.snapshot.data() || {}),
      patchDetails: item.patchDetails,
    })),
    uploadRefsToPatch: uploadRefsToPatch.map((item) => ({
      id: item.snapshot.id,
      data: cloneForExport(item.snapshot.data() || {}),
      action: item.action,
    })),
  };

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const exportFile = path.join(EXPORT_DIR, `upload-fingerprint-cleanup-${Date.now()}.json`);
  fs.writeFileSync(exportFile, JSON.stringify(backup, null, 2));

  const dryRunReport = {
    dryRun: options.dryRun,
    backupFile: exportFile,
    scope: {
      uploadIds: options.uploadIds,
      sha256: options.sha256,
      userId: options.userId,
      before: options.before,
      purgeReportedFingerprints: options.purgeReportedFingerprints,
    },
    counts: {
      uploadsToDelete: scopedUploads.length,
      userModerationDocsToPatch: impactedUserModeration.size,
      reviewCasesToPatch: reviewCasePlans.length,
      uploadsToPatchMatchedUploadId: uploadRefsToPatch.length,
    },
    deleteDocs: {
      uploads: scopedUploads.map((snap) => snap.id),
    },
    patchDocs: {
      userModeration: [...impactedUserModeration.entries()].map(([userId, item]) => ({
        userId,
        blockedFingerprintsRemove: item.blockedToRemove.length,
        freshEvaluationOverridesRemove: item.overridesToRemove.length,
      })),
      reviewCases: reviewCasePlans.map((item) => ({
        reviewCaseId: item.snapshot.id,
        details: item.patchDetails,
      })),
      uploads: uploadRefsToPatch.map((item) => ({
        uploadId: item.snapshot.id,
        action: item.action,
      })),
    },
  };

  console.log(JSON.stringify(dryRunReport, null, 2));

  if (options.dryRun) {
    console.log('\nDRY RUN actief: geen writes uitgevoerd.');
    return;
  }

  if (String(process.env.DRY_RUN || 'true').toLowerCase() !== 'false' || !options.applyFlag) {
    throw new Error('Echte cleanup geblokkeerd: zet DRY_RUN=false EN gebruik --apply.');
  }

  const writes = [];

  for (const [userId, item] of impactedUserModeration.entries()) {
    const data = item.snapshot.data() || {};
    const blocked = Array.isArray(data.blockedFingerprints) ? data.blockedFingerprints : [];
    const overrides = Array.isArray(data.freshEvaluationOverrides) ? data.freshEvaluationOverrides : [];

    const nextBlocked = blocked.filter((entry) => !item.blockedToRemove.includes(entry));
    const nextOverrides = overrides.filter((entry) => !item.overridesToRemove.includes(entry));

    writes.push({
      ref: db.collection('userModeration').doc(userId),
      type: 'set',
      data: {
        blockedFingerprints: nextBlocked,
        freshEvaluationOverrides: nextOverrides,
        updatedAt: FieldValue.serverTimestamp(),
      },
      options: { merge: true },
    });
  }

  for (const item of reviewCasePlans) {
    writes.push({
      ref: item.snapshot.ref,
      type: 'set',
      data: item.patch,
      options: { merge: true },
    });
  }

  for (const item of uploadRefsToPatch) {
    writes.push({
      ref: item.snapshot.ref,
      type: 'set',
      data: { matchedUploadId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
      options: { merge: true },
    });
  }

  for (const snap of scopedUploads) {
    writes.push({
      ref: snap.ref,
      type: 'delete',
    });
  }

  for (const writeChunk of chunk(writes, 400)) {
    const batch = db.batch();
    writeChunk.forEach((op) => {
      if (op.type === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.set(op.ref, op.data, op.options);
      }
    });
    await batch.commit();
  }

  console.log(`\nCleanup uitgevoerd. Writes: ${writes.length}. Backup: ${exportFile}`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
