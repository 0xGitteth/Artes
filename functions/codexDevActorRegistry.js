import { CODEX_DEV_ACTOR, isCodexDevUid } from './codexDevIdentity.js';

export const CODEX_DEV_ACTOR_REGISTRY_COLLECTION = 'codexDevActorRegistry';
export const CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION = 'codexDevActorMergeFences';
export const CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION = 'codexDevActorLifecycleFences';
const MERGE_FENCE_LEASE_MS = 30 * 60 * 1000;
const LIFECYCLE_FENCE_LEASE_MS = 5 * 60 * 1000;

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
  const lifecycleFenceRef = db.collection(CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION).doc(uid);
  return db.runTransaction(async (transaction) => {
    const [snapshot, fenceSnapshot, lifecycleFenceSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(fenceRef),
      transaction.get(lifecycleFenceRef),
    ]);
    if (snapshot.exists) return false;
    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};
    if (Number(fence.leaseExpiresAtMs || 0) > Date.now()) {
      const error = new Error(`Codex actor registration is blocked by an active contributor merge for ${uid}; retry after the merge completes.`);
      error.code = 'codex-merge-fence-active';
      error.retryable = true;
      throw error;
    }
    const lifecycleFence = lifecycleFenceSnapshot.exists ? lifecycleFenceSnapshot.data() || {} : {};
    if (Number(lifecycleFence.leaseExpiresAtMs || 0) > Date.now()) {
      const error = new Error(`Codex actor registration is blocked by an active account lifecycle operation for ${uid}; retry after it completes.`);
      error.code = 'codex-lifecycle-fence-active';
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

export const acquireCodexDevLifecycleFence = async ({
  db, uid, token, operation = 'deleteOnboardingAccount', nowMs = Date.now(),
}) => {
  const registryRef = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const fenceRef = db.collection(CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION).doc(uid);
  await db.runTransaction(async (transaction) => {
    const [registrySnapshot, fenceSnapshot] = await Promise.all([
      transaction.get(registryRef), transaction.get(fenceRef),
    ]);
    if (registrySnapshot.exists || isCodexDevUid(uid)) {
      const error = new Error('Codex Dev identity cannot be deleted.');
      error.status = 403;
      throw error;
    }
    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};
    if (Number(fence.leaseExpiresAtMs || 0) > nowMs && fence.token !== token) {
      const error = new Error('Another account lifecycle operation is already active.');
      error.status = 409;
      throw error;
    }
    transaction.set(fenceRef, {
      uid,
      operation,
      token,
      leaseExpiresAtMs: nowMs + LIFECYCLE_FENCE_LEASE_MS,
      updatedAt: new Date(nowMs),
    });
  });
};

export const readAndValidateCodexDevLifecycleFence = async ({
  db, uid, token, transaction, operation = 'deleteOnboardingAccount', nowMs = Date.now(),
}) => {
  const registryRef = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const fenceRef = db.collection(CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION).doc(uid);
  const [registrySnapshot, fenceSnapshot] = await Promise.all([
    transaction.get(registryRef), transaction.get(fenceRef),
  ]);
  const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};
  if (registrySnapshot.exists
    || isCodexDevUid(uid)
    || fence.token !== token
    || fence.operation !== operation
    || Number(fence.leaseExpiresAtMs || 0) <= nowMs) {
    const error = new Error('Account lifecycle fence is unavailable; retry safely.');
    error.status = 409;
    throw error;
  }
};

export const releaseCodexDevLifecycleFence = async ({ db, uid, token }) => {
  const fenceRef = db.collection(CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION).doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(fenceRef);
    if (!snapshot.exists || snapshot.data()?.token !== token) return false;
    transaction.delete(fenceRef);
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
    transaction.set(fenceRef, {
      uid,
      token,
      mutationCommitted: false,
      leaseExpiresAtMs: nowMs + MERGE_FENCE_LEASE_MS,
      updatedAt: new Date(nowMs),
    });
  });
};

export const readAndValidateCodexDevMergeFence = async ({ db, uid, token, transaction, nowMs = Date.now() }) => {
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
  return { fenceRef, nowMs };
};

export const queueCodexDevMergeFenceRenewal = ({ transaction, validation, mutationCommitted = false }) => {
  if (!validation) return;
  const { fenceRef, nowMs } = validation;
  transaction.set(fenceRef, {
    leaseExpiresAtMs: nowMs + MERGE_FENCE_LEASE_MS,
    updatedAt: new Date(nowMs),
    ...(mutationCommitted ? { mutationCommitted: true } : {}),
  }, { merge: true });
};

export const releaseCodexDevMergeFenceIfUnmutated = async ({ db, uid, token }) => {
  const fenceRef = db.collection(CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION).doc(uid);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(fenceRef);
    const fence = snapshot.exists ? snapshot.data() || {} : {};
    if (!snapshot.exists || fence.token !== token || fence.mutationCommitted === true) return false;
    transaction.delete(fenceRef);
    return true;
  });
};

export const releaseCodexDevMergeFence = async ({ db, uid, token }) => {
  const fenceRef = db.collection(CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION).doc(uid);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(fenceRef);
    if (snapshot.exists && snapshot.data()?.token === token) transaction.delete(fenceRef);
  });
};
