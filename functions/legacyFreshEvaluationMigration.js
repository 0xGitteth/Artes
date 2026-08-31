import {
  collectModerationFingerprintEntries,
  collectModerationScopeKeys,
  normalizeModerationGeneration,
} from './moderationGeneration.js';

export const LEGACY_FRESH_EVALUATION_MIN_GENERATION = 1;

export const resolveLegacyFreshEvaluationOverrideScopeKeys = ({
  override = null,
  upload = null,
  reviewCase = null,
  linkedUploads = [],
} = {}) => collectModerationScopeKeys(collectModerationFingerprintEntries(
  override,
  upload,
  reviewCase,
  linkedUploads,
));

export const planLegacyFreshEvaluationGenerationMigration = ({
  scopeKeys = [],
  currentGenerations = {},
} = {}) => {
  const uniqueScopeKeys = Array.from(new Set(Array.isArray(scopeKeys) ? scopeKeys : [])).sort();
  const writes = [];
  const verified = [];
  uniqueScopeKeys.forEach((scopeKey) => {
    const generation = normalizeModerationGeneration(currentGenerations?.[scopeKey]);
    if (generation >= LEGACY_FRESH_EVALUATION_MIN_GENERATION) {
      verified.push({ scopeKey, generation });
    } else {
      writes.push({
        scopeKey,
        currentGeneration: generation,
        targetGeneration: LEGACY_FRESH_EVALUATION_MIN_GENERATION,
      });
    }
  });
  return { scopeKeys: uniqueScopeKeys, writes, verified };
};

export const getLegacyFreshEvaluationMigrationGate = ({
  scopeKeys = [],
  currentGenerations = {},
} = {}) => {
  const plan = planLegacyFreshEvaluationGenerationMigration({ scopeKeys, currentGenerations });
  return {
    satisfied: plan.writes.length === 0,
    missingScopeKeys: plan.writes.map((item) => item.scopeKey),
    verifiedScopeKeys: plan.verified.map((item) => item.scopeKey),
  };
};
