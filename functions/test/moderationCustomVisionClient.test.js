import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomVisionRequest,
  createModerationCustomVisionClient,
  normalizeCustomVisionEndpoint,
} from '../moderationCustomVisionClient.js';
import { DINO_V2_VIT_B14_POC } from '../moderationVisionProvider.js';

const vector = Array.from({ length: 768 }, (_, index) => (index === 0 ? 1 : 0));
const validEmbedding = {
  provider: DINO_V2_VIT_B14_POC.provider,
  model: DINO_V2_VIT_B14_POC.model,
  vector,
};

const response = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  text: async () => JSON.stringify(payload),
});

test('endpoint normalization permits http(s) only', () => {
  assert.equal(normalizeCustomVisionEndpoint('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(normalizeCustomVisionEndpoint('https://vision.example.test/base/'), 'https://vision.example.test/base');
  assert.throws(() => normalizeCustomVisionEndpoint('file:///tmp/model'), /unsupported_custom_vision_endpoint_protocol/);
});

test('request carries only image bytes, mime type and requested provider outputs', () => {
  const built = buildCustomVisionRequest({ buffer: Buffer.from('abc'), mimeType: 'image/jpeg' });
  assert.equal(built.contractVersion, 1);
  assert.deepEqual(built.requestedOutputs, ['embedding', 'detector']);
  assert.equal(built.image.mimeType, 'image/jpeg');
  assert.equal(built.image.base64, Buffer.from('abc').toString('base64'));
  assert.equal(Object.hasOwn(built, 'finalOutcome'), false);
  assert.equal(Object.hasOwn(built, 'policyDecision'), false);
});

test('client validates embedding and returns provider-neutral inference envelope', async () => {
  let calledUrl = null;
  const client = createModerationCustomVisionClient({
    endpoint: 'http://127.0.0.1:8787',
    fetchImpl: async (url) => {
      calledUrl = url;
      return response({ embedding: validEmbedding, detectorResult: null });
    },
  });
  const result = await client.infer({ buffer: Buffer.from('image'), mimeType: 'image/png' });
  assert.equal(calledUrl, 'http://127.0.0.1:8787/v1/infer');
  assert.equal(result.provider, 'artes_custom_vision');
  assert.equal(result.model, 'dinov2_vitb14');
  assert.equal(result.embedding.length, 768);
  assert.equal(result.detectorResult, null);
});

test('client rejects wrong-dimension embeddings', async () => {
  const client = createModerationCustomVisionClient({
    endpoint: 'http://127.0.0.1:8787',
    fetchImpl: async () => response({
      embedding: { ...validEmbedding, vector: [1, 0] },
      detectorResult: null,
    }),
  });
  await assert.rejects(
    () => client.infer({ buffer: Buffer.from('image'), mimeType: 'image/webp' }),
    /invalid_custom_vision_embedding:embedding_dimension_mismatch/,
  );
});

test('client rejects detector output that tries to own final policy', async () => {
  const client = createModerationCustomVisionClient({
    endpoint: 'http://127.0.0.1:8787',
    fetchImpl: async () => response({
      embedding: validEmbedding,
      detectorResult: {
        detectorLabel: {
          nudity: 'none',
          sexualContext: 'none',
          graphicInjury: 'none',
          sensitiveSignals: [],
          possibleMinorConcern: false,
          confidence: 0.9,
          uncertaintyFlags: [],
        },
        modelVersion: 'test-model-v1',
        datasetVersion: 'test-dataset-v1',
        finalOutcome: 'allowed',
      },
    }),
  });
  await assert.rejects(
    () => client.infer({ buffer: Buffer.from('image'), mimeType: 'image/jpeg' }),
    /final_outcome_not_allowed/,
  );
});
