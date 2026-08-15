import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildDiditCustomClaims } from '../functions/diditCustomClaims.js';
import {
  acquireCodexDevLifecycleFence,
  acquireCodexDevMergeFence,
  ensureCodexDevActorRegistered,
  ensureModeratorUidLockedOutOfCodexRegistration,
  releaseCodexDevLifecycleFence,
} from '../functions/codexDevActorRegistry.js';
import { deleteSupportResetMessagesPageAtomically } from '../functions/supportResetIsolation.js';

const noModeratorAuth = { getUser: async () => ({ email: null }) };

const createMemoryDb = (initial = []) => {
  const docs = new Map(initial);
  const refFor = (path) => ({ path, get: async () => ({
    exists: docs.has(path), ref: refFor(path), data: () => docs.get(path),
  }) });
  const db = {
    docs,
    collection: (collection) => ({ doc: (uid) => refFor(`${collection}/${uid}`) }),
    runTransaction: async (callback) => {
      const pending = [];
      const transaction = {
        get: async (ref) => ({ exists: docs.has(ref.path), ref, data: () => docs.get(ref.path) }),
        set: (ref, data, options) => pending.push(() => docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) || {} : {}), ...data })),
        delete: (ref) => pending.push(() => docs.delete(ref.path)),
      };
      const result = await callback(transaction);
      pending.forEach((apply) => apply());
      return result;
    },
  };
  return { db, docs, refFor };
};

test('Didit preserves unrelated claims and restores the canonical Codex claim pair', () => {
  const env = { CODEX_DEV_UID: 'canonical-codex' };
  assert.deepEqual(buildDiditCustomClaims({
    uid: 'canonical-codex', existingClaims: { moderator: true }, isApprovedAdult: true, isAdult: true, env,
  }), { moderator: true, devCodex: true, devActor: 'codex', idvVerified: true, isAdult: true });
  assert.deepEqual(buildDiditCustomClaims({
    uid: 'ordinary', existingClaims: { moderator: true }, isApprovedAdult: true, isAdult: true, env,
  }), { moderator: true, idvVerified: true, isAdult: true });
});

test('mutated merge fences remain recovery blockers after lease expiry and cannot be reacquired', async () => {
  const nowMs = Date.now();
  const { db, docs } = createMemoryDb([[
    'codexDevActorMergeFences/partial',
    { uid: 'partial', token: 'old-token', mutationCommitted: true, leaseExpiresAtMs: nowMs - 1 },
  ]]);
  await assert.rejects(ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'partial' }),
    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false);
  await assert.rejects(acquireCodexDevMergeFence({ db, uid: 'partial', token: 'new-token', nowMs }),
    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false);
  assert.equal(docs.get('codexDevActorMergeFences/partial').token, 'old-token');
  assert.equal(docs.has('codexDevActorRegistry/partial'), false);
});

test('support reset lifecycle fence blocks actor registration across destructive message pages', async () => {
  const nowMs = Date.now();
  const { db, docs, refFor } = createMemoryDb([
    ['threads/support_owner', { type: 'support', userUid: 'owner' }],
    ['threads/support_owner/messages/intro', { senderRole: 'system', text: 'intro' }],
    ['threads/support_owner/messages/user', { senderRole: 'user', text: 'hello' }],
  ]);
  await acquireCodexDevLifecycleFence({
    db, uid: 'owner', token: 'reset-token', operation: 'resetSupportThread', nowMs,
  });
  await assert.rejects(ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'owner' }),
    (error) => error.code === 'codex-lifecycle-fence-active' && error.retryable === true);

  const result = await deleteSupportResetMessagesPageAtomically({
    db, actorUid: 'owner', fenceToken: 'reset-token', threadRef: refFor('threads/support_owner'),
    expectedUserUid: 'owner', isModeratorRequest: false,
    messageDocs: [
      { ref: refFor('threads/support_owner/messages/intro') },
      { ref: refFor('threads/support_owner/messages/user') },
    ],
    introTexts: ['intro'], nowMs: nowMs + 1,
  });
  assert.equal(result.deletesInRound, 1);
  assert.equal(docs.has('threads/support_owner/messages/intro'), true);
  assert.equal(docs.has('threads/support_owner/messages/user'), false);
  assert.ok(docs.get('codexDevActorLifecycleFences/owner').leaseExpiresAtMs > nowMs);

  await releaseCodexDevLifecycleFence({ db, uid: 'owner', token: 'reset-token' });
  assert.equal(await ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'owner' }), true);
});


test('production moderator authorization permanently serializes against Codex registration', async () => {
  const { db, docs } = createMemoryDb();
  assert.equal(await ensureModeratorUidLockedOutOfCodexRegistration({
    db, uid: 'moderator-user', email: 'MOD@example.test', now: new Date('2026-08-15T19:00:00Z'),
  }), true);
  assert.equal(docs.get('codexDevActorModeratorLocks/moderator-user').blocksCodexRegistration, true);
  assert.equal(docs.get('codexDevActorModeratorLocks/moderator-user').email, 'mod@example.test');
  await assert.rejects(ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'moderator-user' }),
    (error) => error.code === 'codex-moderator-lock-active' && error.retryable === false);

  const { db: retiredDb } = createMemoryDb([[
    'codexDevActorRegistry/retired-codex', { uid: 'retired-codex', actor: 'codex' },
  ]]);
  await assert.rejects(ensureModeratorUidLockedOutOfCodexRegistration({
    db: retiredDb, uid: 'retired-codex', email: 'mod@example.test',
  }), (error) => error.code === 'codex-moderator-production-denied' && error.status === 403);
});

