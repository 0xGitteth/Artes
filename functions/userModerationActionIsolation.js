const defaultDeniedError = () => {
  const error = new Error('Codex Dev production moderation actions are isolated.');
  error.status = 403;
  error.code = 'codex-dev-production-denied';
  return error;
};

export const runUserModerationActionMutation = async ({
  db,
  uid,
  isKnownCodexDevActorUid,
  mutate,
  createDeniedError = defaultDeniedError,
}) => {
  if (!db || !uid || typeof isKnownCodexDevActorUid !== 'function' || typeof mutate !== 'function') {
    throw new Error('runUserModerationActionMutation requires db, uid, actor lookup, and mutate callback');
  }
  return db.runTransaction(async (transaction) => {
    if (await isKnownCodexDevActorUid({ db, uid, transaction })) {
      throw createDeniedError();
    }
    return mutate(transaction);
  });
};
