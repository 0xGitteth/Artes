#!/usr/bin/env node
import fs from 'node:fs/promises';

const read = (path) => fs.readFile(path, 'utf8');
const write = (path, content) => fs.writeFile(path, content, 'utf8');

const replaceOnce = (source, search, replacement, label) => {
  const first = source.indexOf(search);
  if (first === -1) throw new Error(`Missing anchor for ${label}`);
  if (source.indexOf(search, first + search.length) !== -1) throw new Error(`Anchor for ${label} is not unique`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
};

{
  const path = 'functions/index.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "    const postRef = action === 'publishNow' || action === 'repairPublished'\n      ? db.collection('posts').doc(uploadId)\n      : null;",
    "    const postRef = action === 'publishNow' || action === 'repairPublished'\n      ? db.collection(isCodexDevUid(userId) ? 'codexDevPosts' : 'posts').doc(uploadId)\n      : null;",
    'isolated publication collection defense',
  );
  await write(path, source);
}

{
  const path = 'tests/codexDevIsolation.test.mjs';
  let source = await read(path);
  const start = source.indexOf("test('publishNow and repairPublished recheck historical registry in the publication transaction'");
  if (start === -1) throw new Error('Missing legacy publication transaction test');
  const end = source.indexOf("test('moderateImage derives all quarantine decisions from production-deny identity'", start);
  if (end === -1) throw new Error('Missing next test anchor');
  const replacement = `test('publishNow and repairPublished recheck historical registry in the authoritative mutation transaction', async () => {\n  const [source, helper] = await Promise.all([\n    fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),\n    fs.readFile(new URL('../functions/userModerationActionIsolation.js', import.meta.url), 'utf8'),\n  ]);\n  const start = source.indexOf('export const userModerationAction');\n  const end = source.indexOf('export const moderatorDecide', start);\n  const implementation = source.slice(start, end);\n\n  assert.match(implementation, /await runUserModerationActionMutation\\(\\{[\\s\\S]*uid: userId,[\\s\\S]*isKnownCodexDevActorUid,[\\s\\S]*mutate: async \\(transaction\\) =>/);\n  assert.match(implementation, /collection\\(isCodexDevUid\\(userId\\) \\? 'codexDevPosts' : 'posts'\\)/,\n    'defense in depth keeps canonical Codex publication out of production posts');\n  assert.match(implementation, /transaction\\.create\\(postRef/);\n  assert.match(implementation, /transaction\\.set\\(\\s*uploadRef/);\n\n  const transactionStart = helper.indexOf('db.runTransaction(async (transaction) =>');\n  const registryGuard = helper.indexOf('isKnownCodexDevActorUid({ db, uid, transaction })', transactionStart);\n  const mutationCallback = helper.indexOf('return mutate(transaction)', registryGuard);\n  assert.ok(transactionStart !== -1 && transactionStart < registryGuard,\n    'shared helper reads registry from the transaction snapshot');\n  assert.ok(registryGuard < mutationCallback,\n    'registry denial is evaluated before the action mutation callback can queue writes');\n});\n\n`;
  source = source.slice(0, start) + replacement + source.slice(end);
  await write(path, source);
}

await fs.unlink(new URL(import.meta.url));
console.log('✅ Restored publication defense and updated the stale isolation assertion.');
