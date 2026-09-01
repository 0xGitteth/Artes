#!/usr/bin/env node
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  getLegacyFreshEvaluationMigrationGate,
  LEGACY_FRESH_EVALUATION_MIN_GENERATION,
  resolveLegacyFreshEvaluationOverrideScopeKeys,
} from '../legacyFreshEvaluationMigration.js';
import {
  getModerationFreshScopeRef,
  readModerationScopeGeneration,
} from '../moderationGenerationStore.js';

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
  const projectId = process.env.GOOGLE_CLOUD_PROJECT
    || process.env.GCLOUD_PROJECT
    || process.env.FIREBASE_PROJECT_ID;
  initializeApp(serviceAccount
    ? { credential: cert(serviceAccount), projectId: projectId || serviceAccount.project_id }
    : { credential: applicationDefault(), projectId });
};

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const verifyOnly = args.has('--verify');
if (apply && verifyOnly) {
  throw new Error('Gebruik --apply of --verify, niet beide tegelijk.');
}

const normalizeId = (value) => String(value || '').trim();
const unique = (values) => Array.from(new Set(values.map(normalizeId).filter(Boolean)));

const resolveReviewCaseUploadIds = (reviewCase = {}) => unique([
  reviewCase?.uploadId,
  reviewCase?.linkedUploadId,
  ...(Array.isArray(reviewCase?.linkedUploadIds) ? reviewCase.linkedUploadIds : []),
]);

const loadDocData = async (ref) => {
  if (!ref) return null;
  const snap = await ref.get();
  return snap.exists ? (snap.data() || {}) : null;
};

const collectOverrideEvidence = async ({ db, override }) => {
  let upload = null;
  let reviewCase = null;
  const linkedUploads = [];
  const uploadId = normalizeId(override?.uploadId || override?.linkedUploadId);
  const reviewCaseId = normalizeId(override?.reviewCaseId);

  if (uploadId && !uploadId.includes('/')) {
    upload = await loadDocData(db.collection('uploads').doc(uploadId));
  }
  if (reviewCaseId && !reviewCaseId.includes('/')) {
    reviewCase = await loadDocData(db.collection('reviewCases').doc(reviewCaseId));
  }

  for (const linkedUploadId of resolveReviewCaseUploadIds(reviewCase || {}).slice(0, 25)) {
    if (linkedUploadId.includes('/') || linkedUploadId === uploadId) continue;
    const linkedUpload = await loadDocData(db.collection('uploads').doc(linkedUploadId));
    if (linkedUpload) linkedUploads.push(linkedUpload);
  }

  return {
    scopeKeys: resolveLegacyFreshEvaluationOverrideScopeKeys({
      override,
      upload,
      reviewCase,
      linkedUploads,
    }),
    uploadResolved: Boolean(upload),
    reviewCaseResolved: Boolean(reviewCase),
  };
};

const run = async () => {
  initAdmin();
  const db = getFirestore();
  const snapshot = await db.collection('userModeration').get();
  const scopeKeys = new Set();
  const unresolved = [];
  let overrideCount = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() || {};
    const overrides = Array.isArray(data.freshEvaluationOverrides)
      ? data.freshEvaluationOverrides
      : [];
    for (let index = 0; index < overrides.length; index += 1) {
      overrideCount += 1;
      const evidence = await collectOverrideEvidence({ db, override: overrides[index] });
      evidence.scopeKeys.forEach((scopeKey) => scopeKeys.add(scopeKey));
      if (evidence.scopeKeys.length === 0) {
        unresolved.push({
          userId: docSnap.id,
          overrideIndex: index,
          uploadId: normalizeId(overrides[index]?.uploadId) || null,
          reviewCaseId: normalizeId(overrides[index]?.reviewCaseId) || null,
        });
      }
    }
  }

  const currentGenerations = {};
  for (const scopeKey of [...scopeKeys].sort()) {
    const state = await readModerationScopeGeneration({ db, scopeKey });
    currentGenerations[scopeKey] = state.generation;
  }

  const beforeGate = getLegacyFreshEvaluationMigrationGate({
    scopeKeys: [...scopeKeys],
    currentGenerations,
  });

  if (apply) {
    for (const scopeKey of beforeGate.missingScopeKeys) {
      const ref = getModerationFreshScopeRef({ db, scopeKey });
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(ref);
        const current = snap.exists ? Number(snap.data()?.generation) || 0 : 0;
        if (current >= LEGACY_FRESH_EVALUATION_MIN_GENERATION) return;
        transaction.set(ref, {
          generation: LEGACY_FRESH_EVALUATION_MIN_GENERATION,
          migrationSource: 'legacy_fresh_evaluation_override',
          migrationAppliedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    }
  }

  const verifiedGenerations = {};
  for (const scopeKey of [...scopeKeys].sort()) {
    const state = await readModerationScopeGeneration({ db, scopeKey });
    verifiedGenerations[scopeKey] = state.generation;
  }
  const gate = getLegacyFreshEvaluationMigrationGate({
    scopeKeys: [...scopeKeys],
    currentGenerations: verifiedGenerations,
  });

  const report = {
    mode: apply ? 'apply' : verifyOnly ? 'verify' : 'dry-run',
    userModerationDocsScanned: snapshot.size,
    legacyOverrideCount: overrideCount,
    resolvedScopeCount: scopeKeys.size,
    unresolvedOverrideCount: unresolved.length,
    missingBeforeApply: beforeGate.missingScopeKeys,
    missingAfterRun: gate.missingScopeKeys,
    gateSatisfied: gate.satisfied,
    unresolvedOverrides: unresolved,
    note: 'Legacy overrides are intentionally not cleared by this utility.',
  };
  console.log(JSON.stringify(report, null, 2));

  if (verifyOnly && !gate.satisfied) {
    process.exitCode = 2;
  }
};

run().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
