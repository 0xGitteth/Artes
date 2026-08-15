import { isKnownCodexDevActorUid } from './codexDevActorRegistry.js';

export const createClaimInviteAtomically = async ({
  db,
  uid,
  rateRef,
  inviteRef,
  inviteData,
  todayKey,
  rateLimitPerDay,
  serverTimestamp,
  createError,
}) => db.runTransaction(async (transaction) => {
  // Keep every authoritative read ahead of every write. Reading the deny-only
  // registry here serializes actor registration with invite creation.
  const [rateSnap, productionDenied] = await Promise.all([
    transaction.get(rateRef),
    isKnownCodexDevActorUid({ db, uid, transaction }),
  ]);
  if (productionDenied) {
    throw createError('permission-denied', 'Codex Dev claim invites are isolated');
  }

  const rateData = rateSnap.exists ? rateSnap.data() : null;
  const currentCount = rateData?.date === todayKey ? Number(rateData?.count || 0) : 0;
  if (currentCount >= rateLimitPerDay) {
    throw createError('resource-exhausted', 'Daily invite limit reached');
  }

  transaction.set(rateRef, {
    date: todayKey,
    count: currentCount + 1,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  transaction.set(inviteRef, inviteData);
});
