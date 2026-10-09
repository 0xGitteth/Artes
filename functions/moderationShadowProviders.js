import { ARTES_STAGING_PROJECT_ID } from './moderationRuntimeProvider.js';

// An observation-only contract. No detector is allowed to decide what Artes publishes.
export const SHADOW_SIGNAL_TYPES = Object.freeze([
  'nudity', 'sexual_suggestive', 'sexual_explicit', 'possible_minor_concern',
  'violence', 'graphic_injury', 'self_harm', 'eating_disorder_promotion',
  'dangerous_content',
]);
const SIGNAL_SET = new Set(SHADOW_SIGNAL_TYPES);
const FORBIDDEN_POLICY_FIELDS = [
  'finalOutcome', 'policyDecision', 'accessLevel', 'publicationState',
  'moderationState', 'shouldPublish', 'shouldReview', 'publishBlocked',
];
const MAX_PROVIDERS = 3;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_RESPONSE_CHARS = 16_384;
const PROVIDER_ID = /^[a-z][a-z0-9_]{1,39}$/;
const TOKEN_ENV = /^ARTES_SHADOW_TOKEN_[A-Z0-9_]{1,40}$/;
const clean = (value) => (typeof value === 'string' ? value.trim() : '');

export const parseShadowProviderConfig = (json) => {
  if (typeof json !== 'string' || json.length > 4096) throw new Error('invalid_shadow_configuration');
  let raw;
  try { raw = JSON.parse(json); } catch { throw new Error('invalid_shadow_configuration'); }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PROVIDERS) {
    throw new Error('invalid_shadow_configuration');
  }
  const seen = new Set();
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !PROVIDER_ID.test(entry.id || '') || seen.has(entry.id)) {
      throw new Error('invalid_shadow_configuration');
    }
    seen.add(entry.id);
    let url;
    try { url = new URL(entry.endpoint); } catch { throw new Error('invalid_shadow_configuration'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password
      || url.search || url.hash || url.href.length > 512) {
      throw new Error('invalid_shadow_configuration');
    }
    if (entry.tokenEnv !== undefined && !TOKEN_ENV.test(entry.tokenEnv)) {
      throw new Error('invalid_shadow_configuration');
    }
    return {
      id: entry.id,
      endpoint: url.toString().replace(/\/$/, ''),
      tokenEnv: entry.tokenEnv || null,
    };
  });
};

export const validateShadowSignals = (payload, providerId) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || FORBIDDEN_POLICY_FIELDS.some((field) => Object.hasOwn(payload, field))
    || payload.contractVersion !== 1 || payload.providerId !== providerId
    || !clean(payload.modelVersion) || payload.modelVersion.length > 128
    || typeof payload.uncertain !== 'boolean'
    || !Array.isArray(payload.signals) || payload.signals.length > SIGNAL_SET.size) {
    throw new Error('invalid_shadow_response');
  }
  const seen = new Set();
  const signals = payload.signals.map((signal) => {
    if (!signal || typeof signal !== 'object' || Array.isArray(signal)
      || !SIGNAL_SET.has(signal.type) || seen.has(signal.type)
      || typeof signal.confidence !== 'number' || !Number.isFinite(signal.confidence)
      || signal.confidence < 0 || signal.confidence > 1) {
      throw new Error('invalid_shadow_response');
    }
    seen.add(signal.type);
    return { type: signal.type, confidence: signal.confidence };
  });
  return { modelVersion: payload.modelVersion, uncertain: payload.uncertain, signals };
};

const safeTimeout = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(5000, parsed)) : 2500;
};

const queryShadowProvider = async ({ provider, image, mimeType, env, fetchImpl, timeoutMs }) => {
  const started = Date.now();
  const token = provider.tokenEnv ? clean(env[provider.tokenEnv]) : '';
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ providerId: provider.id, status: 'timeout' });
    }, timeoutMs);
  });
  const request = (async () => {
    try {
      const response = await fetchImpl(`${provider.endpoint}/v1/signals`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          contractVersion: 1,
          image: { mimeType, base64: image.toString('base64') },
          requestedOutputs: ['signals'],
        }),
      });
      if (!response?.ok) return { providerId: provider.id, status: 'http_error' };
      const text = await response.text();
      if (typeof text !== 'string' || text.length > MAX_RESPONSE_CHARS) {
        return { providerId: provider.id, status: 'invalid_response' };
      }
      let payload;
      try { payload = JSON.parse(text); } catch {
        return { providerId: provider.id, status: 'invalid_response' };
      }
      try {
        const validated = validateShadowSignals(payload, provider.id);
        return { providerId: provider.id, status: 'ok', ...validated };
      } catch {
        return { providerId: provider.id, status: 'invalid_response' };
      }
    } catch {
      return { providerId: provider.id, status: 'unavailable' };
    }
  })();
  try {
    const result = await Promise.race([request, deadline]);
    return { ...result, elapsedMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
};

// Only for explicit staging opt-in. Results are diagnostics, NEVER policy input.
// Configuration, credentials, response bodies and image bytes are never logged.
export const runStagingModerationShadow = async ({
  projectId,
  image,
  mimeType,
  env = process.env,
  fetchImpl = fetch,
} = {}) => {
  if (projectId !== ARTES_STAGING_PROJECT_ID || env.ARTES_SHADOW_ENABLED !== 'true') {
    return { enabled: false, providers: [] };
  }
  let providers;
  try {
    providers = parseShadowProviderConfig(env.ARTES_SHADOW_PROVIDERS_JSON);
  } catch {
    return { enabled: true, configurationError: true, providers: [] };
  }
  if (!Buffer.isBuffer(image) || image.length === 0 || image.length > MAX_IMAGE_BYTES
    || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
    || typeof fetchImpl !== 'function') {
    return { enabled: true, skipped: 'invalid_image', providers: [] };
  }
  const timeoutMs = safeTimeout(env.ARTES_SHADOW_TIMEOUT_MS);
  const results = await Promise.all(providers.map(async (provider) => {
    try {
      return await queryShadowProvider({ provider, image, mimeType, env, fetchImpl, timeoutMs });
    } catch {
      return { providerId: provider.id, status: 'unavailable' };
    }
  }));
  return { enabled: true, providers: results };
};
