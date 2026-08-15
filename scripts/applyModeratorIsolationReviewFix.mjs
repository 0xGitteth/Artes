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

await patchFile('firestore.rules', (source) => replaceOnce(
  source,
  `    function isModerator() {\n      return request.auth != null\n        && request.auth.token.email_verified == true\n        && request.auth.token.email != null\n        && exists(/databases/$(database)/documents/config/moderation)\n        && request.auth.token.email in get(/databases/$(database)/documents/config/moderation).data.moderatorEmails;\n    }`,
  `    function isModerator() {\n      return request.auth != null\n        && !isKnownCodexProductionDenied()\n        && request.auth.token.email_verified == true\n        && request.auth.token.email != null\n        && exists(/databases/$(database)/documents/config/moderation)\n        && request.auth.token.email in get(/databases/$(database)/documents/config/moderation).data.moderatorEmails;\n    }`,
  'Firestore moderator production deny',
));

await patchFile('storage.rules', (source) => replaceOnce(
  source,
  `    function isModerator() {\n      return request.auth != null\n        && request.auth.token.email_verified == true\n        && request.auth.token.email != null\n        && firestore.exists(/databases/(default)/documents/config/moderation)\n        && request.auth.token.email in firestore.get(/databases/(default)/documents/config/moderation).data.moderatorEmails;\n    }`,
  `    function isModerator() {\n      return request.auth != null\n        && !isKnownCodexProductionDeniedUid(request.auth.uid)\n        && request.auth.token.email_verified == true\n        && request.auth.token.email != null\n        && firestore.exists(/databases/(default)/documents/config/moderation)\n        && request.auth.token.email in firestore.get(/databases/(default)/documents/config/moderation).data.moderatorEmails;\n    }`,
  'Storage moderator production deny',
));

await patchFile('functions/codexDevActorRegistry.js', (source) => {
  source = replaceOnce(
    source,
    `export const ensureCodexDevActorRegistered = async ({ db, uid, now = new Date() }) => {`,
    `export const ensureCodexDevActorRegistered = async ({ db, uid, now = new Date(), moderatorEmail = '' }) => {`,
    'registration moderator email argument',
  );
  source = replaceOnce(
    source,
    `  const moderatorLockRef = db.collection(CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION).doc(uid);\n  return db.runTransaction(async (transaction) => {\n    const [snapshot, fenceSnapshot, lifecycleFenceSnapshot, moderatorLockSnapshot] = await Promise.all([\n      transaction.get(ref),\n      transaction.get(fenceRef),\n      transaction.get(lifecycleFenceRef),\n      transaction.get(moderatorLockRef),\n    ]);`,
    `  const moderatorLockRef = db.collection(CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION).doc(uid);\n  const moderatorConfigRef = db.collection('config').doc('moderation');\n  return db.runTransaction(async (transaction) => {\n    const [snapshot, fenceSnapshot, lifecycleFenceSnapshot, moderatorLockSnapshot, moderatorConfigSnapshot] = await Promise.all([\n      transaction.get(ref),\n      transaction.get(fenceRef),\n      transaction.get(lifecycleFenceRef),\n      transaction.get(moderatorLockRef),\n      transaction.get(moderatorConfigRef),\n    ]);`,
    'registration reads moderator config transactionally',
  );
  source = replaceOnce(
    source,
    `    if (moderatorLockSnapshot.exists) {\n      const error = new Error(\`Codex actor registration is blocked because \${uid} has production moderator authorization; operator clearance is required before reuse as Codex.\`);\n      error.code = 'codex-moderator-lock-active';\n      error.status = 409;\n      error.retryable = false;\n      throw error;\n    }\n    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};`,
    `    if (moderatorLockSnapshot.exists) {\n      const error = new Error(\`Codex actor registration is blocked because \${uid} has production moderator authorization; operator clearance is required before reuse as Codex.\`);\n      error.code = 'codex-moderator-lock-active';\n      error.status = 409;\n      error.retryable = false;\n      throw error;\n    }\n    const normalizedModeratorEmail = String(moderatorEmail || '').trim().toLowerCase();\n    const moderatorConfig = moderatorConfigSnapshot.exists ? moderatorConfigSnapshot.data() || {} : {};\n    const moderatorEmails = Array.isArray(moderatorConfig.moderatorEmails)\n      ? moderatorConfig.moderatorEmails.map((email) => String(email || '').trim().toLowerCase())\n      : [];\n    if (normalizedModeratorEmail && moderatorEmails.includes(normalizedModeratorEmail)) {\n      const error = new Error(\`Codex actor registration is blocked because \${uid} is assigned production moderator access.\`);\n      error.code = 'codex-moderator-assignment-active';\n      error.status = 409;\n      error.retryable = false;\n      throw error;\n    }\n    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};`,
    'registration blocks authoritative moderator assignment',
  );
  return source;
});

