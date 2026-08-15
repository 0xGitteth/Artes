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

// 1) Didit must preserve unrelated custom claims and restore the strict canonical Codex pair.
{
  const path = 'functions/didit.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "import { FieldValue, getFirestore } from 'firebase-admin/firestore';\n",
    "import { FieldValue, getFirestore } from 'firebase-admin/firestore';\nimport { buildDiditCustomClaims } from './diditCustomClaims.js';\n",
    'Didit custom claim helper import',
  );
  source = replaceOnce(
    source,
    `      const existingClaims = shouldClearAdultVerification\n        ? (await admin.auth().getUser(uid)).customClaims || {}\n        : {};\n      await admin.auth().setCustomUserClaims(uid, {\n        ...existingClaims,\n        idvVerified: isApprovedAdult,\n        isAdult: isApprovedAdult && isAdult === true,\n      });\n`,
    `      const existingClaims = (await admin.auth().getUser(uid)).customClaims || {};\n      await admin.auth().setCustomUserClaims(uid, buildDiditCustomClaims({\n        uid,\n        existingClaims,\n        isApprovedAdult,\n        isAdult,\n      }));\n`,
    'Didit custom claim refresh',
  );
  await write(path, source);

  await write('functions/diditCustomClaims.js', `import { CODEX_DEV_ACTOR, isCodexDevUid } from './codexDevIdentity.js';\n\nexport const buildDiditCustomClaims = ({\n  uid,\n  existingClaims = {},\n  isApprovedAdult,\n  isAdult,\n  env = process.env,\n}) => ({\n  ...(existingClaims || {}),\n  ...(isCodexDevUid(uid, env) ? { devCodex: true, devActor: CODEX_DEV_ACTOR } : {}),\n  idvVerified: isApprovedAdult === true,\n  isAdult: isApprovedAdult === true && isAdult === true,\n});\n`);
}

