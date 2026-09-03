import {
  DINO_V2_VIT_B14_POC,
  buildVisionInferenceEnvelope,
  validateEmbeddingResult,
  validateDetectorResult,
  validateVisionProviderDescriptor,
} from './moderationVisionProvider.js';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_TIMEOUT_MS = 300000;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const clean = (value) => String(value || '').trim();

export const normalizeCustomVisionEndpoint = (value) => {
  const raw = clean(value);
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('invalid_custom_vision_endpoint');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('unsupported_custom_vision_endpoint_protocol');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
};

export const buildCustomVisionRequest = ({ buffer, mimeType } = {}) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('custom_vision_image_buffer_required');
  }
  const normalizedMime = clean(mimeType).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    throw new Error('custom_vision_unsupported_mime_type');
  }
  return {
    contractVersion: 1,
    image: {
      mimeType: normalizedMime,
      base64: buffer.toString('base64'),
    },
    requestedOutputs: ['embedding', 'detector'],
  };
};

const parseResponseJson = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('custom_vision_invalid_json_response');
  }
};

const resolveHttpErrorCode = (payload, status) => {
  const detail = typeof payload?.detail === 'string' ? payload.detail : null;
  return clean(payload?.code || payload?.error || detail) || `http_${status}`;
};

export const createModerationCustomVisionClient = ({
  endpoint,
  descriptor = DINO_V2_VIT_B14_POC,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) => {
  const normalizedEndpoint = normalizeCustomVisionEndpoint(endpoint);
  if (!normalizedEndpoint) throw new Error('custom_vision_endpoint_required');
  const descriptorValidation = validateVisionProviderDescriptor(descriptor);
  if (!descriptorValidation.valid) {
    throw new Error(`invalid_custom_vision_descriptor:${descriptorValidation.errors.join(',')}`);
  }
  if (typeof fetchImpl !== 'function') throw new Error('custom_vision_fetch_required');
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs))
    ? Math.max(1000, Math.min(Number(timeoutMs), MAX_TIMEOUT_MS))
    : DEFAULT_TIMEOUT_MS;

  const infer = async ({ buffer, mimeType, nearestExamples = [] } = {}) => {
    const requestBody = buildCustomVisionRequest({ buffer, mimeType });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), resolvedTimeoutMs);
    let response;
    try {
      response = await fetchImpl(`${normalizedEndpoint}/v1/infer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('custom_vision_timeout');
      throw new Error(`custom_vision_request_failed:${clean(error?.message) || 'network_error'}`);
    } finally {
      clearTimeout(timer);
    }

    const payload = await parseResponseJson(response);
    if (!response.ok) {
      const safeCode = resolveHttpErrorCode(payload, response.status);
      throw new Error(`custom_vision_http_error:${safeCode.slice(0, 120)}`);
    }

    const embedding = payload?.embedding || null;
    const embeddingValidation = validateEmbeddingResult(embedding, descriptor);
    if (!embeddingValidation.valid) {
      throw new Error(`invalid_custom_vision_embedding:${embeddingValidation.errors.join(',')}`);
    }

    const detectorResult = payload?.detectorResult || null;
    if (detectorResult) {
      const detectorValidation = validateDetectorResult(detectorResult);
      if (!detectorValidation.valid) {
        throw new Error(`invalid_custom_vision_detector:${detectorValidation.errors.join(',')}`);
      }
    }

    return buildVisionInferenceEnvelope({
      descriptor,
      embedding,
      detectorResult,
      nearestExamples,
    });
  };

  return {
    descriptor,
    endpoint: normalizedEndpoint,
    infer,
  };
};
