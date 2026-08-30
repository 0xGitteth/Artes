export const MODERATION_FRESH_SCOPE_PREFIX_LENGTH = 4;

const HEX_PATTERN = /^[0-9a-f]+$/;

export const normalizeModerationGeneration = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
};

export const normalizeModerationScopeKey = (
  value,
  prefixLength = MODERATION_FRESH_SCOPE_PREFIX_LENGTH,
) => {
  const length = Number(prefixLength);
  if (!Number.isInteger(length) || length <= 0) return null;
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.length !== length || !HEX_PATTERN.test(normalized)) return null;
  return normalized;
};

export const resolveModerationScopeKey = (
  fingerprints = {},
  prefixLength = MODERATION_FRESH_SCOPE_PREFIX_LENGTH,
) => {
  const explicitPrefix = normalizeModerationScopeKey(fingerprints?.dhashPrefix, prefixLength);
  if (explicitPrefix) return explicitPrefix;

  const dhash = String(fingerprints?.dhash || '').trim().toLowerCase();
  const length = Number(prefixLength);
  if (!Number.isInteger(length) || length <= 0) return null;
  if (dhash.length < length || !HEX_PATTERN.test(dhash)) return null;
  return dhash.slice(0, length);
};

export const isModerationGenerationCurrent = ({
  evidenceGeneration = 0,
  currentGeneration = 0,
} = {}) => (
  normalizeModerationGeneration(evidenceGeneration)
  >= normalizeModerationGeneration(currentGeneration)
);

export const getModerationGenerationDecision = ({
  evidenceGeneration = 0,
  currentGeneration = 0,
} = {}) => {
  const evidence = normalizeModerationGeneration(evidenceGeneration);
  const current = normalizeModerationGeneration(currentGeneration);
  return {
    allowed: evidence >= current,
    evidenceGeneration: evidence,
    currentGeneration: current,
    staleBy: evidence >= current ? 0 : current - evidence,
  };
};

export const collectModerationScopeKeys = (
  fingerprintEntries = [],
  prefixLength = MODERATION_FRESH_SCOPE_PREFIX_LENGTH,
) => Array.from(new Set(
  (Array.isArray(fingerprintEntries) ? fingerprintEntries : [])
    .map((entry) => resolveModerationScopeKey(entry, prefixLength))
    .filter(Boolean),
)).sort();
