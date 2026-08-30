export const MODERATION_FRESH_SCOPE_PREFIX_LENGTH = 4;

const HEX_PATTERN = /^[0-9a-f]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DHASH_PATTERN = /^[0-9a-f]{16}$/;

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

export const normalizeModerationFingerprintEntry = (
  value,
  prefixLength = MODERATION_FRESH_SCOPE_PREFIX_LENGTH,
) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const rawSha256 = String(value.sha256 || '').trim().toLowerCase();
  const rawDhash = String(value.dhash || '').trim().toLowerCase();
  const scopeKey = resolveModerationScopeKey(value, prefixLength);

  if (!scopeKey) return null;
  if (rawDhash && !DHASH_PATTERN.test(rawDhash)) return null;
  if (rawDhash && rawDhash.slice(0, Number(prefixLength)) !== scopeKey) return null;
  if (rawSha256 && !SHA256_PATTERN.test(rawSha256)) return null;

  return {
    ...(rawSha256 ? { sha256: rawSha256 } : {}),
    ...(rawDhash ? { dhash: rawDhash } : {}),
    dhashPrefix: scopeKey,
  };
};

const fingerprintIdentity = (entry) => [
  entry?.sha256 || '',
  entry?.dhash || '',
  entry?.dhashPrefix || '',
].join(':');

export const collectModerationFingerprintEntries = (
  ...candidates
) => {
  const entries = [];
  const seen = new Set();

  const visit = (candidate, depth = 0) => {
    if (candidate === null || candidate === undefined || depth > 4) return;
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof candidate !== 'object') return;

    const normalized = normalizeModerationFingerprintEntry(candidate);
    if (normalized) {
      const identity = fingerprintIdentity(normalized);
      if (!seen.has(identity)) {
        seen.add(identity);
        entries.push(normalized);
      }
      return;
    }

    // Support the legacy/server-owned containers that have historically held
    // fingerprint evidence. Do not recursively walk arbitrary object keys.
    visit(candidate.fingerprints, depth + 1);
    visit(candidate.fingerprint, depth + 1);
    visit(candidate.metadata?.fingerprints, depth + 1);
  };

  candidates.forEach((candidate) => visit(candidate));
  return entries;
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

export const planModerationScopeGenerationIncrement = ({
  scopeKeys = [],
  currentGenerations = {},
} = {}) => {
  const uniqueScopeKeys = Array.from(new Set(
    (Array.isArray(scopeKeys) ? scopeKeys : [])
      .map((scopeKey) => normalizeModerationScopeKey(scopeKey))
      .filter(Boolean),
  )).sort();

  return Object.fromEntries(uniqueScopeKeys.map((scopeKey) => [
    scopeKey,
    normalizeModerationGeneration(currentGenerations?.[scopeKey]) + 1,
  ]));
};