test('ensureModerator rejects Codex claims and installs the moderator registration lock', async () => {
  const indexSource = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(indexSource, /if \(isCodexDevForProductionDeny\(decoded\)\)/);
  assert.match(indexSource, /await ensureModeratorUidLockedOutOfCodexRegistration\(\{[\s\S]*?uid: decoded\?\.uid, email/);
});


test('authoritative moderator assignment blocks Codex registration even before a moderator lock exists', async () => {
  const { db, docs } = createMemoryDb([[
    'config/moderation', { moderatorEmails: ['mod@example.test'] },
  ]]);
  const moderatorAuth = { getUser: async () => ({ email: 'MOD@example.test' }) };
  await assert.rejects(ensureCodexDevActorRegistered({
    db, auth: moderatorAuth, uid: 'assigned-moderator',
  }), (error) => error.code === 'codex-moderator-assignment-active' && error.retryable === false);
  assert.equal(docs.has('codexDevActorRegistry/assigned-moderator'), false);
});

test('Codex registration requires Firebase Auth evidence at the helper boundary', async () => {
  const { db, docs } = createMemoryDb();
  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'missing-auth' }),
    (error) => error.code === 'codex-registration-auth-required' && error.retryable === false);
  assert.equal(docs.has('codexDevActorRegistry/missing-auth'), false);

  const [registrySource, indexSource, reconcileSource] = await Promise.all([
    fs.readFile(new URL('../functions/codexDevActorRegistry.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../functions/scripts/reconcileCodexDevIsolation.js', import.meta.url), 'utf8'),
  ]);
  assert.match(registrySource, /authUser = await auth\.getUser\(uid\)/);
  assert.doesNotMatch(registrySource, /moderatorEmail =/);
  assert.match(indexSource, /ensureCodexDevActorRegistered\(\{ db, auth: admin\.auth\(\), uid, now \}\)/);
  assert.match(reconcileSource, /ensureCodexDevActorRegistered\(\{ db, auth, uid: canonicalUid \}\)/);
  assert.match(reconcileSource, /const \{ getAuth \} = await import\('firebase-admin\/auth'\)/);
  assert.match(reconcileSource, /auth: getAuth\(\)/);
});


test('support thread creation is fenced against actor registration', async () => {
  const { db } = createMemoryDb();
  await acquireCodexDevLifecycleFence({
    db, uid: 'support-user', token: 'support-token', operation: 'ensureSupportThread',
  });
  await assert.rejects(ensureCodexDevActorRegistered({
    db, auth: noModeratorAuth, uid: 'support-user',
  }), (error) => error.code === 'codex-lifecycle-fence-active' && error.retryable === true);
  await releaseCodexDevLifecycleFence({ db, uid: 'support-user', token: 'support-token' });
});

test('ensureSupportThread owns a lifecycle fence for all production writes', async () => {
  const source = await fs.readFile(new URL('../functions/supportChat.js', import.meta.url), 'utf8');
  assert.match(source, /acquireCodexDevLifecycleFence\(\{[\s\S]*?operation: 'ensureSupportThread'/);
  assert.match(source, /try \{[\s\S]*?threadRef\.set[\s\S]*?indexRef\.set[\s\S]*?finally \{[\s\S]*?releaseCodexDevLifecycleFence/);
});


test('lifecycle fence contention exposes operation metadata for safe same-operation retry', async () => {
  const { db } = createMemoryDb();
  const nowMs = Date.now();
  await acquireCodexDevLifecycleFence({
    db, uid: 'concurrent-support', token: 'first', operation: 'ensureSupportThread', nowMs,
  });
  await assert.rejects(acquireCodexDevLifecycleFence({
    db, uid: 'concurrent-support', token: 'second', operation: 'ensureSupportThread', nowMs: nowMs + 1,
  }), (error) => error.code === 'codex-lifecycle-fence-active'
    && error.operation === 'ensureSupportThread'
    && error.status === 409
    && error.retryable === true);
});

test('support ensure retries only same-operation contention and preserves non-auth error status', async () => {
  const source = await fs.readFile(new URL('../functions/supportChat.js', import.meta.url), 'utf8');
  assert.match(source, /sameOperationContention = error\?\.code === 'codex-lifecycle-fence-active'[\s\S]*?error\?\.operation === 'ensureSupportThread'/);
  assert.match(source, /SUPPORT_FENCE_RETRY_DELAYS_MS\[attempt\]/);
  assert.match(source, /Number\.isInteger\(e\?\.status\) \? e\.status : 401/);
});

test('reconcile uses bounded transactions, fresh destructive rechecks, and position-safe moodboard covers', async () => {
  const source = await fs.readFile(new URL('../functions/scripts/reconcileCodexDevIsolation.js', import.meta.url), 'utf8');
  assert.match(source, /MOODBOARD_REPAIR_TRANSACTION_ITEM_LIMIT = 400/);
  assert.match(source, /clearAffiliationsIfStillCodex[\s\S]*?transaction\.get\(ref\)[\s\S]*?buildAffiliationClearPatch\(snapshot\.data\(\)/);
  assert.match(source, /matchingItems = chunk\.filter[\s\S]*?snapshot\?\.exists && isCodexMoodboardItem/);
  assert.match(source, /nextCoverImageUrls\.push\(typeof currentCoverImageUrls\[index\] === 'string' \? currentCoverImageUrls\[index\] : ''\)/);
});
