import { normalizeArtesDetectorLabel, validateArtesDetectorLabel } from './moderationLearningDataset.js';

const cleanString = (value) => String(value || '').trim();

export const MODERATION_LEARNING_CURATION_SCHEMA_VERSION = 1;

export const resolveLearningCurationFromModeratorDecision = ({
  example = {},
  explicitDetectorLabel = null,
} = {}) => {
  const action = cleanString(example?.moderatorDecision?.action);
  const embeddedHumanLabel = example?.moderatorDecision?.detectorLabel || null;
  const candidateLabel = explicitDetectorLabel || embeddedHumanLabel;
  const validation = validateArtesDetectorLabel(candidateLabel);

  if (validation.valid) {
    return {
      schemaVersion: MODERATION_LEARNING_CURATION_SCHEMA_VERSION,
      status: 'approved',
      detectorLabel: normalizeArtesDetectorLabel(candidateLabel),
      labelSource: explicitDetectorLabel ? 'explicit_human_detector_label' : 'moderator_decision_detector_label',
      requiresAdditionalLabeling: false,
      reasons: [],
    };
  }

  const reasons = [];
  if (!candidateLabel) reasons.push('missing_human_detector_label');
  else reasons.push(...validation.errors.map((error) => `invalid_human_detector_label:${error}`));

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
    labelSource: null,
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
