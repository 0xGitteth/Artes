import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiditCustomClaims } from '../functions/diditCustomClaims.js';
import {
  acquireCodexDevLifecycleFence,
  acquireCodexDevMergeFence,
  ensureCodexDevActorRegistered,
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