await patchFile('functions/index.js', (source) => {
  source = replaceOnce(
    source,
    `export const ensureCodexDevProfileState = async (uid) => {\n  const now = FieldValue.serverTimestamp();\n  const userRef = db.collection('users').doc(uid);\n  const publicUserRef = db.collection('publicUsers').doc(uid);\n  await ensureCodexDevActorRegistered({ db, uid, now });`,
    `const getExistingAuthEmail = async (uid) => {\n  try {\n    const authUser = await admin.auth().getUser(uid);\n    return String(authUser?.email || '').trim().toLowerCase();\n  } catch (error) {\n    if (error?.code === 'auth/user-not-found') return '';\n    throw error;\n  }\n};\n\nexport const ensureCodexDevProfileState = async (uid) => {\n  const now = FieldValue.serverTimestamp();\n  const userRef = db.collection('users').doc(uid);\n  const publicUserRef = db.collection('publicUsers').doc(uid);\n  const moderatorEmail = await getExistingAuthEmail(uid);\n  await ensureCodexDevActorRegistered({ db, uid, now, moderatorEmail });`,
    'Codex establishment checks existing Auth moderator email',
  );
  return source;
});

await patchFile('tests/finalHolisticIsolation.test.mjs', (source) => {
  source += `\n\ntest('authoritative moderator assignment blocks Codex registration even before a moderator lock exists', async () => {\n  const { db, docs } = createMemoryDb([[\n    'config/moderation', { moderatorEmails: ['mod@example.test'] },\n  ]]);\n  await assert.rejects(ensureCodexDevActorRegistered({\n    db, uid: 'assigned-moderator', moderatorEmail: 'MOD@example.test',\n  }), (error) => error.code === 'codex-moderator-assignment-active' && error.retryable === false);\n  assert.equal(docs.has('codexDevActorRegistry/assigned-moderator'), false);\n});\n\ntest('Codex establishment passes the existing Auth email into transactional registration', async () => {\n  const indexSource = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');\n  assert.match(indexSource, /admin\\.auth\\(\\)\\.getUser\\(uid\\)/);\n  assert.match(indexSource, /ensureCodexDevActorRegistered\\(\\{ db, uid, now, moderatorEmail \\}\\)/);\n});\n`;
  return source;
});

await patchFile('tests/firestore.codexMarkerIsolation.rules.test.mjs', (source) => {
  source = replaceOnce(
    source,
    `  const moderatorDb = env.authenticatedContext('moderator-user', { email: 'mod@example.test', email_verified: true }).firestore();\n`,
    `  const moderatorDb = env.authenticatedContext('moderator-user', { email: 'mod@example.test', email_verified: true }).firestore();\n  const registeredCodexModeratorDb = env.authenticatedContext('registered-codex', { email: 'mod@example.test', email_verified: true }).firestore();\n  const claimedCodexModeratorDb = env.authenticatedContext('claimed-codex', {\n    email: 'mod@example.test', email_verified: true, devCodex: true, devActor: 'codex',\n  }).firestore();\n`,
    'Codex moderator rule contexts',
  );
  source = replaceOnce(
    source,
    `  if (supportSnapshot.size !== 20) throw new Error(\`Expected 20 support threads, got \${supportSnapshot.size}\`);\n\n  console.log('PASS firestore.codexMarkerIsolation.rules.test');`,
    `  if (supportSnapshot.size !== 20) throw new Error(\`Expected 20 support threads, got \${supportSnapshot.size}\`);\n  await assertFails(getDocs(query(collection(registeredCodexModeratorDb, 'threads'), where('type', '==', 'support'))));\n  await assertFails(getDocs(query(collection(claimedCodexModeratorDb, 'threads'), where('type', '==', 'support'))));\n\n  console.log('PASS firestore.codexMarkerIsolation.rules.test');`,
    'Codex moderator support queries denied',
  );
  return source;
});

console.log('Moderator isolation review fixes applied.');
