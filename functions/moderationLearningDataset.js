import crypto from 'crypto';

export const MODERATION_LEARNING_SCHEMA_VERSION = 1;
export const ARTES_DETECTOR_LABEL_VERSION = 'artes_detector_v1';
export const DATASET_SPLIT_VERSION = 'semantic_cluster_hash_v1';

const RESOLVED_TRAINING_ACTIONS = new Set([
  'approveAsIs',
  'approveWithTaxonomyCorrection',
  'rejectForbidden',
  'acceptCorrection',
  'approve',
  'reject',
]);

const TRAINING_FINAL_OUTCOMES = new Set(['allowed', 'forbidden', 'correction_accepted']);
const NUDITY_VALUES = new Set([
  'none',
  'underwear_swimwear',
  'implied_nude',
  'bare_buttocks',
  'female_bare_breasts',
  'genitalia',
  'male_topless',
]);
const SEXUAL_CONTEXT_VALUES = new Set(['none', 'suggestive', 'bdsm_kink', 'explicit_act']);
const GRAPHIC_INJURY_VALUES = new Set(['none', 'mild', 'graphic']);
const SENSITIVE_SIGNAL_VALUES = new Set([
  'bloodInjury',
  'selfHarm',
  'suicide',
  'eatingDisorder',
  'substanceDistress',
  'violence',
  'horrorScare',
]);

const cleanString = (value) => String(value || '').trim();
const cleanStringArray = (value) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map(cleanString)
    .filter(Boolean),
));

export const validateArtesDetectorLabel = (label) => {
  const errors = [];
  if (!label || typeof label !== 'object' || Array.isArray(label)) {
    return { valid: false, errors: ['invalid_label_shape'] };
  }

  if (!NUDITY_VALUES.has(cleanString(label.nudity))) errors.push('invalid_nudity');
  if (!SEXUAL_CONTEXT_VALUES.has(cleanString(label.sexualContext))) errors.push('invalid_sexual_context');
  if (!GRAPHIC_INJURY_VALUES.has(cleanString(label.graphicInjury))) errors.push('invalid_graphic_injury');

  if (!Array.isArray(label.sensitiveSignals)) {
    errors.push('invalid_sensitive_signals');
  } else if (label.sensitiveSignals.some((value) => !SENSITIVE_SIGNAL_VALUES.has(cleanString(value)))) {
    errors.push('unsupported_sensitive_signal');
  }

  if (typeof label.possibleMinorConcern !== 'boolean') errors.push('invalid_possible_minor_concern');
  if (typeof label.confidence !== 'number' || !Number.isFinite(label.confidence) || label.confidence < 0 || label.confidence > 1) {
    errors.push('invalid_confidence');
  }
  if (!Array.isArray(label.uncertaintyFlags) || label.uncertaintyFlags.some((value) => !cleanString(value))) {
    errors.push('invalid_uncertainty_flags');
  }

  return { valid: errors.length === 0, errors };
};

export const normalizeArtesDetectorLabel = (label) => {
  const validation = validateArtesDetectorLabel(label);
  if (!validation.valid) return null;
  return {
    nudity: cleanString(label.nudity),
    sexualContext: cleanString(label.sexualContext),
    graphicInjury: cleanString(label.graphicInjury),
    sensitiveSignals: cleanStringArray(label.sensitiveSignals).sort(),
    possibleMinorConcern: label.possibleMinorConcern,
    confidence: label.confidence,
    uncertaintyFlags: cleanStringArray(label.uncertaintyFlags).sort(),
  };
};

const resolveLearningMismatchType = ({ action = null, storedMismatchType = null } = {}) => {
  const normalizedAction = cleanString(action);
  const normalizedMismatch = cleanString(storedMismatchType);
  if (normalizedAction === 'approveWithTaxonomyCorrection' && (!normalizedMismatch || normalizedMismatch === 'none')) {
    return 'wrong_taxonomy';
  }
  return normalizedMismatch || null;
};

export const assessModerationExampleCandidate = (example = {}) => {
  const reasons = [];
  const qualityWarnings = [];
  const caseType = cleanString(example.caseType).toLowerCase();
  const action = cleanString(example?.moderatorDecision?.action);
  const finalOutcome = cleanString(example.finalOutcome);
  const learningStatus = cleanString(example.learningStatus);
  const sha256 = cleanString(example?.fingerprints?.sha256);
  const policyVersion = cleanString(example.policyVersion || example?.provenance?.policyVersion);
  const mismatchType = resolveLearningMismatchType({
    action,
    storedMismatchType: example?.analytics?.mismatchType,
  });

  if (caseType && caseType !== 'upload') reasons.push('not_upload_case');
  if (learningStatus !== 'resolved') reasons.push('not_resolved');
  if (!RESOLVED_TRAINING_ACTIONS.has(action)) reasons.push('unsupported_moderator_action');
  if (!TRAINING_FINAL_OUTCOMES.has(finalOutcome)) reasons.push('unsupported_final_outcome');
  if (!sha256) reasons.push('missing_sha256');

  // A policy version is valuable provenance but is not required to learn a visual
  // detector label. Legacy moderator decisions predate versioned policy metadata.
  // Keep them eligible while surfacing the missing provenance explicitly.
  if (!policyVersion) qualityWarnings.push('missing_policy_version');

  return {
    candidate: reasons.length === 0,
    reasons,
    qualityWarnings,
    sourceEvidence: {
      action: action || null,
      finalOutcome: finalOutcome || null,
      policyVersion: policyVersion || null,
      policyVersionKnown: Boolean(policyVersion),
      sha256: sha256 || null,
      mismatchType,
    },
  };
};

