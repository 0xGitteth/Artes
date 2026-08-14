import { CODEX_DEV_ACTOR, isCodexDevUid } from './codexDevIdentity.js';

export const CODEX_DEV_ACTOR_REGISTRY_COLLECTION = 'codexDevActorRegistry';

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
  const snapshot = await ref.get();
  if (snapshot.exists) return false;
  await ref.set({
    uid,
    actor: CODEX_DEV_ACTOR,
    productionDenyOnly: true,
    registeredAt: now,
  });
  return true;
};
