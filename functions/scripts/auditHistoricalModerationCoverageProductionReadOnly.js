#!/usr/bin/env node
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { summarizeHistoricalModerationCoverage } from '../moderationHistoricalCoverageAudit.js';
import {
  assertModerationProductionAuditProject,
  assertProductionCoverageAuditReadOnlyOptions,
} from '../moderationProductionAuditGuard.js';

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

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

const main = async () => {
  const projectId = assertModerationProductionAuditProject(resolveProjectId());
  const limit = parseLimit();
  const options = assertProductionCoverageAuditReadOnlyOptions({ limit });

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  const [reviewCaseSnapshot, exampleSnapshot] = await Promise.all([
    db.collection('reviewCases').limit(options.limit).get(),
    db.collection('moderationExamples').limit(options.limit).get(),
  ]);

  const summary = summarizeHistoricalModerationCoverage({
    reviewCases: reviewCaseSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    moderationExamples: exampleSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  });

  console.log(JSON.stringify({
    projectId,
    auditMode: 'historical_moderation_coverage_read_only',
    readOnly: true,
    collections: options.collections,
    requestedLimitPerCollection: options.limit,
    reviewCasesReturned: reviewCaseSnapshot.size,
    moderationExamplesReturned: exampleSnapshot.size,
    reviewCasesPossiblyTruncated: reviewCaseSnapshot.size === options.limit,
    moderationExamplesPossiblyTruncated: exampleSnapshot.size === options.limit,
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
