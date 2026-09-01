import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DINO_V2_VIT_B14_POC,
  buildVisionInferenceEnvelope,
  validateDetectorResult,
  validateEmbeddingResult,
  validateVisionProviderDescriptor,
} from '../moderationVisionProvider.js';

const validLabel = () => ({
  nudity: 'underwear_swimwear',
  sexualContext: 'suggestive',
  graphicInjury: 'none',
  sensitiveSignals: [],
  possibleMinorConcern: false,
  confidence: 0.91,
  uncertaintyFlags: [],
});

test('DINOv2 POC descriptor is explicitly non-generative and within vector limits', () => {
  const validation = validateVisionProviderDescriptor(DINO_V2_VIT_B14_POC);
  assert.equal(validation.valid, true);
  assert.equal(DINO_V2_VIT_B14_POC.generative, false);
  assert.equal(DINO_V2_VIT_B14_POC.embeddingDimension, 768);
});

test('provider contract rejects generative descriptors', () => {
  const validation = validateVisionProviderDescriptor({
    ...DINO_V2_VIT_B14_POC,
    provider: 'some_generative_provider',
    generative: true,
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('generative_provider_not_allowed_by_contract'));
});

test('embedding results must match the declared provider, model and dimension', () => {
  const valid = validateEmbeddingResult({
    provider: DINO_V2_VIT_B14_POC.provider,
    model: DINO_V2_VIT_B14_POC.model,
    vector: new Array(768).fill(0.01),
  }, DINO_V2_VIT_B14_POC);
  assert.equal(valid.valid, true);

  const wrongDimension = validateEmbeddingResult({
    provider: DINO_V2_VIT_B14_POC.provider,
    model: DINO_V2_VIT_B14_POC.model,
    vector: [0.1, 0.2],
  }, DINO_V2_VIT_B14_POC);
  assert.equal(wrongDimension.valid, false);
  assert.ok(wrongDimension.errors.includes('embedding_dimension_mismatch'));
});

test('detector results cannot smuggle final Artes policy decisions into the model layer', () => {
  const clean = validateDetectorResult({
    detectorLabel: validLabel(),
    modelVersion: 'artes-detector-poc-1',
    datasetVersion: 'dataset-2026-09-poc-1',
  });
  assert.equal(clean.valid, true);

  const invalid = validateDetectorResult({
    detectorLabel: validLabel(),
    modelVersion: 'artes-detector-poc-1',
    datasetVersion: 'dataset-2026-09-poc-1',
    finalOutcome: 'allowed',
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes('final_outcome_not_allowed'));
});

test('inference envelope keeps semantic evidence ordered without making a policy decision', () => {
  const envelope = buildVisionInferenceEnvelope({
    descriptor: DINO_V2_VIT_B14_POC,
    embedding: {
      provider: DINO_V2_VIT_B14_POC.provider,
      model: DINO_V2_VIT_B14_POC.model,
      vector: new Array(768).fill(0.01),
    },
    detectorResult: {
      detectorLabel: validLabel(),
      modelVersion: 'artes-detector-poc-1',
      datasetVersion: 'dataset-2026-09-poc-1',
    },
    nearestExamples: [
      { exampleId: 'far', distance: 0.3, detectorLabel: validLabel(), labelVersion: 'artes_detector_v1' },
      { exampleId: 'near', distance: 0.1, detectorLabel: validLabel(), labelVersion: 'artes_detector_v1' },
    ],
  });

  assert.deepEqual(envelope.nearestExamples.map((item) => item.exampleId), ['near', 'far']);
  assert.equal(Object.hasOwn(envelope, 'finalOutcome'), false);
  assert.equal(Object.hasOwn(envelope, 'policyDecision'), false);
});
