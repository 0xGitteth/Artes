#!/usr/bin/env node
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { summarizeModerationLearningCandidates } from '../moderationLearningAudit.js';
import { assertModerationLearningStagingProject } from '../moderationLearningProjectGuard.js';

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
  const projectId = assertModerationLearningStagingProject(resolveProjectId());
  const limit = parseLimit();

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const snapshot = await db.collection('moderationExamples')
    .limit(limit)
    .get();

  const summary = summarizeModerationLearningCandidates(
    snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  );

  console.log(JSON.stringify({
    projectId,
    readOnly: true,
    requestedLimit: limit,
    returnedDocuments: snapshot.size,
    summary,
  }, null, 2));
};

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
