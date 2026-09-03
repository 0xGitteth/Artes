export const MODERATION_RUNTIME_MODES = Object.freeze({
  legacyGemini: 'legacy_gemini',
  artesCustom: 'artes_custom_vision',
  manualOnly: 'manual_review_only',
});

export const ARTES_STAGING_PROJECT_ID = 'artes-staging';
export const ARTES_PRODUCTION_PROJECT_ID = 'artes-media-app';

const clean = (value) => String(value || '').trim();

export const resolveModerationRuntimeMode = ({
  projectId,
  requestedMode = null,
  customProviderConfigured = false,
} = {}) => {
  const project = clean(projectId);
  const requested = clean(requestedMode);

  if (project === ARTES_STAGING_PROJECT_ID) {
    if (requested === MODERATION_RUNTIME_MODES.legacyGemini) {
      return {
        mode: MODERATION_RUNTIME_MODES.manualOnly,
        reason: 'generative_provider_forbidden_in_staging_core_flow',
        generativeAllowed: false,
      };
    }
    if (requested === MODERATION_RUNTIME_MODES.artesCustom && customProviderConfigured) {
      return {
        mode: MODERATION_RUNTIME_MODES.artesCustom,
        reason: 'custom_provider_configured',
        generativeAllowed: false,
      };
    }
    return {
      mode: MODERATION_RUNTIME_MODES.manualOnly,
      reason: requested === MODERATION_RUNTIME_MODES.artesCustom
        ? 'custom_provider_not_configured'
        : 'staging_safe_default',
      generativeAllowed: false,
    };
  }

  if (project === ARTES_PRODUCTION_PROJECT_ID) {
    return {
      mode: requested || MODERATION_RUNTIME_MODES.legacyGemini,
      reason: requested ? 'explicit_production_mode' : 'preserve_existing_production_behavior',
      generativeAllowed: true,
    };
  }

  return {
    mode: MODERATION_RUNTIME_MODES.manualOnly,
    reason: 'unknown_project_fail_closed',
    generativeAllowed: false,
  };
};

export const assertRuntimeProviderInvocationAllowed = ({
  projectId,
  providerGenerative = false,
  mode,
} = {}) => {
  const project = clean(projectId);
  const runtimeMode = clean(mode);

  if (project === ARTES_STAGING_PROJECT_ID && providerGenerative) {
    throw new Error('staging_generative_moderation_provider_forbidden');
  }
  if (runtimeMode === MODERATION_RUNTIME_MODES.manualOnly && providerGenerative) {
    throw new Error('manual_only_mode_provider_invocation_forbidden');
  }
  if (project !== ARTES_PRODUCTION_PROJECT_ID
    && project !== ARTES_STAGING_PROJECT_ID
    && providerGenerative) {
    throw new Error('unknown_project_generative_provider_forbidden');
  }
  return true;
};

export const buildManualReviewFallback = ({ reason = 'detector_unavailable' } = {}) => ({
  providerMode: MODERATION_RUNTIME_MODES.manualOnly,
  detectorResult: null,
  forceReview: true,
  reviewReason: clean(reason) || 'detector_unavailable',
  automatedPolicyDecisionAllowed: false,
});
