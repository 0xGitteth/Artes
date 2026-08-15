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
  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'partial' }),
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
  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'owner' }),
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
  assert.equal(await ensureCodexDevActorRegistered({ db, uid: 'owner' }), true);
});


test('production moderator authorization permanently serializes against Codex registration', async () => {
  const { db, docs } = createMemoryDb();
  assert.equal(await ensureModeratorUidLockedOutOfCodexRegistration({
    db, uid: 'moderator-user', email: 'MOD@example.test', now: new Date('2026-08-15T19:00:00Z'),
  }), true);
  assert.equal(docs.get('codexDevActorModeratorLocks/moderator-user').blocksCodexRegistration, true);
  assert.equal(docs.get('codexDevActorModeratorLocks/moderator-user').email, 'mod@example.test');
  await assert.rejects(ensureCodexDevActorRegistered({ db, uid: 'moderator-user' }),
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
  await assert.rejects(ensureCodexDevActorRegistered({
    db, uid: 'assigned-moderator', moderatorEmail: 'MOD@example.test',
  }), (error) => error.code === 'codex-moderator-assignment-active' && error.retryable === false);
  assert.equal(docs.has('codexDevActorRegistry/assigned-moderator'), false);
});

test('Codex establishment passes the existing Auth email into transactional registration', async () => {
  const indexSource = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  assert.match(indexSource, /admin\.auth\(\)\.getUser\(uid\)/);
  assert.match(indexSource, /ensureCodexDevActorRegistered\(\{ db, uid, now, moderatorEmail \}\)/);
});
