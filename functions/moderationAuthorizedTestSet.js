import crypto from 'crypto';
import path from 'node:path';
import { validateArtesDetectorLabel, normalizeArtesDetectorLabel } from './moderationLearningDataset.js';

export const AUTHORIZED_TEST_SET_SCHEMA_VERSION = 1;
export const AUTHORIZED_TEST_SET_LABEL_VERSION = 'artes_detector_v1';
export const AUTHORIZED_TEST_SET_MODEL = 'dinov2_vitb14';

const clean = (value) => String(value || '').trim();
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export const normalizeAuthorizedTestImageName = (value) => {
  const name = path.basename(clean(value));
  const ext = path.extname(name).toLowerCase();
  if (!name || !ALLOWED_EXTENSIONS.has(ext)) return null;
  return name;
};

export const sha256Buffer = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('authorized_test_image_buffer_required');
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

export const buildAuthorizedTestSetItem = ({
  fileName,
  buffer,
  embedding = null,
  detectorLabel = null,
  authorizedForLocalPoc = false,
} = {}) => {
  const normalizedFileName = normalizeAuthorizedTestImageName(fileName);
  if (!normalizedFileName) throw new Error('authorized_test_image_name_invalid');
  if (authorizedForLocalPoc !== true) throw new Error('authorized_test_image_permission_required');

  const sha256 = sha256Buffer(buffer);
  const vector = Array.isArray(embedding) ? embedding : null;
  const embeddingReady = Boolean(vector && vector.length === 768 && vector.every(Number.isFinite));
  const labelValidation = detectorLabel ? validateArtesDetectorLabel(detectorLabel) : { valid: false, errors: ['missing_detector_label'] };
  const normalizedLabel = labelValidation.valid ? normalizeArtesDetectorLabel(detectorLabel) : null;

  return {
    schemaVersion: AUTHORIZED_TEST_SET_SCHEMA_VERSION,
    labelVersion: AUTHORIZED_TEST_SET_LABEL_VERSION,
    sourceType: 'authorized_local_poc_image',
    fileName: normalizedFileName,
    sha256,
    authorizedForLocalPoc: true,
    embedding: embeddingReady ? {
      model: AUTHORIZED_TEST_SET_MODEL,
      dimension: 768,
      vector,
    } : null,
    detectorLabel: normalizedLabel,
    embeddingReady,
    labelReady: labelValidation.valid,
    trainingCandidateReady: embeddingReady && labelValidation.valid,
    labelErrors: labelValidation.valid ? [] : labelValidation.errors,
  };
};

export const buildAuthorizedLabelTemplate = ({ fileName, sha256 } = {}) => ({
  fileName: normalizeAuthorizedTestImageName(fileName),
  sha256: clean(sha256) || null,
  detectorLabel: {
    nudity: null,
    sexualContext: null,
    graphicInjury: null,
    sensitiveSignals: [],
    possibleMinorConcern: null,
    confidence: null,
    uncertaintyFlags: [],
  },
  labelStatus: 'pending_human_label',
});
