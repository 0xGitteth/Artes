import { validateArtesDetectorLabel } from './moderationLearningDataset.js';

export const MODERATION_VISION_CONTRACT_VERSION = 1;
export const MODERATION_EMBEDDING_DISTANCE = 'cosine';

export const DINO_V2_VIT_B14_POC = Object.freeze({
  provider: 'artes_custom_vision',
  model: 'dinov2_vitb14',
  modelFamily: 'dinov2',
  embeddingDimension: 768,
  distanceMetric: MODERATION_EMBEDDING_DISTANCE,
  generative: false,
  usage: 'staging_proof_of_concept',
});

const cleanString = (value) => String(value || '').trim();

export const validateVisionProviderDescriptor = (descriptor = {}) => {
  const errors = [];
  const provider = cleanString(descriptor.provider);
  const model = cleanString(descriptor.model);
  const modelFamily = cleanString(descriptor.modelFamily);
  const dimension = descriptor.embeddingDimension;

  if (!provider) errors.push('missing_provider');
  if (!model) errors.push('missing_model');
  if (!modelFamily) errors.push('missing_model_family');
  if (!Number.isInteger(dimension) || dimension <= 0 || dimension > 2048) {
    errors.push('invalid_embedding_dimension');
  }
  if (cleanString(descriptor.distanceMetric) !== MODERATION_EMBEDDING_DISTANCE) {
    errors.push('unsupported_distance_metric');
  }
  if (descriptor.generative !== false) errors.push('generative_provider_not_allowed_by_contract');
  if (!cleanString(descriptor.usage)) errors.push('missing_usage');

  return { valid: errors.length === 0, errors };
};

export const validateEmbeddingResult = (result = {}, descriptor = {}) => {
  const errors = [];
  const descriptorValidation = validateVisionProviderDescriptor(descriptor);
  if (!descriptorValidation.valid) errors.push(...descriptorValidation.errors.map((error) => `descriptor:${error}`));

  const vector = Array.isArray(result.vector) ? result.vector : null;
  if (!vector) {
    errors.push('missing_embedding_vector');
  } else {
    if (vector.length !== descriptor.embeddingDimension) errors.push('embedding_dimension_mismatch');
    if (vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      errors.push('invalid_embedding_value');
    }
  }

  if (cleanString(result.model) !== cleanString(descriptor.model)) errors.push('embedding_model_mismatch');
  if (cleanString(result.provider) !== cleanString(descriptor.provider)) errors.push('embedding_provider_mismatch');

  return { valid: errors.length === 0, errors };
};

export const validateDetectorResult = (result = {}) => {
  const errors = [];
  const labelValidation = validateArtesDetectorLabel(result.detectorLabel);
  if (!labelValidation.valid) errors.push(...labelValidation.errors.map((error) => `detector_label:${error}`));

  if (!cleanString(result.modelVersion)) errors.push('missing_model_version');
  if (!cleanString(result.datasetVersion)) errors.push('missing_dataset_version');

  // A detector reports concrete visual evidence. Final Artes publication/access
  // decisions deliberately do not belong in this contract.
  if (Object.hasOwn(result, 'finalOutcome')) errors.push('final_outcome_not_allowed');
  if (Object.hasOwn(result, 'policyDecision')) errors.push('policy_decision_not_allowed');
  if (Object.hasOwn(result, 'accessLevel')) errors.push('access_level_not_allowed');

  return { valid: errors.length === 0, errors };
};

export const buildVisionInferenceEnvelope = ({
  descriptor,
  embedding,
  detectorResult = null,
  nearestExamples = [],
} = {}) => {
  const descriptorValidation = validateVisionProviderDescriptor(descriptor);
  if (!descriptorValidation.valid) {
    throw new Error(`invalid_vision_provider:${descriptorValidation.errors.join(',')}`);
  }

  const embeddingValidation = validateEmbeddingResult(embedding, descriptor);
  if (!embeddingValidation.valid) {
    throw new Error(`invalid_embedding_result:${embeddingValidation.errors.join(',')}`);
  }

  if (detectorResult) {
    const detectorValidation = validateDetectorResult(detectorResult);
    if (!detectorValidation.valid) {
      throw new Error(`invalid_detector_result:${detectorValidation.errors.join(',')}`);
    }
  }

  const neighbors = (Array.isArray(nearestExamples) ? nearestExamples : [])
    .map((neighbor) => ({
      exampleId: cleanString(neighbor.exampleId) || null,
      distance: typeof neighbor.distance === 'number' && Number.isFinite(neighbor.distance)
        ? neighbor.distance
        : null,
      labelVersion: cleanString(neighbor.labelVersion) || null,
      detectorLabel: neighbor.detectorLabel || null,
    }))
    .filter((neighbor) => neighbor.exampleId && neighbor.distance !== null)
    .sort((a, b) => a.distance - b.distance);

  return {
    contractVersion: MODERATION_VISION_CONTRACT_VERSION,
    provider: descriptor.provider,
    model: descriptor.model,
    embeddingDimension: descriptor.embeddingDimension,
    distanceMetric: descriptor.distanceMetric,
    embedding: embedding.vector,
    detectorResult,
    nearestExamples: neighbors,
  };
};
