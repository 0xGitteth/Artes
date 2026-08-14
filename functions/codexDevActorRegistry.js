import { CODEX_DEV_ACTOR, isCodexDevUid } from './codexDevIdentity.js';

export const CODEX_DEV_ACTOR_REGISTRY_COLLECTION = 'codexDevActorRegistry';
export const CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION = 'codexDevActorMergeFences';
const MERGE_FENCE_LEASE_MS = 30 * 60 * 1000;

export const isRegisteredCodexDevActorUid = async ({ db, uid, transaction = null }) => {
  if (!db || !uid) return false;
  const ref = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  return snapshot.exists;
};

// Registry membership is a production-denial signal only. It deliberately does
// not participate in strict Codex privilege authorization.
export const isKnownCodexDevActorUid = async ({ db, uid, env = process.env, transaction = null }) => (
  isCodexDevUid(uid, env) || isRegisteredCodexDevActorUid({ db, uid, transaction })
);

export const ensureCodexDevActorRegistered = async ({ db, uid, now = new Date() }) => {
  if (!db || !uid) throw new Error('Firestore db and Codex actor UID are required.');
  const ref = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const fenceRef = db.collection(CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION).doc(uid);
  return db.runTransaction(async (transaction) => {
    const [snapshot, fenceSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(fenceRef),
    ]);
    if (snapshot.exists) return false;
    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};
    if (Number(fence.leaseExpiresAtMs || 0) > Date.now()) {
      const error = new Error(`Codex actor registration is blocked by an active contributor merge for ${uid}; retry after the merge completes.`);
      error.code = 'codex-merge-fence-active';
      error.retryable = true;
      throw error;
    }
    transaction.set(ref, {
      uid,
      actor: CODEX_DEV_ACTOR,
      productionDenyOnly: true,
      registeredAt: now,
    });
    return true;
  });
};

export const acquireCodexDevMergeFence = async ({ db, uid, token, nowMs = Date.now() }) => {
  const registryRef = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const fenceRef = db.collection(CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION).doc(uid);
  await db.runTransaction(async (transaction) => {
    const [registrySnapshot, fenceSnapshot] = await Promise.all([
      transaction.get(registryRef), transaction.get(fenceRef),
    ]);
    if (registrySnapshot.exists || isCodexDevUid(uid)) {
      const error = new Error('Codex Dev contributor claims are isolated.');
      error.status = 403;
      throw error;
    }
    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};
    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {
      const error = new Error('Another contributor merge is already active for this claimant.');
      error.status = 409;
      throw error;
    }
    transaction.set(fenceRef, { uid, token, leaseExpiresAtMs: nowMs + MERGE_FENCE_LEASE_MS, updatedAt: new Date(nowMs) });
  });
};

export const assertAndRenewCodexDevMergeFence = async ({ db, uid, token, transaction, nowMs = Date.now() }) => {
  const registryRef = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const fenceRef = db.collection(CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION).doc(uid);
  const [registrySnapshot, fenceSnapshot] = await Promise.all([
    transaction.get(registryRef), transaction.get(fenceRef),
  ]);
  const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};
  if (registrySnapshot.exists || isCodexDevUid(uid) || fence.token !== token || Number(fence.leaseExpiresAtMs || 0) <= nowMs) {
    const error = new Error('Contributor merge fence is unavailable; retry safely after operator review.');
    error.status = 409;
    throw error;
  }
  transaction.set(fenceRef, { leaseExpiresAtMs: nowMs + MERGE_FENCE_LEASE_MS, updatedAt: new Date(nowMs) }, { merge: true });
};

export const releaseCodexDevMergeFence = async ({ db, uid, token }) => {
  const fenceRef = db.collection(CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION).doc(uid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(fenceRef);
    if (snapshot.exists && snapshot.data()?.token === token) transaction.delete(fenceRef);
  });
};
