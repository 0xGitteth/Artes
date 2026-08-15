import fs from 'node:fs/promises';

const path = 'scripts/applyFinalTwoIsolationBlockers.mjs';
let source = await fs.readFile(path, 'utf8');
const before = `  source = replaceOnce(\n    source,\n    \"      allow read: if request.auth != null && !isTestActorThread(threadId) && (\\n\",\n    \"      allow read: if request.auth != null && !isTestActorThreadData(resource.data) && (\\n\",\n    'thread list read uses resource data',\n  );`;
const after = `  source = replaceOnce(\n    source,\n    \"    match /threads/{threadId} {\\n      allow read: if request.auth != null && !isTestActorThread(threadId) && (\\n\",\n    \"    match /threads/{threadId} {\\n      allow read: if request.auth != null && !isTestActorThreadData(resource.data) && (\\n\",\n    'thread list read uses resource data',\n  );`;
if (!source.includes(before)) throw new Error('Old non-unique thread-read anchor not found');
source = source.replace(before, after);
await fs.writeFile(path, source);
console.log('Repaired thread-read patch anchor.');
