import fs from 'node:fs/promises';

const read = (path) => fs.readFile(path, 'utf8');
const write = (path, content) => fs.writeFile(path, content, 'utf8');

const replaceOnce = (source, from, to, label) => {
  const first = source.indexOf(from);
  if (first === -1) throw new Error(`Missing anchor for ${label}`);
  if (source.indexOf(from, first + from.length) !== -1) throw new Error(`Anchor for ${label} is not unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
};

const replaceInSection = (source, startMarker, endMarker, from, to, label) => {
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Missing section start for ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`Missing section end for ${label}`);
  const section = source.slice(start, end);
  const replaced = replaceOnce(section, from, to, label);
  return source.slice(0, start) + replaced + source.slice(end);
};

// 1. Preserve strict current Codex claims across Didit custom-claim refreshes.
{
  const path = 'functions/didit.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "import { FieldValue, getFirestore } from 'firebase-admin/firestore';\n",
    "import { FieldValue, getFirestore } from 'firebase-admin/firestore';\nimport { CODEX_DEV_ACTOR, hasCodexDevClaim, isCodexDevUid } from './codexDevIdentity.js';\n",
    'Didit Codex identity import',
  );
  source = replaceOnce(
    source,
    `      const existingClaims = shouldClearAdultVerification\n        ? (await admin.auth().getUser(uid)).customClaims || {}\n        : {};\n      await admin.auth().setCustomUserClaims(uid, {\n        ...existingClaims,\n`,
    `      const existingClaims = (await admin.auth().getUser(uid)).customClaims || {};\n      const claimsToPreserve = shouldClearAdultVerification\n        ? existingClaims\n        : (isCodexDevUid(uid) && hasCodexDevClaim(existingClaims)\n          ? { devCodex: true, devActor: CODEX_DEV_ACTOR }\n          : {});\n      await admin.auth().setCustomUserClaims(uid, {\n        ...claimsToPreserve,\n`,
    'Didit custom-claims preservation',
  );
  await write(path, source);
}

// 2. Keep partially mutated merge fences blocking registration/reacquisition until explicit clearance.
{
  const path = 'functions/codexDevActorRegistry.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `const MERGE_FENCE_LEASE_MS = 30 * 60 * 1000;\nconst LIFECYCLE_FENCE_LEASE_MS = 5 * 60 * 1000;\n`,
    `const MERGE_FENCE_LEASE_MS = 30 * 60 * 1000;\nconst LIFECYCLE_FENCE_LEASE_MS = 5 * 60 * 1000;\n\nconst throwMergeFenceRecoveryRequired = (uid) => {\n  const error = new Error(\`Codex actor registration is blocked because contributor merge mutations already committed for \${uid}; operator recovery is required before clearing the fence.\`);\n  error.code = 'codex-merge-fence-recovery-required';\n  error.status = 409;\n  error.retryable = false;\n  throw error;\n};\n`,
    'persistent merge fence recovery helper',
  );
  source = replaceInSection(
    source,
    'export const ensureCodexDevActorRegistered',
    'export const acquireCodexDevLifecycleFence',
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (Number(fence.leaseExpiresAtMs || 0) > Date.now()) {\n`,
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (fence.mutationCommitted === true) {\n      throwMergeFenceRecoveryRequired(uid);\n    }\n    if (Number(fence.leaseExpiresAtMs || 0) > Date.now()) {\n`,
    'registration checks mutated merge fence',
  );
  source = replaceInSection(
    source,
    'export const acquireCodexDevMergeFence',
    'export const readAndValidateCodexDevMergeFence',
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {\n`,
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (fence.mutationCommitted === true) {\n      throwMergeFenceRecoveryRequired(uid);\n    }\n    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {\n`,
    'merge reacquisition checks mutated fence',
  );
  await write(path, source);
}

// 3. Make legacy private actor markers diagnostic-only in Firestore enforcement.
{
  const path = 'firestore.rules';
  let source = await read(path);
  source = replaceOnce(
    source,
    `    function isTestActorUid(uid) {\n      let path = /databases/$(database)/documents/users/$(uid);\n      return exists(path)\n        && get(path).data.keys().hasAll(['isDevTestUser', 'devActor'])\n        && get(path).data.isDevTestUser == true\n        && get(path).data.devActor == 'codex';\n    }\n`,
    `    function isTestActorUid(uid) {\n      return isKnownCodexProductionDeniedUid(uid);\n    }\n`,
    'Firestore test actor identity source',
  );
  await write(path, source);
}

// 4. Add a reusable transaction helper for support-reset message deletion pages.
{
  const path = 'functions/supportResetIsolation.js';
  const content = `export const deleteSupportResetMessagesPageAtomically = async ({\n  db,\n  actorUid,\n  threadRef,\n  expectedUserUid,\n  isModeratorRequest,\n  messageDocs,\n  keptIntroRef = null,\n  introTexts,\n  isKnownCodexDevActorUid,\n}) => db.runTransaction(async (transaction) => {\n  if (await isKnownCodexDevActorUid({ db, uid: actorUid, transaction })) {\n    const error = new Error('Codex Dev support traffic is isolated.');\n    error.status = 403;\n    throw error;\n  }\n\n  const [freshThreadSnap, ...freshMessageSnaps] = await Promise.all([\n    transaction.get(threadRef),\n    ...messageDocs.map((docSnap) => transaction.get(docSnap.ref)),\n  ]);\n\n  if (!freshThreadSnap.exists) {\n    const error = new Error('Thread not found');\n    error.status = 404;\n    throw error;\n  }\n  const freshThreadData = freshThreadSnap.data() || {};\n  if (freshThreadData?.type !== 'support' || freshThreadData?.userUid !== expectedUserUid) {\n    const error = new Error('Support thread changed during reset');\n    error.status = 409;\n    throw error;\n  }\n  if (freshThreadData.userUid !== actorUid && !isModeratorRequest) {\n    const error = new Error('Not authorized to reset this support thread');\n    error.status = 403;\n    throw error;\n  }\n\n  let nextKeptIntroRef = keptIntroRef;\n  const deleteRefs = [];\n  for (const freshSnap of freshMessageSnaps) {\n    if (!freshSnap.exists) continue;\n    const data = freshSnap.data() || {};\n    const isSystemIntro = data?.senderRole === 'system' && introTexts.includes(data?.text || '');\n    if (isSystemIntro) {\n      if (!nextKeptIntroRef) {\n        nextKeptIntroRef = freshSnap.ref;\n        continue;\n      }\n      if (nextKeptIntroRef.path === freshSnap.ref.path) continue;\n    }\n    deleteRefs.push(freshSnap.ref);\n  }\n\n  deleteRefs.forEach((ref) => transaction.delete(ref));\n  return {\n    deletesInRound: deleteRefs.length,\n    keptIntroRef: nextKeptIntroRef,\n  };\n});\n`;
  await write(path, content);
}

// 5. Route each support-reset deletion page through the authoritative transaction helper.
{
  const path = 'functions/index.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "import { runUserModerationActionMutation } from './userModerationActionIsolation.js';\n",
    "import { runUserModerationActionMutation } from './userModerationActionIsolation.js';\nimport { deleteSupportResetMessagesPageAtomically } from './supportResetIsolation.js';\n",
    'support reset isolation import',
  );
  source = replaceInSection(
    source,
    'export const resetSupportThread',
    'export const sendDmMessage',
    `    const messagesRef = threadRef.collection('messages');\n    let keptIntroRef = null;\n    let hasMoreMessages = true;\n    while (hasMoreMessages) {\n      const snapshot = await messagesRef.limit(400).get();\n      if (snapshot.empty) {\n        hasMoreMessages = false;\n        continue;\n      }\n      const batch = db.batch();\n      let deletesInRound = 0;\n      snapshot.docs.forEach((docSnap) => {\n        const data = docSnap.data() || {};\n        const isSystemIntro = data?.senderRole === 'system' && SUPPORT_INTRO_TEXTS.includes(data?.text || '');\n        if (isSystemIntro) {\n          if (!keptIntroRef) {\n            keptIntroRef = docSnap.ref;\n            return;\n          }\n          if (keptIntroRef.path === docSnap.ref.path) {\n            return;\n          }\n        }\n        batch.delete(docSnap.ref);\n        deletesInRound += 1;\n      });\n      if (deletesInRound > 0) {\n        await batch.commit();\n      }\n      hasMoreMessages = deletesInRound > 0 && snapshot.size === 400;\n    }\n`,
    `    const messagesRef = threadRef.collection('messages');\n    let keptIntroRef = null;\n    let hasMoreMessages = true;\n    while (hasMoreMessages) {\n      const snapshot = await messagesRef.limit(400).get();\n      if (snapshot.empty) {\n        hasMoreMessages = false;\n        continue;\n      }\n      const pageResult = await deleteSupportResetMessagesPageAtomically({\n        db,\n        actorUid: decoded.uid,\n        threadRef,\n        expectedUserUid: userUid,\n        isModeratorRequest,\n        messageDocs: snapshot.docs,\n        keptIntroRef,\n        introTexts: SUPPORT_INTRO_TEXTS,\n        isKnownCodexDevActorUid,\n      });\n      keptIntroRef = pageResult.keptIntroRef || keptIntroRef;\n      hasMoreMessages = pageResult.deletesInRound > 0 && snapshot.size === 400;\n    }\n`,
    'support reset guarded deletion loop',
  );
  await write(path, source);
}

// 6. Add focused isolation regression coverage.
{
  const path = 'tests/codexDevIsolation.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    "import { runUserModerationActionMutation } from '../functions/userModerationActionIsolation.js';\n",
    "import { runUserModerationActionMutation } from '../functions/userModerationActionIsolation.js';\nimport { deleteSupportResetMessagesPageAtomically } from '../functions/supportResetIsolation.js';\n",
    'support reset test import',
  );

  const newTests = `\ntest('mutated merge fence remains a recovery blocker after lease expiry', async () => {\n  const nowMs = Date.now();\n  const docs = new Map([\n    ['codexDevActorMergeFences/partial-expired', {\n      uid: 'partial-expired', token: 'partial-token', mutationCommitted: true, leaseExpiresAtMs: nowMs - 1,\n    }],\n  ]);\n  const refFor = (path) => ({ path, get: async () => ({\n    exists: docs.has(path), data: () => docs.get(path),\n  }) });\n  const db = {\n    collection: (collection) => ({ doc: (uid) => refFor(\`${'${collection}'}/\${uid}\`) }),\n    runTransaction: async (callback) => callback({\n      get: (ref) => ref.get(),\n      set: (ref, data, options) => docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) || {} : {}), ...data }),\n      delete: (ref) => docs.delete(ref.path),\n    }),\n  };\n\n  await assert.rejects(\n    ensureCodexDevActorRegistered({ db, uid: 'partial-expired' }),\n    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false,\n  );\n  assert.equal(docs.has('codexDevActorRegistry/partial-expired'), false);\n  await assert.rejects(\n    acquireCodexDevMergeFence({ db, uid: 'partial-expired', token: 'new-token', nowMs }),\n    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false,\n  );\n  assert.equal(docs.get('codexDevActorMergeFences/partial-expired')?.token, 'partial-token',\n    'an expired partial-merge fence cannot be overwritten by a new merge');\n});\n\ntest('support reset message deletion retries into quarantine with zero committed deletes', async () => {\n  const docs = new Map([\n    ['threads/support_racing', { type: 'support', userUid: 'racing-support-user' }],\n    ['threads/support_racing/messages/intro', { senderRole: 'system', text: 'intro' }],\n    ['threads/support_racing/messages/user-message', { senderRole: 'user', text: 'hello' }],\n  ]);\n  const refFor = (path) => ({ path });\n  const snapshotFor = (ref) => ({\n    exists: docs.has(ref.path),\n    ref,\n    data: () => docs.get(ref.path),\n  });\n  let attempts = 0;\n  const db = {\n    collection: (collection) => ({ doc: (uid) => refFor(\`${'${collection}'}/\${uid}\`) }),\n    runTransaction: async (callback) => {\n      const runAttempt = async () => {\n        const pendingDeletes = [];\n        attempts += 1;\n        const result = await callback({\n          get: async (ref) => snapshotFor(ref),\n          delete: (ref) => pendingDeletes.push(ref.path),\n        });\n        return { result, pendingDeletes };\n      };\n      const first = await runAttempt();\n      assert.deepEqual(first.pendingDeletes, ['threads/support_racing/messages/user-message']);\n      docs.set('codexDevActorRegistry/racing-support-user', { productionDenyOnly: true });\n      // Model Firestore retrying because the registry document read by attempt 1 changed before commit.\n      // The queued deletes from attempt 1 are discarded and the retried callback must deny before writes.\n      return runAttempt();\n    },\n  };\n\n  const threadRef = refFor('threads/support_racing');\n  const messageDocs = [\n    { ref: refFor('threads/support_racing/messages/intro') },\n    { ref: refFor('threads/support_racing/messages/user-message') },\n  ];\n  await assert.rejects(\n    deleteSupportResetMessagesPageAtomically({\n      db,\n      actorUid: 'racing-support-user',\n      threadRef,\n      expectedUserUid: 'racing-support-user',\n      isModeratorRequest: false,\n      messageDocs,\n      introTexts: ['intro'],\n      isKnownCodexDevActorUid,\n    }),\n    (error) => error.status === 403,\n  );\n  assert.equal(attempts, 2);\n  assert.equal(docs.has('threads/support_racing/messages/intro'), true);\n  assert.equal(docs.has('threads/support_racing/messages/user-message'), true,\n    'the conflicted first attempt cannot commit a production-history deletion');\n});\n\ntest('ordinary support reset page keeps one intro and commits only intended deletes', async () => {\n  const docs = new Map([\n    ['threads/support_ordinary', { type: 'support', userUid: 'ordinary-support-user' }],\n    ['threads/support_ordinary/messages/intro-a', { senderRole: 'system', text: 'intro' }],\n    ['threads/support_ordinary/messages/intro-b', { senderRole: 'system', text: 'intro' }],\n    ['threads/support_ordinary/messages/user-message', { senderRole: 'user', text: 'hello' }],\n  ]);\n  const refFor = (path) => ({ path });\n  const snapshotFor = (ref) => ({ exists: docs.has(ref.path), ref, data: () => docs.get(ref.path) });\n  const db = {\n    collection: (collection) => ({ doc: (uid) => refFor(\`${'${collection}'}/\${uid}\`) }),\n    runTransaction: async (callback) => {\n      const pendingDeletes = [];\n      const result = await callback({\n        get: async (ref) => snapshotFor(ref),\n        delete: (ref) => pendingDeletes.push(ref.path),\n      });\n      pendingDeletes.forEach((path) => docs.delete(path));\n      return result;\n    },\n  };\n  const result = await deleteSupportResetMessagesPageAtomically({\n    db,\n    actorUid: 'ordinary-support-user',\n    threadRef: refFor('threads/support_ordinary'),\n    expectedUserUid: 'ordinary-support-user',\n    isModeratorRequest: false,\n    messageDocs: [\n      { ref: refFor('threads/support_ordinary/messages/intro-a') },\n      { ref: refFor('threads/support_ordinary/messages/intro-b') },\n      { ref: refFor('threads/support_ordinary/messages/user-message') },\n    ],\n    introTexts: ['intro'],\n    isKnownCodexDevActorUid,\n  });\n  assert.equal(result.deletesInRound, 2);\n  assert.equal(result.keptIntroRef?.path, 'threads/support_ordinary/messages/intro-a');\n  assert.equal(docs.has('threads/support_ordinary/messages/intro-a'), true);\n  assert.equal(docs.has('threads/support_ordinary/messages/intro-b'), false);\n  assert.equal(docs.has('threads/support_ordinary/messages/user-message'), false);\n});\n\ntest('Didit claim refresh preserves only the strict current Codex claim pair', async () => {\n  const source = await fs.readFile(new URL('../functions/didit.js', import.meta.url), 'utf8');\n  assert.match(source, /CODEX_DEV_ACTOR, hasCodexDevClaim, isCodexDevUid/);\n  const start = source.indexOf('if (isApprovedAdult || shouldClearAdultVerification)');\n  const end = source.indexOf('const existingPersistedStatus', start);\n  const claimsUpdate = source.slice(start, end);\n  assert.match(claimsUpdate, /const existingClaims = \(await admin\.auth\(\)\.getUser\(uid\)\)\.customClaims \|\| \{\}/);\n  assert.match(claimsUpdate, /isCodexDevUid\(uid\) && hasCodexDevClaim\(existingClaims\)/);\n  assert.match(claimsUpdate, /\{ devCodex: true, devActor: CODEX_DEV_ACTOR \}/);\n  assert.ok(claimsUpdate.indexOf('...claimsToPreserve') < claimsUpdate.indexOf('idvVerified: isApprovedAdult'));\n});\n\ntest('Firestore test actor enforcement never derives identity from private profile markers', async () => {\n  const rules = await fs.readFile(new URL('../firestore.rules', import.meta.url), 'utf8');\n  const start = rules.indexOf('function isTestActorUid(uid)');\n  const end = rules.indexOf('function isVerifiedOrDev()', start);\n  const helper = rules.slice(start, end);\n  assert.match(helper, /return isKnownCodexProductionDeniedUid\(uid\);/);\n  assert.doesNotMatch(helper, /isDevTestUser|devActor|get\(path\)/);\n});\n`;

  source = replaceOnce(
    source,
    "test('account lifecycle fence blocks registration through Auth deletion and releases token-safely', async () => {",
    `${newTests}\ntest('account lifecycle fence blocks registration through Auth deletion and releases token-safely', async () => {`,
    'focused holistic isolation tests',
  );
  await write(path, source);
}

// 7. Add emulator coverage proving spoofable legacy markers no longer quarantine ordinary users.
{
  const path = 'tests/firestore.publicUsers.rules.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `      await setDoc(doc(db, 'users', 'codex-dev-user'), {\n        uid: 'codex-dev-user',\n        onboardingComplete: true,\n        onboardingStep: 5,\n        isDevTestUser: true,\n        devActor: 'codex',\n        roles: ['agency'],\n      });\n      for (const [targetUid, agencyUid] of [\n`,
    `      await setDoc(doc(db, 'users', 'codex-dev-user'), {\n        uid: 'codex-dev-user',\n        onboardingComplete: true,\n        onboardingStep: 5,\n        isDevTestUser: true,\n        devActor: 'codex',\n        roles: ['agency'],\n      });\n      await setDoc(doc(db, 'users', 'legacy_marker_ordinary'), {\n        uid: 'legacy_marker_ordinary',\n        onboardingComplete: true,\n        onboardingStep: 5,\n        isDevTestUser: true,\n        devActor: 'codex',\n        ageVerified: true,\n        isAdult: true,\n      });\n      await setDoc(doc(db, 'publicUsers', 'legacy_marker_ordinary'), {\n        onboardingComplete: true,\n        uid: 'legacy_marker_ordinary',\n        username: 'legacymarkerordinary',\n        displayName: 'Legacy Marker Ordinary',\n        displayNameLower: 'legacy marker ordinary',\n        updatedAt: new Date(),\n      });\n      for (const [targetUid, agencyUid] of [\n`,
    'legacy marker ordinary fixture',
  );

  source = replaceOnce(
    source,
    `    await assertFails(setDoc(doc(codexDevDb, 'users', 'codex-dev-user', 'following', ownerUid), {\n      targetUid: ownerUid,\n      createdAt: serverTimestamp(),\n    }));\n`,
    `    await assertFails(setDoc(doc(codexDevDb, 'users', 'codex-dev-user', 'following', ownerUid), {\n      targetUid: ownerUid,\n      createdAt: serverTimestamp(),\n    }));\n    await assertSucceeds(setDoc(doc(ownerDb, 'threads', 'dm_owner_legacy_marker_ordinary'), {\n      type: 'dm',\n      participantUids: [ownerUid, 'legacy_marker_ordinary'],\n      participants: [ownerUid, 'legacy_marker_ordinary'],\n      dmKey: 'legacy_marker_ordinary_owner_1',\n      createdAt: serverTimestamp(),\n      updatedAt: serverTimestamp(),\n    }));\n    await assertSucceeds(getDoc(doc(ownerDb, 'threads', 'dm_owner_legacy_marker_ordinary')));\n    await assertSucceeds(setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'legacy_marker_ordinary'), {\n      targetUid: 'legacy_marker_ordinary',\n      createdAt: serverTimestamp(),\n    }));\n`,
    'legacy marker ordinary DM/follow behavior',
  );
  await write(path, source);
}

await fs.unlink(new URL(import.meta.url));
console.log('✅ Applied the four final holistic Codex isolation blockers and removed the temporary patcher.');
