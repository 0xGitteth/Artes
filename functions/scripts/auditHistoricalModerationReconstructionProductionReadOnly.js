#!/usr/bin/env node
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { findDecidedUploadReviewCasesWithoutExamples } from '../moderationHistoricalCoverageAudit.js';
import { summarizeHistoricalReconstruction } from '../moderationHistoricalReconstructionAudit.js';
import {
  assertModerationProductionAuditProject,
  assertProductionReconstructionAuditReadOnlyOptions,
} from '../moderationProductionAuditGuard.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;
const MAX_UPLOAD_POINT_READS = 100;

const resolveProjectId = () => String(
  process.env.GOOGLE_CLOUD_PROJECT
  || process.env.GCLOUD_PROJECT
  || process.env.FIREBASE_PROJECT_ID
  || '',
).trim();

const parseLimit = (argv = process.argv.slice(2)) => {
  const inline = argv.find((arg) => arg.startsWith('--limit='));
  const separateIndex = argv.indexOf('--limit');
  const raw = inline
    ? inline.slice('--limit='.length)
    : separateIndex >= 0
      ? argv[separateIndex + 1]
      : DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new Error(`--limit moet een geheel getal tussen 1 en ${MAX_LIMIT} zijn.`);
  }
  return parsed;
};

const resolveUploadId = (reviewCase = {}) => {
  const direct = String(reviewCase.uploadId || '').trim();
  if (direct) return direct;
  const linked = Array.isArray(reviewCase.linkedUploadIds) ? reviewCase.linkedUploadIds : [];
  return linked.map((value) => String(value || '').trim()).find(Boolean) || null;
};

const main = async () => {
  const projectId = assertModerationProductionAuditProject(resolveProjectId());
  const limit = parseLimit();
  const guard = assertProductionReconstructionAuditReadOnlyOptions({
    limit,
    maxUploadPointReads: MAX_UPLOAD_POINT_READS,
  });

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const [reviewSnapshot, exampleSnapshot] = await Promise.all([
    db.collection('reviewCases').limit(limit).get(),
    db.collection('moderationExamples').limit(limit).get(),
  ]);

  const reviewCases = reviewSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const moderationExamples = exampleSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const missingCases = findDecidedUploadReviewCasesWithoutExamples({ reviewCases, moderationExamples });

  if (missingCases.length > guard.maxUploadPointReads) {
    throw new Error(`historical_reconstruction_upload_read_cap_exceeded:${missingCases.length}`);
  }

  const reconstructionRecords = [];
  let uploadPointReadsAttempted = 0;
  let uploadDocumentsFound = 0;

  for (const missingCase of missingCases) {
    const uploadId = resolveUploadId(missingCase.data);
    let upload = {};
    if (uploadId) {
      uploadPointReadsAttempted += 1;
      const uploadSnapshot = await db.collection('uploads').doc(uploadId).get();
      if (uploadSnapshot.exists) {
        uploadDocumentsFound += 1;
        upload = uploadSnapshot.data() || {};
      }
    }
    reconstructionRecords.push({ reviewCase: missingCase.data, upload });
  }

  const summary = summarizeHistoricalReconstruction(reconstructionRecords);

  console.log(JSON.stringify({
    projectId,
    auditMode: 'historical_moderation_reconstruction_read_only',
    readOnly: true,
    collectionsListed: guard.collections,
    uploadReadMode: guard.uploadReadMode,
    requestedLimitPerCollection: limit,
    reviewCasesReturned: reviewSnapshot.size,
    moderationExamplesReturned: exampleSnapshot.size,
    missingExampleCasesFound: missingCases.length,
    uploadPointReadsAttempted,
    uploadDocumentsFound,
    rawDocumentsPrinted: false,
    mediaRead: false,
    modelCalls: false,
    writes: false,
    summary,
  }, null, 2));
};

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
