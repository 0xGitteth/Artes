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
    `export const ensureCodexDevActorRegistered = async ({ db, uid, now = new Date(), moderatorEmail = '' }) => {\n  if (!db || !uid) throw new Error('Firestore db and Codex actor UID are required.');`,
    `export const ensureCodexDevActorRegistered = async ({ db, auth, uid, now = new Date() }) => {\n  if (!db || !uid) throw new Error('Firestore db and Codex actor UID are required.');\n  if (!auth || typeof auth.getUser !== 'function') {\n    const error = new Error('Firebase Auth is required to verify Codex actor moderator assignment before registration.');\n    error.code = 'codex-registration-auth-required';\n    error.status = 500;\n    error.retryable = false;\n    throw error;\n  }\n  let authUser = null;\n  try {\n    authUser = await auth.getUser(uid);\n  } catch (error) {\n    if (error?.code !== 'auth/user-not-found') throw error;\n  }\n  const normalizedModeratorEmail = String(authUser?.email || '').trim().toLowerCase();`,
    'registration requires Firebase Auth evidence',
  );
  source = replaceOnce(
    source,
    `    const normalizedModeratorEmail = String(moderatorEmail || '').trim().toLowerCase();\n    const moderatorConfig = moderatorConfigSnapshot.exists ? moderatorConfigSnapshot.data() || {} : {};`,
    `    const moderatorConfig = moderatorConfigSnapshot.exists ? moderatorConfigSnapshot.data() || {} : {};`,
    'remove caller-supplied moderator email',
  );
  return source;
});

await patchFile('functions/index.js', (source) => {
  source = replaceOnce(
    source,
    `const getExistingAuthEmail = async (uid) => {\n  try {\n    const authUser = await admin.auth().getUser(uid);\n    return String(authUser?.email || '').trim().toLowerCase();\n  } catch (error) {\n    if (error?.code === 'auth/user-not-found') return '';\n    throw error;\n  }\n};\n\n`,
    ``,
    'remove redundant Auth email resolver',
  );
  source = replaceOnce(
    source,
    `  const moderatorEmail = await getExistingAuthEmail(uid);\n  await ensureCodexDevActorRegistered({ db, uid, now, moderatorEmail });`,
    `  await ensureCodexDevActorRegistered({ db, auth: admin.auth(), uid, now });`,
    'dev login registration supplies Auth service',
  );
  return source;
});

await patchFile('functions/scripts/reconcileCodexDevIsolation.js', (source) => {
  source = replaceOnce(
    source,
    `export const reconcileCodexDevIsolation = async ({ db, bucket = null, apply = false, env = process.env, uid = null, uidSource = null, skipStorage = false, fieldValue = null } = {}) => {`,
    `export const reconcileCodexDevIsolation = async ({ db, auth = null, bucket = null, apply = false, env = process.env, uid = null, uidSource = null, skipStorage = false, fieldValue = null } = {}) => {`,
    'reconcile accepts Auth service',
  );
  source = replaceOnce(
    source,
    `  if (apply) {\n    await ensureCodexDevActorRegistered({ db, uid: canonicalUid });\n    stats.targetUidRegistered = true;\n  }`,
    `  if (apply) {\n    await ensureCodexDevActorRegistered({ db, auth, uid: canonicalUid });\n    stats.targetUidRegistered = true;\n  }`,
    'reconcile passes Auth service',
  );
  source = replaceOnce(
    source,
    `  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');\n  const { getStorage } = await import('firebase-admin/storage');`,
    `  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');\n  const { getAuth } = await import('firebase-admin/auth');\n  const { getStorage } = await import('firebase-admin/storage');`,
    'CLI imports Firebase Auth',
  );
  source = replaceOnce(
    source,
    `  const stats = await reconcileCodexDevIsolation({ db: getFirestore(), bucket, apply: options.apply, uid: options.uid, uidSource: options.uid ? '--uid' : null, skipStorage: options.skipStorage, fieldValue: FieldValue });`,
    `  const stats = await reconcileCodexDevIsolation({ db: getFirestore(), auth: getAuth(), bucket, apply: options.apply, uid: options.uid, uidSource: options.uid ? '--uid' : null, skipStorage: options.skipStorage, fieldValue: FieldValue });`,
    'CLI passes Firebase Auth',
  );
  return source;
});

