#!/usr/bin/env node
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const target = 'scripts/applyFinalCodexIsolationBlockers.mjs';
let source = await fs.readFile(target, 'utf8');

const oldReview = `  source = replaceOnce(\n    source,\n    \"      allow read: if isDevAnon() || isModerator() || (request.auth != null && request.auth.uid == resource.data.userId);\",\n    \"      allow read: if !isKnownCodexProductionDenied() && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId));\",\n    'reviewCases production deny',\n  );`;
const newReview = `  source = replaceOnceAfter(\n    source,\n    \"    match /reviewCases/{reviewCaseId} {\",\n    \"      allow read: if isDevAnon() || isModerator() || (request.auth != null && request.auth.uid == resource.data.userId);\",\n    \"      allow read: if !isKnownCodexProductionDenied() && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId));\",\n    'reviewCases production deny',\n  );`;

const oldUploads = `  source = replaceOnce(\n    source,\n    \"      allow read: if isDevAnon() || isModerator() || (request.auth != null && request.auth.uid == resource.data.userId);\",\n    String.raw\`      allow read: if (!isKnownCodexProductionDenied()\n          && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId)))\n        || (isCodexDev()\n          && request.auth.uid == resource.data.userId\n          && ('testActor' in resource.data)\n          && resource.data.testActor == 'codex');\`,\n    'uploads production deny with narrow test self-read',\n  );`;
const newUploads = `  source = replaceOnceAfter(\n    source,\n    \"    match /uploads/{uploadId} {\",\n    \"      allow read: if isDevAnon() || isModerator() || (request.auth != null && request.auth.uid == resource.data.userId);\",\n    String.raw\`      allow read: if (!isKnownCodexProductionDenied()\n          && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId)))\n        || (isCodexDev()\n          && request.auth.uid == resource.data.userId\n          && ('testActor' in resource.data)\n          && resource.data.testActor == 'codex');\`,\n    'uploads production deny with narrow test self-read',\n  );`;

if (!source.includes(oldReview)) throw new Error('reviewCases patch block not found');
if (!source.includes(oldUploads)) throw new Error('uploads patch block not found');
source = source.replace(oldReview, newReview).replace(oldUploads, newUploads);
await fs.writeFile(target, source, 'utf8');
await fs.unlink(fileURLToPath(import.meta.url));
console.log('✅ Patcher repaired. Run: node scripts/applyFinalCodexIsolationBlockers.mjs');
