import { buildModeratorLearningEvidence } from './moderationModeratorLearningEvidence.js';

const isPlainObject = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value);

const invalidSubmission = (message) => {
  const error = new Error(message);
  error.status = 400;
  error.code = 'invalid_moderator_learning_submission';
  return error;
};

export const sanitizeModeratorLearningSubmission = ({
  reasonCode = null,
  aiDetectorLabel = null,
  submission = null,
} = {}) => {
  if (submission === null || submission === undefined) {
    return {
      supplied: false,
      evidence: null,
    };
  }
  if (!isPlainObject(submission)) {
    throw invalidSubmission('invalid_moderator_learning_submission_shape');
  }

  const allowedKeys = new Set(['confirmAiLabel', 'visualEvidence']);
  const unsupportedKeys = Object.keys(submission).filter((key) => !allowedKeys.has(key));
  if (unsupportedKeys.length > 0) {
    throw invalidSubmission(`unsupported_moderator_learning_submission_fields:${unsupportedKeys.sort().join(',')}`);
  }

  const confirmAiLabel = submission.confirmAiLabel === true;
  const visualEvidence = isPlainObject(submission.visualEvidence)
    ? submission.visualEvidence
    : null;

  if (!confirmAiLabel && !visualEvidence) {
    throw invalidSubmission('empty_moderator_learning_submission');
  }
  if (confirmAiLabel && visualEvidence && Object.keys(visualEvidence).length > 0) {
    throw invalidSubmission('moderator_learning_submission_conflicting_modes');
  }

  try {
    const evidence = buildModeratorLearningEvidence({
      reasonCode,
      aiDetectorLabel,
      confirmAiLabel,
      visualEvidence,
    });

    return {
      supplied: true,
      evidence,
    };
  } catch (error) {
    if (error?.status === 400) throw error;
    throw invalidSubmission(error?.message || 'invalid_moderator_learning_submission');
  }
};

export const buildModeratorDecisionLearningFields = ({
  reasonCode = null,
  aiDetectorLabel = null,
  submission = null,
} = {}) => {
  const sanitized = sanitizeModeratorLearningSubmission({
    reasonCode,
    aiDetectorLabel,
    submission,
  });
  if (!sanitized.supplied) return {};
  return {
    moderatorLearningEvidence: sanitized.evidence,
    ...(sanitized.evidence?.detectorLabel
      ? { detectorLabel: sanitized.evidence.detectorLabel }
      : {}),
  };
};
