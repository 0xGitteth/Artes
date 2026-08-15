import fs from 'node:fs/promises';

const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique anchor: ${label}`);
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
};

const patchFile = async (path, mutate) => {
  const before = await fs.readFile(path, 'utf8');
  const after = mutate(before);
  if (after === before) throw new Error(`No changes produced for ${path}`);
  await fs.writeFile(path, after);
  console.log(`patched ${path}`);
};

await patchFile('functions/codexDevActorRegistry.js', (source) => {
  source = replaceOnce(
    source,
    "export const CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION = 'codexDevActorLifecycleFences';\n",
    "export const CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION = 'codexDevActorLifecycleFences';\nexport const CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION = 'codexDevActorModeratorLocks';\n",
    'moderator lock collection constant',
  );

  source = replaceOnce(
    source,
    "  const lifecycleFenceRef = db.collection(CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION).doc(uid);\n  return db.runTransaction(async (transaction) => {\n    const [snapshot, fenceSnapshot, lifecycleFenceSnapshot] = await Promise.all([\n      transaction.get(ref),\n      transaction.get(fenceRef),\n      transaction.get(lifecycleFenceRef),\n    ]);\n    if (snapshot.exists) return false;\n",
    "  const lifecycleFenceRef = db.collection(CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION).doc(uid);\n  const moderatorLockRef = db.collection(CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION).doc(uid);\n  return db.runTransaction(async (transaction) => {\n    const [snapshot, fenceSnapshot, lifecycleFenceSnapshot, moderatorLockSnapshot] = await Promise.all([\n      transaction.get(ref),\n      transaction.get(fenceRef),\n      transaction.get(lifecycleFenceRef),\n      transaction.get(moderatorLockRef),\n    ]);\n    if (snapshot.exists) return false;\n    if (moderatorLockSnapshot.exists) {\n      const error = new Error(`Codex actor registration is blocked because ${uid} has production moderator authorization; operator clearance is required before reuse as Codex.`);\n      error.code = 'codex-moderator-lock-active';\n      error.status = 409;\n      error.retryable = false;\n      throw error;\n    }\n",
    'registration reads moderator lock',
  );

  const lifecycleAnchor = "export const acquireCodexDevLifecycleFence = async ({\n";
  const moderatorHelper = `export const ensureModeratorUidLockedOutOfCodexRegistration = async ({\n  db, uid, email = '', now = new Date(),\n}) => {\n  if (!db || !uid) throw new Error('Firestore db and moderator UID are required.');\n  const registryRef = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);\n  const moderatorLockRef = db.collection(CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION).doc(uid);\n  return db.runTransaction(async (transaction) => {\n    const [registrySnapshot, lockSnapshot] = await Promise.all([\n      transaction.get(registryRef),\n      transaction.get(moderatorLockRef),\n    ]);\n    if (registrySnapshot.exists || isCodexDevUid(uid)) {\n      const error = new Error('Codex Dev identity cannot receive production moderator authorization.');\n      error.code = 'codex-moderator-production-denied';\n      error.status = 403;\n      error.retryable = false;\n      throw error;\n    }\n    if (!lockSnapshot.exists) {\n      transaction.set(moderatorLockRef, {\n        uid,\n        email: String(email || '').toLowerCase(),\n        blocksCodexRegistration: true,\n        reason: 'productionModeratorAuthorization',\n        createdAt: now,\n        updatedAt: now,\n      });\n      return true;\n    }\n    return false;\n  });\n};\n\n`;
  source = replaceOnce(source, lifecycleAnchor, `${moderatorHelper}${lifecycleAnchor}`, 'moderator lock helper insertion');
  return source;
});

await patchFile('functions/index.js', (source) => {
  source = replaceOnce(
    source,
    "  ensureCodexDevActorRegistered,\n  isKnownCodexDevActorUid,\n",
    "  ensureCodexDevActorRegistered,\n  ensureModeratorUidLockedOutOfCodexRegistration,\n  isKnownCodexDevActorUid,\n",
    'registry import',
  );

  source = replaceOnce(
    source,
    `const ensureModerator = async (decoded) => {\n  requireEmailVerified(decoded);\n  const { moderatorEmails } = await getModeratorConfig();\n  const email = decoded?.email?.toLowerCase() || '';\n  if (!email || !moderatorEmails.includes(email)) {\n    const error = new Error('Not a moderator');\n    error.status = 403;\n    throw error;\n  }\n  return { email };\n};`,
    `const ensureModerator = async (decoded) => {\n  requireEmailVerified(decoded);\n  const { moderatorEmails } = await getModeratorConfig();\n  const email = decoded?.email?.toLowerCase() || '';\n  if (!email || !moderatorEmails.includes(email)) {\n    const error = new Error('Not a moderator');\n    error.status = 403;\n    throw error;\n  }\n  if (isCodexDevForProductionDeny(decoded)) {\n    const error = new Error('Codex Dev cannot receive production moderator authorization.');\n    error.status = 403;\n    throw error;\n  }\n  await ensureModeratorUidLockedOutOfCodexRegistration({\n    db, uid: decoded?.uid, email, now: new Date(),\n  });\n  return { email };\n};`,
    'ensureModerator production deny and lock',
  );
  return source;
});

await patchFile('firestore.rules', (source) => {
  source = replaceOnce(
    source,
    `    match /codexDevActorLifecycleFences/{uid} {\n      allow read, write: if false;\n    }\n`,
    `    match /codexDevActorLifecycleFences/{uid} {\n      allow read, write: if false;\n    }\n    match /codexDevActorModeratorLocks/{uid} {\n      allow read, write: if false;\n    }\n`,
    'moderator locks rules deny',
  );

  const beforeThreadHelper = `    function isTestActorThread(threadId) {\n      let path = /databases/$(database)/documents/threads/$(threadId);\n      let thread = exists(path) ? get(path).data : getAfter(path).data;\n      return thread.type == 'dm' && (\n        ('participantUids' in thread && thread.participantUids is list\n          && thread.participantUids.size() == 2\n          && (isTestActorUid(thread.participantUids[0])\n            || isTestActorUid(thread.participantUids[1])\n            || isKnownCodexProductionDeniedUid(thread.participantUids[0])\n            || isKnownCodexProductionDeniedUid(thread.participantUids[1])))\n        || ('participants' in thread && thread.participants is list\n          && thread.participants.size() == 2\n          && (isTestActorUid(thread.participants[0])\n            || isTestActorUid(thread.participants[1])\n            || isKnownCodexProductionDeniedUid(thread.participants[0])\n            || isKnownCodexProductionDeniedUid(thread.participants[1])))\n      );\n    }`;
  const afterThreadHelper = `    function isTestActorThreadData(thread) {\n      return thread.type == 'dm' && (\n        ('participantUids' in thread && thread.participantUids is list\n          && thread.participantUids.size() == 2\n          && (isTestActorUid(thread.participantUids[0])\n            || isTestActorUid(thread.participantUids[1])\n            || isKnownCodexProductionDeniedUid(thread.participantUids[0])\n            || isKnownCodexProductionDeniedUid(thread.participantUids[1])))\n        || ('participants' in thread && thread.participants is list\n          && thread.participants.size() == 2\n          && (isTestActorUid(thread.participants[0])\n            || isTestActorUid(thread.participants[1])\n            || isKnownCodexProductionDeniedUid(thread.participants[0])\n            || isKnownCodexProductionDeniedUid(thread.participants[1])))\n      );\n    }\n    function isTestActorThread(threadId) {\n      let path = /databases/$(database)/documents/threads/$(threadId);\n      let thread = exists(path) ? get(path).data : getAfter(path).data;\n      return isTestActorThreadData(thread);\n    }`;
  source = replaceOnce(source, beforeThreadHelper, afterThreadHelper, 'thread data helper');
  source = replaceOnce(
    source,
    "      allow read: if request.auth != null && !isTestActorThread(threadId) && (\n",
    "      allow read: if request.auth != null && !isTestActorThreadData(resource.data) && (\n",
    'thread list read uses resource data',
  );
  return source;
});

await patchFile('tests/finalHolisticIsolation.test.mjs', (source) => {
  source = replaceOnce(
    source,
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\n",
    "import assert from 'node:assert/strict';\nimport fs from 'node:fs/promises';\nimport test from 'node:test';\n",
    'final holistic fs import',
  );
  source = replaceOnce(
    source,
    "  ensureCodexDevActorRegistered,\n  releaseCodexDevLifecycleFence,\n",
    "  ensureCodexDevActorRegistered,\n  ensureModeratorUidLockedOutOfCodexRegistration,\n  releaseCodexDevLifecycleFence,\n",
    'final holistic moderator helper import',
  );
  source += `\n\ntest('production moderator authorization permanently serializes against Codex registration', async () => {\n  const { db, docs } = createMemoryDb();\n  assert.equal(await ensureModeratorUidLockedOutOfCodexRegistration({\n    db, uid: 'moderator-user', email: 'MOD@example.test', now: new Date('2026-08-15T19:00:00Z'),\n  }), true);\n  assert.equal(docs.get('codexDevActorModeratorLocks/moderator-user').blocksCodexRegistration, true);\n  assert.equal(docs.get('codexDevActorModeratorLocks/moderator-user').email, 'mod@example.test');\n  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'moderator-user' }),\n    (error) => error.code === 'codex-moderator-lock-active' && error.retryable === false);\n\n  const { db: retiredDb } = createMemoryDb([[\n    'codexDevActorRegistry/retired-codex', { uid: 'retired-codex', actor: 'codex' },\n  ]]);\n  await assert.rejects(ensureModeratorUidLockedOutOfCodexRegistration({\n    db: retiredDb, uid: 'retired-codex', email: 'mod@example.test',\n  }), (error) => error.code === 'codex-moderator-production-denied' && error.status === 403);\n});\n\ntest('ensureModerator rejects Codex claims and installs the moderator registration lock', async () => {\n  const indexSource = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');\n  assert.match(indexSource, /if \\(isCodexDevForProductionDeny\\(decoded\\)\\)/);\n  assert.match(indexSource, /await ensureModeratorUidLockedOutOfCodexRegistration\\(\\{[\\s\\S]*?uid: decoded\\?\\.uid, email/);\n});\n`;
  return source;
});

