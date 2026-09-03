import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTES_PRODUCTION_PROJECT_ID,
  ARTES_STAGING_PROJECT_ID,
  MODERATION_RUNTIME_MODES,
  assertRuntimeProviderInvocationAllowed,
  buildManualReviewFallback,
  resolveModerationRuntimeMode,
} from '../moderationRuntimeProvider.js';

test('staging defaults to manual review until custom provider is configured', () => {
  assert.deepEqual(resolveModerationRuntimeMode({ projectId: ARTES_STAGING_PROJECT_ID }), {
    mode: MODERATION_RUNTIME_MODES.manualOnly,
    reason: 'staging_safe_default',
    generativeAllowed: false,
  });
});

test('staging refuses legacy Gemini even when explicitly requested', () => {
  const resolved = resolveModerationRuntimeMode({
    projectId: ARTES_STAGING_PROJECT_ID,
    requestedMode: MODERATION_RUNTIME_MODES.legacyGemini,
  });
  assert.equal(resolved.mode, MODERATION_RUNTIME_MODES.manualOnly);
  assert.equal(resolved.generativeAllowed, false);
  assert.equal(resolved.reason, 'generative_provider_forbidden_in_staging_core_flow');
});

test('staging permits Artes custom provider only after explicit configuration', () => {
  const unavailable = resolveModerationRuntimeMode({
    projectId: ARTES_STAGING_PROJECT_ID,
    requestedMode: MODERATION_RUNTIME_MODES.artesCustom,
    customProviderConfigured: false,
  });
  assert.equal(unavailable.mode, MODERATION_RUNTIME_MODES.manualOnly);

  const available = resolveModerationRuntimeMode({
    projectId: ARTES_STAGING_PROJECT_ID,
    requestedMode: MODERATION_RUNTIME_MODES.artesCustom,
    customProviderConfigured: true,
  });
  assert.equal(available.mode, MODERATION_RUNTIME_MODES.artesCustom);
  assert.equal(available.generativeAllowed, false);
});

test('production defaults preserve current legacy behavior until deliberate migration', () => {
  const resolved = resolveModerationRuntimeMode({ projectId: ARTES_PRODUCTION_PROJECT_ID });
  assert.equal(resolved.mode, MODERATION_RUNTIME_MODES.legacyGemini);
  assert.equal(resolved.reason, 'preserve_existing_production_behavior');
});

test('generative provider invocation is blocked in staging', () => {
  assert.throws(() => assertRuntimeProviderInvocationAllowed({
    projectId: ARTES_STAGING_PROJECT_ID,
    providerGenerative: true,
    mode: MODERATION_RUNTIME_MODES.legacyGemini,
  }), /staging_generative_moderation_provider_forbidden/);
});

test('unknown projects fail closed for generative providers', () => {
  const resolved = resolveModerationRuntimeMode({ projectId: 'unexpected-project' });
  assert.equal(resolved.mode, MODERATION_RUNTIME_MODES.manualOnly);
  assert.throws(() => assertRuntimeProviderInvocationAllowed({
    projectId: 'unexpected-project',
    providerGenerative: true,
    mode: MODERATION_RUNTIME_MODES.legacyGemini,
  }), /unknown_project_generative_provider_forbidden/);
});

test('manual fallback always requires review and forbids automated final policy', () => {
  assert.deepEqual(buildManualReviewFallback({ reason: 'custom_provider_not_ready' }), {
    providerMode: MODERATION_RUNTIME_MODES.manualOnly,
    detectorResult: null,
    forceReview: true,
    reviewReason: 'custom_provider_not_ready',
    automatedPolicyDecisionAllowed: false,
  });
});
