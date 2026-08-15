import { CODEX_DEV_ACTOR, isCodexDevUid } from './codexDevIdentity.js';

export const CODEX_DEV_ACTOR_REGISTRY_COLLECTION = 'codexDevActorRegistry';
export const CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION = 'codexDevActorMergeFences';
export const CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION = 'codexDevActorLifecycleFences';
export const CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION = 'codexDevActorModeratorLocks';
const MERGE_FENCE_LEASE_MS = 30 * 60 * 1000;
const LIFECYCLE_FENCE_LEASE_MS = 5 * 60 * 1000;

const throwMergeFenceRecoveryRequired = (uid) => {
  const error = new Error(`Codex actor registration is blocked because contributor merge mutations already committed for ${uid}; operator recovery is required before clearing the fence.`);
  error.code = 'codex-merge-fence-recovery-required';
  error.status = 409;
  error.retryable = false;
  throw error;
};

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

export const ensureCodexDevActorRegistered = async ({ db, auth, uid, now = new Date() }) => {
  if (!db || !uid) throw new Error('Firestore db and Codex actor UID are required.');
  if (!auth || typeof auth.getUser !== 'function') {
    const error = new Error('Firebase Auth is required to verify Codex actor moderator assignment before registration.');
    error.code = 'codex-registration-auth-required';
    error.status = 500;
    error.retryable = false;
    throw error;
  }
  let authUser = null;
  try {
    authUser = await auth.getUser(uid);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
  }
  const normalizedModeratorEmail = String(authUser?.email || '').trim().toLowerCase();
  const ref = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const fenceRef = db.collection(CODEX_DEV_ACTOR_MERGE_FENCES_COLLECTION).doc(uid);
  const lifecycleFenceRef = db.collection(CODEX_DEV_ACTOR_LIFECYCLE_FENCES_COLLECTION).doc(uid);
  const moderatorLockRef = db.collection(CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION).doc(uid);
  const moderatorConfigRef = db.collection('config').doc('moderation');
  return db.runTransaction(async (transaction) => {
    const [snapshot, fenceSnapshot, lifecycleFenceSnapshot, moderatorLockSnapshot, moderatorConfigSnapshot] = await Promise.all([
      transaction.get(ref),
      transaction.get(fenceRef),
      transaction.get(lifecycleFenceRef),
      transaction.get(moderatorLockRef),
      transaction.get(moderatorConfigRef),
    ]);
    if (snapshot.exists) return false;
    if (moderatorLockSnapshot.exists) {
      const error = new Error(`Codex actor registration is blocked because ${uid} has production moderator authorization; operator clearance is required before reuse as Codex.`);
      error.code = 'codex-moderator-lock-active';
      error.status = 409;
      error.retryable = false;
      throw error;
    }
    const moderatorConfig = moderatorConfigSnapshot.exists ? moderatorConfigSnapshot.data() || {} : {};
    const moderatorEmails = Array.isArray(moderatorConfig.moderatorEmails)
      ? moderatorConfig.moderatorEmails.map((email) => String(email || '').trim().toLowerCase())
      : [];
    if (normalizedModeratorEmail && moderatorEmails.includes(normalizedModeratorEmail)) {
      const error = new Error(`Codex actor registration is blocked because ${uid} is assigned production moderator access.`);
      error.code = 'codex-moderator-assignment-active';
      error.status = 409;
      error.retryable = false;
      throw error;
    }
    const fence = fenceSnapshot.exists ? fenceSnapshot.data() || {} : {};
    if (fence.mutationCommitted === true) {
      throwMergeFenceRecoveryRequired(uid);
    }
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

export const ensureModeratorUidLockedOutOfCodexRegistration = async ({
  db, uid, email = '', now = new Date(),
}) => {
  if (!db || !uid) throw new Error('Firestore db and moderator UID are required.');
  const registryRef = db.collection(CODEX_DEV_ACTOR_REGISTRY_COLLECTION).doc(uid);
  const moderatorLockRef = db.collection(CODEX_DEV_ACTOR_MODERATOR_LOCKS_COLLECTION).doc(uid);
  return db.runTransaction(async (transaction) => {
    const [registrySnapshot, lockSnapshot] = await Promise.all([
      transaction.get(registryRef),
      transaction.get(moderatorLockRef),
    ]);
    if (registrySnapshot.exists || isCodexDevUid(uid)) {
      const error = new Error('Codex Dev identity cannot receive production moderator authorization.');
      error.code = 'codex-moderator-production-denied';
      error.status = 403;
      error.retryable = false;
      throw error;
    }
    if (!lockSnapshot.exists) {
      transaction.set(moderatorLockRef, {
        uid,
        email: String(email || '').toLowerCase(),
        blocksCodexRegistration: true,
        reason: 'productionModeratorAuthorization',
        createdAt: now,
        updatedAt: now,
      });
      return true;
    }
    return false;
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
      error.code = 'codex-lifecycle-fence-active';
      error.operation = String(fence.operation || '');
      error.status = 409;
      error.retryable = true;
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
  return { fenceRef, nowMs };
};

export const queueCodexDevLifecycleFenceRenewal = ({ transaction, validation }) => {
  if (!validation) return;
  const { fenceRef, nowMs } = validation;
  transaction.set(fenceRef, {
    leaseExpiresAtMs: nowMs + LIFECYCLE_FENCE_LEASE_MS,
    updatedAt: new Date(nowMs),
  }, { merge: true });
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
    if (fence.mutationCommitted === true) {
      throwMergeFenceRecoveryRequired(uid);
    }
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