await patchFile('tests/firestore.codexMarkerIsolation.rules.test.mjs', (source) => {
  source = replaceOnce(
    source,
    "import { doc, serverTimestamp, setDoc } from 'firebase/firestore';\n",
    "import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';\n",
    'rules test firestore imports',
  );
  source = replaceOnce(
    source,
    `    await setDoc(doc(db, 'codexDevActorRegistry', 'registered-codex'), {\n      uid: 'registered-codex', actor: 'codex', productionDenyOnly: true,\n    });\n`,
    `    await setDoc(doc(db, 'codexDevActorRegistry', 'registered-codex'), {\n      uid: 'registered-codex', actor: 'codex', productionDenyOnly: true,\n    });\n    await setDoc(doc(db, 'config', 'moderation'), { moderatorEmails: ['mod@example.test'] });\n    await Promise.all(Array.from({ length: 20 }, (_, index) => setDoc(doc(db, 'threads', \`support_bulk_\${index}\`), {\n      type: 'support', userUid: \`ordinary_\${index}\`, createdAt: new Date(), updatedAt: new Date(),\n    })));\n`,
    'seed moderator and support threads',
  );
  source = replaceOnce(
    source,
    "  const spoofedDb = env.authenticatedContext('spoofed-marker', { email: 'spoofed@example.test' }).firestore();\n",
    "  const spoofedDb = env.authenticatedContext('spoofed-marker', { email: 'spoofed@example.test' }).firestore();\n  const moderatorDb = env.authenticatedContext('moderator-user', { email: 'mod@example.test', email_verified: true }).firestore();\n",
    'moderator db context',
  );
  source = replaceOnce(
    source,
    "  await assertFails(setDoc(doc(ownerDb, 'threads', 'owner_registered_codex'), {\n    type: 'dm', participantUids: ['owner', 'registered-codex'], dmKey: 'owner_registered_codex',\n    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),\n  }));\n  console.log('PASS firestore.codexMarkerIsolation.rules.test');\n",
    "  await assertFails(setDoc(doc(ownerDb, 'threads', 'owner_registered_codex'), {\n    type: 'dm', participantUids: ['owner', 'registered-codex'], dmKey: 'owner_registered_codex',\n    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),\n  }));\n\n  const supportSnapshot = await assertSucceeds(getDocs(query(\n    collection(moderatorDb, 'threads'),\n    where('type', '==', 'support'),\n  )));\n  if (supportSnapshot.size !== 20) throw new Error(`Expected 20 support threads, got ${supportSnapshot.size}`);\n\n  console.log('PASS firestore.codexMarkerIsolation.rules.test');\n",
    'bulk moderator support query regression',
  );
  return source;
});

console.log('Final two isolation blockers applied.');
