import {
  isModerationGenerationCurrent,
  normalizeModerationGeneration,
} from './moderationGeneration.js';

export const isReusableModerationCache = (uploadData, expectedPromptVersion, currentGeneration = 0) => {
  const expected = String(expectedPromptVersion || '').trim();
  if (!expected) return false;
  const mediaState = String(uploadData?.mediaState || '').trim();
  if (mediaState && mediaState !== 'ready') return false;
  const diagnostics = uploadData?.geminiDiagnostics || null;
  const cachedVersion = String(diagnostics?.promptVersion || '').trim();
  if (cachedVersion !== expected) return false;
  if (!isModerationGenerationCurrent({
    evidenceGeneration: uploadData?.moderationGeneration,
    currentGeneration,
  })) return false;
  return diagnostics?.success === true
    && diagnostics?.contractValidated === true
    && diagnostics?.fallbackUsed !== true
    && diagnostics?.safetyBlocked !== true;
};

export const buildReusableCacheGeminiDiagnostics = ({
  uploadData = {},
  expectedPromptVersion,
  sourceUploadId = null,
  currentGeneration = 0,
} = {}) => {
  if (!isReusableModerationCache(uploadData, expectedPromptVersion, currentGeneration)) return null;
  const sourceDiagnostics = uploadData?.geminiDiagnostics || {};
  const promptVersion = String(expectedPromptVersion || '').trim();
  const normalizedSourceUploadId = String(sourceUploadId || '').trim() || null;
  return {
    ...sourceDiagnostics,
    attempted: false,
    success: true,
    contractValidated: true,
    fallbackUsed: false,
    safetyBlocked: false,
    promptVersion,
    cacheReused: true,
    cacheSourceUploadId: normalizedSourceUploadId,
    cacheModerationGeneration: normalizeModerationGeneration(uploadData?.moderationGeneration),
  };
};

const normalizeReusableTaxonomyValues = (values = []) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean),
)).sort();

const reusableTaxonomyValuesEqual = (left = [], right = []) => {
  const normalizedLeft = normalizeReusableTaxonomyValues(left);
  const normalizedRight = normalizeReusableTaxonomyValues(right);
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

export const hasMatchingReusableModerationTaxonomy = ({
  uploadData = {},
  themes = [],
  makerTags = [],
} = {}) => {
  const cachedTaxonomy = uploadData?.userSelectedTaxonomy;
  if (!cachedTaxonomy || typeof cachedTaxonomy !== 'object' || Array.isArray(cachedTaxonomy)) return false;
  if (!Array.isArray(cachedTaxonomy.themes) || !Array.isArray(cachedTaxonomy.triggers)) return false;
  return reusableTaxonomyValuesEqual(cachedTaxonomy.themes, themes)
    && reusableTaxonomyValuesEqual(cachedTaxonomy.triggers, makerTags);
};

export const isUploadModerationExampleData = (exampleData = {}) => {
  const caseType = String(exampleData?.caseType || '').trim().toLowerCase();
  if (caseType) return caseType === 'upload';

  const source = String(exampleData?.source || '').trim();
  if (source === 'moderatorDecideReport') return false;

  // Legacy moderatorDecide report examples predate the explicit caseType field.
  // Upload-review decisions always have a persisted uploadId, while report-only
  // decisions may carry the same image fingerprint without one. Fail closed so
  // inverted report semantics can never be reused as upload moderation policy.
  if (source === 'moderatorDecide' && !String(exampleData?.uploadId || '').trim()) return false;

  return true;
};

export const isModerationExampleGenerationRouteable = (exampleData = {}, currentGeneration = 0) => (
  isModerationGenerationCurrent({
    evidenceGeneration: exampleData?.moderationGeneration,
    currentGeneration,
  })
);

const FINAL_MODERATION_EXAMPLE_ACTIONS = new Set([
  'approveAsIs',
  'approveWithTaxonomyCorrection',
  'requestUserCorrection',
  'rejectForbidden',
  'approve',
  'reject',
  'acceptCorrection',
  'rejectCorrection',
]);
const MODERATION_ROUTING_BOUNDARY_ACTIONS = new Set([
  ...FINAL_MODERATION_EXAMPLE_ACTIONS,
  'queueFreshEvaluation',
]);

const moderationExampleTimeMs = (example = {}) => {
  const value = example?.data?.moderatorDecision?.decidedAt
    || example?.data?.decidedAt
    || example?.data?.provenance?.createdAt
    || example?.data?.createdAt
    || null;
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const isFinalModerationExampleAction = (action) => (
  FINAL_MODERATION_EXAMPLE_ACTIONS.has(String(action || '').trim())
);

export const compareModerationExampleCandidates = (a, b) => {
  const generationDiff = normalizeModerationGeneration(b?.data?.moderationGeneration)
    - normalizeModerationGeneration(a?.data?.moderationGeneration);
  if (generationDiff !== 0) return generationDiff;
  const aAction = String(a?.data?.moderatorDecision?.action || '').trim();
  const bAction = String(b?.data?.moderatorDecision?.action || '').trim();
  const aBoundary = MODERATION_ROUTING_BOUNDARY_ACTIONS.has(aAction) ? 1 : 0;
  const bBoundary = MODERATION_ROUTING_BOUNDARY_ACTIONS.has(bAction) ? 1 : 0;
  if (aBoundary !== bBoundary) return bBoundary - aBoundary;
  const timeDiff = moderationExampleTimeMs(b) - moderationExampleTimeMs(a);
  if (timeDiff !== 0) return timeDiff;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
};

export const selectPreferredModerationExampleCandidate = (candidates = []) => {
  const usable = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (usable.length === 0) return null;
  return [...usable].sort(compareModerationExampleCandidates)[0] || null;
};

const NEAR_DUPLICATE_RESTRICTIVE_ACTIONS = new Set([
  'requestUserCorrection',
  'rejectForbidden',
  'reject',
  'rejectCorrection',
]);

export const canRouteNearDuplicateModerationExampleAction = (action) => (
  NEAR_DUPLICATE_RESTRICTIVE_ACTIONS.has(String(action || '').trim())
);

export const isNearDuplicateReuseOwnedByUploader = ({ uploadData = {}, userId = null } = {}) => {
  const expectedUserId = String(userId || '').trim();
  if (!expectedUserId) return false;
  const ownerUid = String(
    uploadData?.userId || uploadData?.uploaderUid || uploadData?.ownerUid || uploadData?.userUid || ''
  ).trim();
  return Boolean(ownerUid) && ownerUid === expectedUserId;
};