await patchFile('tests/codexDevIsolation.test.mjs', (source) => {
  const importEnd = source.indexOf("import { parseArgs } from '../functions/scripts/reconcileCodexDevIsolation.js';");
  if (importEnd < 0) throw new Error('Missing codex isolation imports');
  const insertAt = source.indexOf('\n', importEnd) + 1;
  source = `${source.slice(0, insertAt)}\nconst noModeratorAuth = { getUser: async () => ({ email: null }) };\n${source.slice(insertAt)}`;
  source = source.replaceAll('ensureCodexDevActorRegistered({ db, uid:', 'ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid:');
  source = source.replace(
    `/ensureCodexDevActorRegistered\\(\\{ db, uid, now, moderatorEmail \\}\\)/`,
    `/ensureCodexDevActorRegistered\\(\\{ db, auth: admin\\.auth\\(\\), uid, now \\}\\)/`,
  );
  return source;
});

await patchFile('tests/finalHolisticIsolation.test.mjs', (source) => {
  const testImport = `import { deleteSupportResetMessagesPageAtomically } from '../functions/supportResetIsolation.js';\n`;
  source = replaceOnce(
    source,
    testImport,
    `${testImport}\nconst noModeratorAuth = { getUser: async () => ({ email: null }) };\n`,
    'final holistic no-moderator Auth fixture',
  );
  source = source.replaceAll('ensureCodexDevActorRegistered({ db, uid:', 'ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid:');
  source = replaceOnce(
    source,
    `  await assert.rejects(ensureCodexDevActorRegistered({\n    db, uid: 'assigned-moderator', moderatorEmail: 'MOD@example.test',\n  }), (error) => error.code === 'codex-moderator-assignment-active' && error.retryable === false);`,
    `  const moderatorAuth = { getUser: async () => ({ email: 'MOD@example.test' }) };\n  await assert.rejects(ensureCodexDevActorRegistered({\n    db, auth: moderatorAuth, uid: 'assigned-moderator',\n  }), (error) => error.code === 'codex-moderator-assignment-active' && error.retryable === false);`,
    'authoritative moderator Auth test',
  );
  source = replaceOnce(
    source,
    `test('Codex establishment passes the existing Auth email into transactional registration', async () => {\n  const indexSource = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');\n  assert.match(indexSource, /admin\\.auth\\(\\)\\.getUser\\(uid\\)/);\n  assert.match(indexSource, /ensureCodexDevActorRegistered\\(\\{ db, uid, now, moderatorEmail \\}\\)/);\n});`,
    `test('Codex registration requires Firebase Auth evidence at the helper boundary', async () => {\n  const { db, docs } = createMemoryDb();\n  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'missing-auth' }),\n    (error) => error.code === 'codex-registration-auth-required' && error.retryable === false);\n  assert.equal(docs.has('codexDevActorRegistry/missing-auth'), false);\n\n  const [registrySource, indexSource, reconcileSource] = await Promise.all([\n    fs.readFile(new URL('../functions/codexDevActorRegistry.js', import.meta.url), 'utf8'),\n    fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),\n    fs.readFile(new URL('../functions/scripts/reconcileCodexDevIsolation.js', import.meta.url), 'utf8'),\n  ]);\n  assert.match(registrySource, /authUser = await auth\\.getUser\\(uid\\)/);\n  assert.doesNotMatch(registrySource, /moderatorEmail =/);\n  assert.match(indexSource, /ensureCodexDevActorRegistered\\(\\{ db, auth: admin\\.auth\\(\\), uid, now \\}\\)/);\n  assert.match(reconcileSource, /ensureCodexDevActorRegistered\\(\\{ db, auth, uid: canonicalUid \\}\\)/);\n  assert.match(reconcileSource, /const \\{ getAuth \\} = await import\\('firebase-admin\\/auth'\\)/);\n  assert.match(reconcileSource, /auth: getAuth\\(\\)/);\n});`,
    'registration evidence source regression',
  );
  return source;
});

await patchFile('tests/codexDevLegacyCleanup.test.mjs', (source) => {
  const importLine = `import { reconcileCodexDevIsolation } from '../functions/scripts/reconcileCodexDevIsolation.js';\n`;
  source = replaceOnce(
    source,
    importLine,
    `${importLine}\nconst noModeratorAuth = { getUser: async () => ({ email: null }) };\n`,
    'legacy cleanup Auth fixture',
  );
  // Every APPLY execution with an explicit UID must carry verified Auth evidence.
  source = source.replaceAll('apply: true, env: {}, uid:', 'apply: true, auth: noModeratorAuth, env: {}, uid:');
  source = source.replaceAll('apply: true, uid:', 'apply: true, auth: noModeratorAuth, uid:');
  // The canonical/fieldValue negative test has an explicit UID and must reach its intended failure after registration.
  source = source.replace(
    `apply: true, uid: 'canonical', skipStorage: true`,
    `apply: true, auth: noModeratorAuth, uid: 'canonical', skipStorage: true`,
  );
  return source;
});

console.log('Registration identity evidence P1 fixes applied.');
