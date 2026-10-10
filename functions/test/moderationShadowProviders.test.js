import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShadowProviderConfig,
  runStagingModerationShadow,
  validateShadowSignals,
} from '../moderationShadowProviders.js';

const config = JSON.stringify([
  { id: 'nsfw', endpoint: 'https://nsfw.example.test', tokenEnv: 'ARTES_SHADOW_TOKEN_NSFW' },
  { id: 'safety', endpoint: 'https://safety.example.test' },
]);
const staging = {
  projectId: 'artes-staging',
  image: Buffer.from('synthetic-image-bytes'),
  mimeType: 'image/jpeg',
  env: {
    ARTES_SHADOW_ENABLED: 'true',
    ARTES_SHADOW_PROVIDERS_JSON: config,
    ARTES_SHADOW_TOKEN_NSFW: 'private-test-token',
  },
};
const good = (id, signals = []) => ({
  contractVersion: 1,
  providerId: id,
  modelVersion: 'example-v1',
  uncertain: false,
  signals,
});
const http = (data, ok = true) => ({ ok, text: async () => JSON.stringify(data) });

test('shadow mode is entirely disabled in production even if configured', async () => {
  let calls = 0;
  const result = await runStagingModerationShadow({
    ...staging, projectId: 'artes-media-app',
    fetchImpl: async () => { calls += 1; return http(good('nsfw')); },
  });
  assert.deepEqual(result, { enabled: false, providers: [] });
  assert.equal(calls, 0);
});

test('shadow mode is opt-in in staging and makes zero calls by default', async () => {
  const result = await runStagingModerationShadow({
    ...staging, env: { ARTES_SHADOW_PROVIDERS_JSON: config },
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(result, { enabled: false, providers: [] });
});

test('valid providers run concurrently, do not emit tokens or raw images in results', async () => {
  const called = [];
  const result = await runStagingModerationShadow({
    ...staging,
    fetchImpl: async (url, options) => {
      called.push({ url, options });
      return http(good(url.includes('nsfw') ? 'nsfw' : 'safety', [
        { type: 'sexual_explicit', confidence: 0.6 },
      ]));
    },
  });
  assert.equal(result.enabled, true);
  assert.deepEqual(result.providers.map(({ status }) => status), ['ok', 'ok']);
  assert.deepEqual(result.providers[0].signals, [{ type: 'sexual_explicit', confidence: 0.6 }]);
  assert.equal(called.length, 2);
  assert.equal(called[0].options.headers.Authorization, 'Bearer private-test-token');
  assert.equal(called[1].options.headers.Authorization, undefined);
  assert.equal(called[0].options.redirect, 'error');
  assert.deepEqual(JSON.parse(called[0].options.body).requestedOutputs, ['signals']);
  for (const value of ['synthetic-image-bytes', 'private-test-token', 'https://nsfw.example.test', 'finalOutcome']) {
    assert.equal(JSON.stringify(result).includes(value), false);
  }
});

test('provider response cannot contain a final moderation or publication decision', () => {
  for (const field of ['finalOutcome', 'policyDecision', 'accessLevel', 'publicationState', 'moderationState', 'shouldPublish', 'publishBlocked']) {
    assert.throws(() => validateShadowSignals({ ...good('nsfw'), [field]: 'allowed' }, 'nsfw'),
      /invalid_shadow_response/);
  }
});

test('signal schema rejects unknown categories, duplicates and scores outside zero to one', () => {
  for (const signals of [
    [{ type: 'not_a_category', confidence: 0.5 }],
    [{ type: 'violence', confidence: 1.1 }],
    [{ type: 'violence', confidence: -0.1 }],
    [{ type: 'violence', confidence: '0.5' }],
    [{ type: 'violence', confidence: 0.3 }, { type: 'violence', confidence: 0.7 }],
  ]) {
    assert.throws(() => validateShadowSignals(good('nsfw', signals), 'nsfw'), /invalid_shadow_response/);
  }
});

test('provider configuration enforces HTTPS, no credentials and distinct IDs', () => {
  assert.equal(parseShadowProviderConfig(config).length, 2);
  for (const bad of [
    '[{"id":"nsfw","endpoint":"http://localhost:8000"}]',
    '[{"id":"nsfw","endpoint":"https://alice:secret@example.test"}]',
    '[{"id":"nsfw","endpoint":"https://example.test?url=secret"}]',
    '[{"id":"nsfw","endpoint":"https://example.test"},{"id":"nsfw","endpoint":"https://example.test"}]',
    '[{"id":"nsfw","endpoint":"file:///tmp/secret"}]',
    'not json',
  ]) {
    assert.throws(() => parseShadowProviderConfig(bad), /invalid_shadow_configuration/);
  }
});

test('invalid config and invalid image never call external providers', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return http(good('nsfw')); };
  const configResult = await runStagingModerationShadow({
    ...staging, env: { ARTES_SHADOW_ENABLED: 'true', ARTES_SHADOW_PROVIDERS_JSON: 'not json' }, fetchImpl,
  });
  assert.equal(configResult.configurationError, true);
  const imageResult = await runStagingModerationShadow({ ...staging, image: Buffer.alloc(0), fetchImpl });
  assert.equal(imageResult.skipped, 'invalid_image');
  assert.equal(calls, 0);
});

test('bad response from one model does not suppress a good result from another', async () => {
  const result = await runStagingModerationShadow({
    ...staging,
    fetchImpl: async (url) => url.includes('nsfw')
      ? http({ ...good('nsfw'), finalOutcome: 'allowed' })
      : http(good('safety', [{ type: 'violence', confidence: 0.8 }])),
  });
  assert.deepEqual(result.providers.map((x) => x.status), ['invalid_response', 'ok']);
});

test('failed provider and HTTP errors are status-only; never throw to the moderation pipeline', async () => {
  const result = await runStagingModerationShadow({
    ...staging,
    fetchImpl: async (url) => {
      if (url.includes('nsfw')) throw new Error('private secret backend detail');
      return http({}, false);
    },
  });
  assert.deepEqual(result.providers.map((x) => x.status), ['unavailable', 'http_error']);
  assert.equal(JSON.stringify(result).includes('private secret'), false);
});

test('hanging provider is bounded even if fetch ignores the abort signal', async () => {
  const result = await runStagingModerationShadow({
    ...staging,
    env: { ...staging.env, ARTES_SHADOW_TIMEOUT_MS: '500' },
    fetchImpl: async (url) => url.includes('nsfw')
      ? new Promise(() => {})
      : http(good('safety')),
  });
  assert.deepEqual(result.providers.map((x) => x.status), ['timeout', 'ok']);
  assert.ok(result.providers[0].elapsedMs < 1800);
});


test('five NSFW raw categories remain observations, not explicit-act evidence', async () => {
  const signals = [
    { type: 'nsfw_normal_category', confidence: 0.01 },
    { type: 'nsfw_porn_category', confidence: 0.88 },
    { type: 'nsfw_hentai_category', confidence: 0.02 },
    { type: 'nsfw_drawing_category', confidence: 0.01 },
    { type: 'nsfw_sexy_category', confidence: 0.08 },
  ];
  const result = await runStagingModerationShadow({
    ...staging,
    fetchImpl: async (url) => http(good(url.includes('nsfw') ? 'nsfw' : 'safety', signals)),
  });
  assert.deepEqual(result.providers[0].signals, signals);
  assert.equal(JSON.stringify(result).includes('sexual_explicit'), false);
  assert.equal(JSON.stringify(result).includes('finalOutcome'), false);
  assert.equal(result.providers[0].uncertain, false); // mock uncertainty, never approval
});