export const assignDatasetSplit = (semanticClusterId, { train = 80, validation = 10, test = 10 } = {}) => {
  const groupKey = cleanString(semanticClusterId);
  if (!groupKey) return null;
  if (![train, validation, test].every((value) => Number.isInteger(value) && value >= 0)) return null;
  if ((train + validation + test) !== 100) return null;

  const hash = crypto.createHash('sha256').update(`${DATASET_SPLIT_VERSION}:${groupKey}`).digest('hex');
  const bucket = Number.parseInt(hash.slice(0, 8), 16) % 100;
  if (bucket < train) return 'train';
  if (bucket < train + validation) return 'validation';
  return 'test';
};

export const buildModerationLearningItem = ({
  exampleId,
  example = {},
  curation = {},
  embedding = {},
  trainingAsset = {},
  sourcePoolId = null,
} = {}) => {
  const sourceExampleId = cleanString(exampleId);
  const candidateAssessment = assessModerationExampleCandidate(example);
  const curationStatus = cleanString(curation.status);
  const detectorLabel = normalizeArtesDetectorLabel(curation.detectorLabel);
  const detectorLabelValidation = validateArtesDetectorLabel(curation.detectorLabel);
  const semanticClusterId = cleanString(embedding.semanticClusterId);
  const semanticClusterApproved = embedding.semanticClusterApproved === true;
  const embeddingModel = cleanString(embedding.model);
  const normalizedSourcePoolId = cleanString(sourcePoolId);
  const trainingAssetUri = cleanString(trainingAsset.uri);
  const assetApproved = trainingAsset.approvedForTraining === true;
  const benchmarkOnly = curation.benchmarkOnly === true;

  const readinessReasons = [...candidateAssessment.reasons];
  if (benchmarkOnly) readinessReasons.push('benchmark_only');
  if (curationStatus !== 'approved') readinessReasons.push('curation_not_approved');
  if (!detectorLabel) readinessReasons.push(...detectorLabelValidation.errors.map((reason) => `detector_label:${reason}`));
  if (!semanticClusterId) readinessReasons.push('missing_semantic_cluster');
  if (semanticClusterId && !semanticClusterApproved) readinessReasons.push('semantic_cluster_not_approved');
  if (!embeddingModel) readinessReasons.push('missing_embedding_model');
  if (!normalizedSourcePoolId) readinessReasons.push('missing_source_pool');
  if (!trainingAssetUri) readinessReasons.push('missing_training_asset');
  if (!assetApproved) readinessReasons.push('training_asset_not_approved');

  const split = semanticClusterId && semanticClusterApproved ? assignDatasetSplit(semanticClusterId) : null;
  const trainingReady = candidateAssessment.candidate
    && !benchmarkOnly
    && readinessReasons.length === 0
    && Boolean(split);

  return {
    schemaVersion: MODERATION_LEARNING_SCHEMA_VERSION,
    labelVersion: ARTES_DETECTOR_LABEL_VERSION,
    sourceExampleId: sourceExampleId || null,
    sourcePoolId: normalizedSourcePoolId || null,
    sourceFingerprintSha256: candidateAssessment.sourceEvidence.sha256,
    policyVersion: candidateAssessment.sourceEvidence.policyVersion,
    policyVersionKnown: candidateAssessment.sourceEvidence.policyVersionKnown,
    sourceModeratorAction: candidateAssessment.sourceEvidence.action,
    sourceFinalOutcome: candidateAssessment.sourceEvidence.finalOutcome,
    sourceMismatchType: candidateAssessment.sourceEvidence.mismatchType,
    sourceQualityWarnings: candidateAssessment.qualityWarnings,
    candidate: candidateAssessment.candidate,
    candidateExclusionReasons: candidateAssessment.reasons,
    curationStatus: curationStatus || 'pending',
    detectorLabel,
    semanticEmbedding: {
      model: embeddingModel || null,
      dimension: Number.isInteger(embedding.dimension) ? embedding.dimension : null,
      semanticClusterId: semanticClusterId || null,
      semanticClusterApproved,
    },
    trainingAsset: trainingAssetUri
      ? {
          uri: trainingAssetUri,
          approvedForTraining: assetApproved,
          retentionClass: cleanString(trainingAsset.retentionClass) || null,
        }
      : null,
    benchmarkOnly,
    datasetSplitVersion: DATASET_SPLIT_VERSION,
    datasetSplit: split,
    datasetSplitFinal: false,
    trainingReady,
    trainingReadinessReasons: Array.from(new Set(readinessReasons)),
  };
};