// 2) A merge fence that has committed production mutations must remain a recovery blocker after lease expiry.
// Also make lifecycle fences renewable so a multi-page support reset can serialize registration for its full duration.
{
  const path = 'functions/codexDevActorRegistry.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    `const MERGE_FENCE_LEASE_MS = 30 * 60 * 1000;\nconst LIFECYCLE_FENCE_LEASE_MS = 5 * 60 * 1000;\n`,
    `const MERGE_FENCE_LEASE_MS = 30 * 60 * 1000;\nconst LIFECYCLE_FENCE_LEASE_MS = 5 * 60 * 1000;\n\nconst throwMergeFenceRecoveryRequired = (uid) => {\n  const error = new Error(\`Codex actor registration is blocked because contributor merge mutations already committed for \${uid}; operator recovery is required before clearing the fence.\`);\n  error.code = 'codex-merge-fence-recovery-required';\n  error.status = 409;\n  error.retryable = false;\n  throw error;\n};\n`,
    'merge recovery blocker helper',
  );
  source = replaceInSection(
    source,
    'export const ensureCodexDevActorRegistered',
    'export const acquireCodexDevLifecycleFence',
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (Number(fence.leaseExpiresAtMs || 0) > Date.now()) {\n`,
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (fence.mutationCommitted === true) {\n      throwMergeFenceRecoveryRequired(uid);\n    }\n    if (Number(fence.leaseExpiresAtMs || 0) > Date.now()) {\n`,
    'registration blocks mutated merge fence',
  );
  source = replaceInSection(
    source,
    'export const acquireCodexDevMergeFence',
    'export const readAndValidateCodexDevMergeFence',
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {\n`,
    `    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};\n    if (fence.mutationCommitted === true) {\n      throwMergeFenceRecoveryRequired(uid);\n    }\n    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {\n`,
    'merge reacquisition blocks mutated fence',
  );
  source = replaceInSection(
    source,
    'export const readAndValidateCodexDevLifecycleFence',
    'export const releaseCodexDevLifecycleFence',
    `  if (registrySnapshot.exists\n    || isCodexDevUid(uid)\n    || fence.token !== token\n    || fence.operation !== operation\n    || Number(fence.leaseExpiresAtMs || 0) <= nowMs) {\n    const error = new Error('Account lifecycle fence is unavailable; retry safely.');\n    error.status = 409;\n    throw error;\n  }\n};\n\n`,
    `  if (registrySnapshot.exists\n    || isCodexDevUid(uid)\n    || fence.token !== token\n    || fence.operation !== operation\n    || Number(fence.leaseExpiresAtMs || 0) <= nowMs) {\n    const error = new Error('Account lifecycle fence is unavailable; retry safely.');\n    error.status = 409;\n    throw error;\n  }\n  return { fenceRef, nowMs };\n};\n\nexport const queueCodexDevLifecycleFenceRenewal = ({ transaction, validation }) => {\n  if (!validation) return;\n  const { fenceRef, nowMs } = validation;\n  transaction.set(fenceRef, {\n    leaseExpiresAtMs: nowMs + LIFECYCLE_FENCE_LEASE_MS,\n    updatedAt: new Date(nowMs),\n  }, { merge: true });\n};\n\n`,
    'lifecycle fence renewal helper',
  );
  await write(path, source);
}

// 3) Legacy private profile markers are diagnostic-only. Rules may use only trusted claims for self
// and the server-owned registry for arbitrary current/historical actor UIDs.
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

// 4) Support reset uses an actor lifecycle fence around every destructive page and the final reset write.
{
  await write('functions/supportResetIsolation.js', `import {\n  queueCodexDevLifecycleFenceRenewal,\n  readAndValidateCodexDevLifecycleFence,\n} from './codexDevActorRegistry.js';\n\nexport const deleteSupportResetMessagesPageAtomically = async ({\n  db,\n  actorUid,\n  fenceToken,\n  threadRef,\n  expectedUserUid,\n  isModeratorRequest,\n  messageDocs,\n  keptIntroRef = null,\n  introTexts,\n  nowMs = Date.now(),\n}) => db.runTransaction(async (transaction) => {\n  const lifecycleValidation = await readAndValidateCodexDevLifecycleFence({\n    db,\n    uid: actorUid,\n    token: fenceToken,\n    transaction,\n    operation: 'resetSupportThread',\n    nowMs,\n  });\n\n  const [freshThreadSnap, ...freshMessageSnaps] = await Promise.all([\n    transaction.get(threadRef),\n    ...messageDocs.map((docSnap) => transaction.get(docSnap.ref)),\n  ]);\n\n  if (!freshThreadSnap.exists) {\n    const error = new Error('Thread not found');\n    error.status = 404;\n    throw error;\n  }\n  const freshThreadData = freshThreadSnap.data() || {};\n  if (freshThreadData?.type !== 'support' || freshThreadData?.userUid !== expectedUserUid) {\n    const error = new Error('Support thread changed during reset');\n    error.status = 409;\n    throw error;\n  }\n  if (freshThreadData.userUid !== actorUid && !isModeratorRequest) {\n    const error = new Error('Not authorized to reset this support thread');\n    error.status = 403;\n    throw error;\n  }\n\n  let nextKeptIntroRef = keptIntroRef;\n  const deleteRefs = [];\n  for (const freshSnap of freshMessageSnaps) {\n    if (!freshSnap.exists) continue;\n    const data = freshSnap.data() || {};\n    const isSystemIntro = data?.senderRole === 'system' && introTexts.includes(data?.text || '');\n    if (isSystemIntro) {\n      if (!nextKeptIntroRef) {\n        nextKeptIntroRef = freshSnap.ref;\n        continue;\n      }\n      if (nextKeptIntroRef.path === freshSnap.ref.path) continue;\n    }\n    deleteRefs.push(freshSnap.ref);\n  }\n\n  queueCodexDevLifecycleFenceRenewal({ transaction, validation: lifecycleValidation });\n  deleteRefs.forEach((ref) => transaction.delete(ref));\n  return { deletesInRound: deleteRefs.length, keptIntroRef: nextKeptIntroRef };\n});\n`);

  const path = 'functions/index.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "import { runUserModerationActionMutation } from './userModerationActionIsolation.js';\n",
    "import { runUserModerationActionMutation } from './userModerationActionIsolation.js';\nimport { deleteSupportResetMessagesPageAtomically } from './supportResetIsolation.js';\n",
    'support reset helper import',
  );
  source = replaceOnce(
    source,
    `  acquireCodexDevMergeFence,\n  ensureCodexDevActorRegistered,\n`,
    `  acquireCodexDevLifecycleFence,\n  acquireCodexDevMergeFence,\n  ensureCodexDevActorRegistered,\n`,
    'lifecycle acquire import',
  );
  source = replaceOnce(
    source,
    `  queueCodexDevMergeFenceRenewal,\n  readAndValidateCodexDevMergeFence,\n  releaseCodexDevMergeFence,\n`,
    `  queueCodexDevMergeFenceRenewal,\n  readAndValidateCodexDevLifecycleFence,\n  readAndValidateCodexDevMergeFence,\n  releaseCodexDevLifecycleFence,\n  releaseCodexDevMergeFence,\n`,
    'lifecycle validation imports',
  );

  const resetStart = source.indexOf('export const resetSupportThread');
  const resetEnd = source.indexOf('export const sendDmMessage', resetStart);
  if (resetStart === -1 || resetEnd === -1) throw new Error('Missing resetSupportThread section');
  let section = source.slice(resetStart, resetEnd);

  section = replaceOnce(
    section,
    `    const messagesRef = threadRef.collection('messages');\n    let keptIntroRef = null;\n`,
    `    const supportResetFenceToken = crypto.randomUUID();\n    await acquireCodexDevLifecycleFence({\n      db, uid: decoded.uid, token: supportResetFenceToken, operation: 'resetSupportThread',\n    });\n    try {\n    const messagesRef = threadRef.collection('messages');\n    let keptIntroRef = null;\n`,
    'support reset lifecycle fence acquisition',
  );

  section = replaceOnce(
    section,
    `    while (hasMoreMessages) {\n      const snapshot = await messagesRef.limit(400).get();\n      if (snapshot.empty) {\n        hasMoreMessages = false;\n        continue;\n      }\n      const batch = db.batch();\n      let deletesInRound = 0;\n      snapshot.docs.forEach((docSnap) => {\n        const data = docSnap.data() || {};\n        const isSystemIntro = data?.senderRole === 'system' && SUPPORT_INTRO_TEXTS.includes(data?.text || '');\n        if (isSystemIntro) {\n          if (!keptIntroRef) {\n            keptIntroRef = docSnap.ref;\n            return;\n          }\n          if (keptIntroRef.path === docSnap.ref.path) {\n            return;\n          }\n        }\n        batch.delete(docSnap.ref);\n        deletesInRound += 1;\n      });\n      if (deletesInRound > 0) {\n        await batch.commit();\n      }\n      hasMoreMessages = deletesInRound > 0 && snapshot.size === 400;\n    }\n`,
    `    while (hasMoreMessages) {\n      const snapshot = await messagesRef.limit(400).get();\n      if (snapshot.empty) {\n        hasMoreMessages = false;\n        continue;\n      }\n      const pageResult = await deleteSupportResetMessagesPageAtomically({\n        db,\n        actorUid: decoded.uid,\n        fenceToken: supportResetFenceToken,\n        threadRef,\n        expectedUserUid: userUid,\n        isModeratorRequest,\n        messageDocs: snapshot.docs,\n        keptIntroRef,\n        introTexts: SUPPORT_INTRO_TEXTS,\n      });\n      keptIntroRef = pageResult.keptIntroRef || keptIntroRef;\n      hasMoreMessages = pageResult.deletesInRound > 0 && snapshot.size === 400;\n    }\n`,
    'support reset guarded deletion loop',
  );

  section = replaceOnce(
    section,
    `    await db.runTransaction(async (transaction) => {\n      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {\n`,
    `    await db.runTransaction(async (transaction) => {\n      await readAndValidateCodexDevLifecycleFence({\n        db,\n        uid: decoded.uid,\n        token: supportResetFenceToken,\n        transaction,\n        operation: 'resetSupportThread',\n      });\n      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {\n`,
    'support reset final lifecycle validation',
  );

  const successIndex = section.indexOf('    res.status(200)', section.indexOf('supportResetFenceToken'));
  if (successIndex === -1) throw new Error('Missing resetSupportThread success response');
  section = section.slice(0, successIndex)
    + `    } finally {\n      await releaseCodexDevLifecycleFence({ db, uid: decoded.uid, token: supportResetFenceToken });\n    }\n`
    + section.slice(successIndex);
  source = source.slice(0, resetStart) + section + source.slice(resetEnd);
  await write(path, source);
}

// Existing isolation test expected the old active-lease error for a partial merge. The new state is intentionally stronger.
{
  const path = 'tests/codexDevIsolation.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `(error) => error.code === 'codex-merge-fence-active',\n  );\n  await releaseCodexDevMergeFence({ db, uid: 'partial-merge', token: 'token-b' });\n`,
    `(error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false,\n  );\n  await releaseCodexDevMergeFence({ db, uid: 'partial-merge', token: 'token-b' });\n`,
    'partial merge recovery expectation',
  );
  await write(path, source);
}

// The current canonical actor is always registered server-side before profile mutation; mirror that invariant in rule tests.
{
  const path = 'tests/firestore.publicUsers.rules.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    `      await setDoc(doc(db, 'codexDevActorRegistry', 'retired-codex'), {\n        uid: 'retired-codex', actor: 'codex', productionDenyOnly: true, registeredAt: new Date(),\n      });\n`,
    `      await setDoc(doc(db, 'codexDevActorRegistry', 'codex-dev-user'), {\n        uid: 'codex-dev-user', actor: 'codex', productionDenyOnly: true, registeredAt: new Date(),\n      });\n      await setDoc(doc(db, 'codexDevActorRegistry', 'retired-codex'), {\n        uid: 'retired-codex', actor: 'codex', productionDenyOnly: true, registeredAt: new Date(),\n      });\n`,
    'current canonical actor registry seed',
  );
  await write(path, source);
}

// Focused executable coverage for the four holistic findings.
await write('tests/finalHolisticIsolation.test.mjs', `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { buildDiditCustomClaims } from '../functions/diditCustomClaims.js';\nimport {\n  acquireCodexDevLifecycleFence,\n  acquireCodexDevMergeFence,\n  ensureCodexDevActorRegistered,\n  releaseCodexDevLifecycleFence,\n} from '../functions/codexDevActorRegistry.js';\nimport { deleteSupportResetMessagesPageAtomically } from '../functions/supportResetIsolation.js';\n\nconst createMemoryDb = (initial = []) => {\n  const docs = new Map(initial);\n  const refFor = (path) => ({ path, get: async () => ({\n    exists: docs.has(path), ref: refFor(path), data: () => docs.get(path),\n  }) });\n  const db = {\n    docs,\n    collection: (collection) => ({ doc: (uid) => refFor(\`${'${collection}'}/\${uid}\`) }),\n    runTransaction: async (callback) => {\n      const pending = [];\n      const transaction = {\n        get: async (ref) => ({ exists: docs.has(ref.path), ref, data: () => docs.get(ref.path) }),\n        set: (ref, data, options) => pending.push(() => docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) || {} : {}), ...data })),\n        delete: (ref) => pending.push(() => docs.delete(ref.path)),\n      };\n      const result = await callback(transaction);\n      pending.forEach((apply) => apply());\n      return result;\n    },\n  };\n  return { db, docs, refFor };\n};\n\ntest('Didit preserves unrelated claims and restores the canonical Codex claim pair', () => {\n  const env = { CODEX_DEV_UID: 'canonical-codex' };\n  assert.deepEqual(buildDiditCustomClaims({\n    uid: 'canonical-codex', existingClaims: { moderator: true }, isApprovedAdult: true, isAdult: true, env,\n  }), { moderator: true, devCodex: true, devActor: 'codex', idvVerified: true, isAdult: true });\n  assert.deepEqual(buildDiditCustomClaims({\n    uid: 'ordinary', existingClaims: { moderator: true }, isApprovedAdult: true, isAdult: true, env,\n  }), { moderator: true, idvVerified: true, isAdult: true });\n});\n\ntest('mutated merge fences remain recovery blockers after lease expiry and cannot be reacquired', async () => {\n  const nowMs = Date.now();\n  const { db, docs } = createMemoryDb([[\n    'codexDevActorMergeFences/partial',\n    { uid: 'partial', token: 'old-token', mutationCommitted: true, leaseExpiresAtMs: nowMs - 1 },\n  ]]);\n  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'partial' }),\n    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false);\n  await assert.rejects(acquireCodexDevMergeFence({ db, uid: 'partial', token: 'new-token', nowMs }),\n    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false);\n  assert.equal(docs.get('codexDevActorMergeFences/partial').token, 'old-token');\n  assert.equal(docs.has('codexDevActorRegistry/partial'), false);\n});\n\ntest('support reset lifecycle fence blocks actor registration across destructive message pages', async () => {\n  const nowMs = Date.now();\n  const { db, docs, refFor } = createMemoryDb([\n    ['threads/support_owner', { type: 'support', userUid: 'owner' }],\n    ['threads/support_owner/messages/intro', { senderRole: 'system', text: 'intro' }],\n    ['threads/support_owner/messages/user', { senderRole: 'user', text: 'hello' }],\n  ]);\n  await acquireCodexDevLifecycleFence({\n    db, uid: 'owner', token: 'reset-token', operation: 'resetSupportThread', nowMs,\n  });\n  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'owner' }),\n    (error) => error.code === 'codex-lifecycle-fence-active' && error.retryable === true);\n\n  const result = await deleteSupportResetMessagesPageAtomically({\n    db, actorUid: 'owner', fenceToken: 'reset-token', threadRef: refFor('threads/support_owner'),\n    expectedUserUid: 'owner', isModeratorRequest: false,\n    messageDocs: [\n      { ref: refFor('threads/support_owner/messages/intro') },\n      { ref: refFor('threads/support_owner/messages/user') },\n    ],\n    introTexts: ['intro'], nowMs: nowMs + 1,\n  });\n  assert.equal(result.deletesInRound, 1);\n  assert.equal(docs.has('threads/support_owner/messages/intro'), true);\n  assert.equal(docs.has('threads/support_owner/messages/user'), false);\n  assert.ok(docs.get('codexDevActorLifecycleFences/owner').leaseExpiresAtMs > nowMs);\n\n  await releaseCodexDevLifecycleFence({ db, uid: 'owner', token: 'reset-token' });\n  assert.equal(await ensureCodexDevActorRegistered({ db, uid: 'owner' }), true);\n});\n`);

await write('tests/firestore.codexMarkerIsolation.rules.test.mjs', `import fs from 'node:fs/promises';\nimport { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';\nimport { doc, serverTimestamp, setDoc } from 'firebase/firestore';\n\nconst PROJECT_ID = 'artes-codex-marker-rules-test';\nconst rules = await fs.readFile('firestore.rules', 'utf8');\nconst env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });\n\ntry {\n  await env.withSecurityRulesDisabled(async (context) => {\n    const db = context.firestore();\n    await setDoc(doc(db, 'users', 'spoofed-marker'), {\n      uid: 'spoofed-marker', onboardingComplete: true, isDevTestUser: true, devActor: 'codex',\n    });\n    await setDoc(doc(db, 'codexDevActorRegistry', 'registered-codex'), {\n      uid: 'registered-codex', actor: 'codex', productionDenyOnly: true,\n    });\n  });\n\n  const ownerDb = env.authenticatedContext('owner', { email: 'owner@example.test' }).firestore();\n  const spoofedDb = env.authenticatedContext('spoofed-marker', { email: 'spoofed@example.test' }).firestore();\n\n  await assertSucceeds(setDoc(doc(ownerDb, 'users', 'owner', 'following', 'spoofed-marker'), {\n    targetUid: 'spoofed-marker', createdAt: serverTimestamp(),\n  }));\n  await assertSucceeds(setDoc(doc(spoofedDb, 'users', 'spoofed-marker', 'following', 'owner'), {\n    targetUid: 'owner', createdAt: serverTimestamp(),\n  }));\n  await assertSucceeds(setDoc(doc(ownerDb, 'threads', 'owner_spoofed'), {\n    type: 'dm', participantUids: ['owner', 'spoofed-marker'], dmKey: 'owner_spoofed',\n    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),\n  }));\n\n  await assertFails(setDoc(doc(ownerDb, 'users', 'owner', 'following', 'registered-codex'), {\n    targetUid: 'registered-codex', createdAt: serverTimestamp(),\n  }));\n  await assertFails(setDoc(doc(ownerDb, 'threads', 'owner_registered_codex'), {\n    type: 'dm', participantUids: ['owner', 'registered-codex'], dmKey: 'owner_registered_codex',\n    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),\n  }));\n  console.log('PASS firestore.codexMarkerIsolation.rules.test');\n} finally {\n  await env.cleanup();\n}\n`);

// Wire focused tests into the existing commands so future local/CI validation cannot omit them.
{
  const path = 'package.json';
  let source = await read(path);
  source = replaceOnce(
    source,
    `\"test:rules\": \"firebase emulators:exec --only firestore,storage \\\"node tests/firestore.publicUsers.rules.test.mjs && node tests/storage.profileImages.rules.test.mjs && node tests/storage.uploads.rules.test.mjs\\\"\",`,
    `\"test:rules\": \"firebase emulators:exec --only firestore,storage \\\"node tests/firestore.publicUsers.rules.test.mjs && node tests/firestore.codexMarkerIsolation.rules.test.mjs && node tests/storage.profileImages.rules.test.mjs && node tests/storage.uploads.rules.test.mjs\\\"\",`,
    'rules test script',
  );
  source = replaceOnce(
    source,
    `\"test:codex-dev-isolation\": \"node --test tests/codexDevIsolation.test.mjs functions/test/codexDevLogin.test.js && node tests/codexDevLegacyCleanup.test.mjs\"`,
    `\"test:codex-dev-isolation\": \"node --test tests/codexDevIsolation.test.mjs functions/test/codexDevLogin.test.js tests/finalHolisticIsolation.test.mjs && node tests/codexDevLegacyCleanup.test.mjs\"`,
    'Codex isolation test script',
  );
  await write(path, source);
}

console.log('Applied final holistic isolation fixes v2.');
