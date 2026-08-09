export const syncPublicProfileFromCurrentPrivate = async ({
  db,
  runTransaction,
  privateRef,
  publicRef,
  isOnboardingComplete,
  buildWritePayload,
}) => runTransaction(db, async (transaction) => {
  const privateSnap = await transaction.get(privateRef);
  if (!privateSnap.exists()) return { written: false, keys: [] };

  const currentPrivate = privateSnap.data() || {};
  if (!isOnboardingComplete(currentPrivate)) return { written: false, keys: [] };

  const publicSnap = await transaction.get(publicRef);
  const currentPublic = publicSnap.exists() ? (publicSnap.data() || {}) : {};
  const payload = buildWritePayload(currentPrivate, currentPublic);
  if (!payload || Object.keys(payload).length === 0) return { written: false, keys: [] };

  transaction.set(publicRef, payload, { merge: true });
  return { written: true, keys: Object.keys(payload).sort() };
});
