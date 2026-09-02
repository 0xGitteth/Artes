import { normalizeArtesDetectorLabel, validateArtesDetectorLabel } from './moderationLearningDataset.js';

const cleanString = (value) => String(value || '').trim();

export const MODERATION_LEARNING_CURATION_SCHEMA_VERSION = 1;

const normalizeEmbeddedPartialEvidence = (learningEvidence) => {
  if (!learningEvidence || typeof learningEvidence !== 'object') return null;
  const fields = learningEvidence.visualEvidence;
  const confirmedFields = Array.isArray(learningEvidence.confirmedFields)
    ? learningEvidence.confirmedFields.map(cleanString).filter(Boolean)
    : [];
  if (!fields || typeof fields !== 'object' || confirmedFields.length === 0) return null;
  return {
    source: cleanString(learningEvidence.source) || 'moderator_visual_evidence',
    completeness: learningEvidence.completeness === 'full' ? 'full' : 'partial',
    confirmedFields: Array.from(new Set(confirmedFields)),
    fields: { ...fields },
  };
};

export const resolveLearningCurationFromModeratorDecision = ({
  example = {},
  explicitDetectorLabel = null,
} = {}) => {
  const action = cleanString(example?.moderatorDecision?.action);
  const embeddedLearningEvidence = example?.moderatorDecision?.learningEvidence || null;
  const embeddedHumanLabel = example?.moderatorDecision?.detectorLabel
    || embeddedLearningEvidence?.detectorLabel
    || null;
  const partialVisualEvidence = normalizeEmbeddedPartialEvidence(embeddedLearningEvidence);
  const candidateLabel = explicitDetectorLabel || embeddedHumanLabel;
  const validation = validateArtesDetectorLabel(candidateLabel);

  if (validation.valid) {
    return {
      schemaVersion: MODERATION_LEARNING_CURATION_SCHEMA_VERSION,
      status: 'approved',
      detectorLabel: normalizeArtesDetectorLabel(candidateLabel),
      partialVisualEvidence,
      labelSource: explicitDetectorLabel
        ? 'explicit_human_detector_label'
        : embeddedLearningEvidence?.detectorLabel
          ? cleanString(embeddedLearningEvidence.source) || 'moderator_learning_evidence'
          : 'moderator_decision_detector_label',
      requiresAdditionalLabeling: false,
      reasons: [],
    };
  }

  const reasons = [];
  if (!candidateLabel) reasons.push('missing_human_detector_label');
  else reasons.push(...validation.errors.map((error) => `invalid_human_detector_label:${error}`));

  if (partialVisualEvidence) {
    reasons.push('partial_human_visual_evidence_available');
  }

  if (action === 'approveWithTaxonomyCorrection') {
    reasons.push('taxonomy_correction_is_learning_evidence_but_not_full_detector_label');
  } else if (action === 'approveAsIs') {
    reasons.push('approval_confirms_policy_outcome_not_every_detector_field');
  } else if (action === 'rejectForbidden' || action === 'reject') {
    reasons.push('forbidden_outcome_does_not_identify_visual_detector_reason');
  } else if (action === 'acceptCorrection') {
    reasons.push('accepted_user_correction_does_not_identify_full_detector_label');
  }

  return {
    schemaVersion: MODERATION_LEARNING_CURATION_SCHEMA_VERSION,
    status: 'pending',
    detectorLabel: null,
    partialVisualEvidence,
    labelSource: partialVisualEvidence?.source || null,
    requiresAdditionalLabeling: true,
    reasons: Array.from(new Set(reasons)),
  };
};

export const buildModeratorLearningLabelPayload = (detectorLabel) => {
  const validation = validateArtesDetectorLabel(detectorLabel);
  if (!validation.valid) {
    throw new Error(`invalid_detector_label:${validation.errors.join(',')}`);
  }
  return {
    detectorLabel: normalizeArtesDetectorLabel(detectorLabel),
    detectorLabelSource: 'human_moderator',
  };
};
