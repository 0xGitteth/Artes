import {
  normalizeModerationGeneration,
  normalizeModerationScopeKey,
  resolveModerationScopeKey,
} from './moderationGeneration.js';

export const MODERATION_FRESH_SCOPES_COLLECTION = 'moderationFreshScopes';

export const getModerationFreshScopeRef = ({ db, scopeKey } = {}) => {
  if (!db) return null;
  const normalizedScopeKey = normalizeModerationScopeKey(scopeKey);
  if (!normalizedScopeKey) return null;
  return db.collection(MODERATION_FRESH_SCOPES_COLLECTION).doc(normalizedScopeKey);
};

export const readModerationScopeGeneration = async ({
  db,
  fingerprints = null,
  scopeKey = null,
  transaction = null,
} = {}) => {
  const resolvedScopeKey = normalizeModerationScopeKey(scopeKey)
    || resolveModerationScopeKey(fingerprints || {});
  if (!resolvedScopeKey) {
    return {
      scopeKey: null,
      generation: 0,
      ref: null,
      exists: false,
    };
  }

  const ref = getModerationFreshScopeRef({ db, scopeKey: resolvedScopeKey });
  if (!ref) {
    return {
      scopeKey: resolvedScopeKey,
      generation: 0,
      ref: null,
      exists: false,
    };
  }

  const snapshot = transaction
    ? await transaction.get(ref)
    : await ref.get();
  const data = snapshot?.exists ? (snapshot.data() || {}) : {};
  return {
    scopeKey: resolvedScopeKey,
    generation: normalizeModerationGeneration(data.generation),
    ref,
    exists: Boolean(snapshot?.exists),
  };
};
