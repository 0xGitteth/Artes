export const MODERATION_EXAMPLE_SCHEMA_VERSION = 2;

export const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
export const pickOutcome = (v) => (v === 'allowed' || v === 'forbidden' || v === 'review' ? v : null);

export const mapFinalOutcomeByAction = ({ action = null, decision = null } = {}) => {
  if (action === 'queueFreshEvaluation') return 'fresh_eval_queued';
  if (action === 'requestUserCorrection') return 'needs_user_correction';
  if (action === 'acceptCorrection') return 'correction_accepted';
  if (action === 'rejectCorrection') return 'user_disagreed';
  if (decision === 'rejected' || action === 'rejectForbidden') return 'forbidden';
  if (decision === 'approved' || action === 'approveAsIs' || action === 'approveWithTaxonomyCorrection' || action === 'approve') return 'allowed';
  return null;
};

export const mapLearningStatus = ({ action = null, finalOutcome = null } = {}) => {
  if (action === 'queueFreshEvaluation') return 'queued';
  if (action === 'requestUserCorrection') return 'active';
  if (finalOutcome === 'allowed' || finalOutcome === 'forbidden' || finalOutcome === 'correction_accepted') return 'resolved';
  if (finalOutcome === 'user_disagreed') return 'active';
  return 'active';
};

export const buildCommonModerationExample = ({
  source = 'unknown', uploadId = null, reviewCaseId = null, postId = null, uploaderUid = null, fingerprints = null,
  uploadData = {}, reviewData = {}, aiResult = {}, moderationSignals = {}, correctionSnapshot = null,
  decision = null, policyDecisionOutcome = null, moderatorDecision = null, userCorrectionAction = null, uploaderCorrectionResponse = null,
  nowFactory = null,
}) => {
  const reviewAiSummary = reviewData?.aiSummary && typeof reviewData.aiSummary === 'object'
    ? reviewData.aiSummary
    : {};
  const providedModerationSignals = moderationSignals && typeof moderationSignals === 'object' ? moderationSignals : {};
  const reviewModerationSignals = reviewAiSummary?.moderationSignals && typeof reviewAiSummary.moderationSignals === 'object'
    ? reviewAiSummary.moderationSignals
    : {};
  const effectiveModerationSignals = Object.keys(providedModerationSignals).length > 0
    ? providedModerationSignals
    : reviewModerationSignals;
  const safeSearch = effectiveModerationSignals?.safeSearch || effectiveModerationSignals?.safeSearchLikelihoods || null;
  const visionRaw = Array.isArray(aiResult?.visionLabelsRaw) ? aiResult.visionLabelsRaw : toArray(aiResult?.visionLabels);
  const visionNorm = Array.isArray(aiResult?.visionLabelsNormalized) ? aiResult.visionLabelsNormalized : [];
  const aiThemes = Array.isArray(aiResult?.suggestedThemes)
    ? toArray(aiResult.suggestedThemes)
    : toArray(uploadData?.suggestedThemes || uploadData?.aiSuggestedTaxonomy?.themes);
  const aiTriggers = Array.isArray(aiResult?.suggestedTriggers)
    ? toArray(aiResult.suggestedTriggers)
    : toArray(uploadData?.suggestedTriggers || uploadData?.aiSuggestedTaxonomy?.triggers || reviewAiSummary?.suggestedTriggers || reviewAiSummary?.aiSuggestedTaxonomy?.triggers);
  const aiAppliedTriggers = Array.isArray(aiResult?.appliedTriggers)
    ? toArray(aiResult.appliedTriggers)
    : toArray(uploadData?.appliedTriggers || reviewAiSummary?.appliedTriggers || reviewAiSummary?.policyAppliedTriggers);
  const aiForbiddenReasons = Array.isArray(aiResult?.forbiddenReasons)
    ? toArray(aiResult.forbiddenReasons)
    : toArray(uploadData?.forbiddenReasons || reviewAiSummary?.forbiddenReasons);
  const aiRequiredThemes = Array.isArray(aiResult?.requiredThemes)
    ? toArray(aiResult.requiredThemes)
    : toArray(uploadData?.requiredThemes);
  const aiClassification = aiResult?.classification
    ?? uploadData?.classification
    ?? reviewAiSummary?.classification
    ?? null;
  const aiShouldReview = typeof aiResult?.shouldReview === 'boolean'
    ? aiResult.shouldReview
    : typeof uploadData?.shouldReview === 'boolean'
      ? uploadData.shouldReview
      : (typeof reviewAiSummary?.shouldReview === 'boolean' ? reviewAiSummary.shouldReview : null);
  const aiGeminiDiagnostics = aiResult?.geminiDiagnostics || uploadData?.geminiDiagnostics || reviewAiSummary?.geminiDiagnostics || null;
  const userTaxRoles = toArray(uploadData?.roles || uploadData?.postDraft?.roles);
  const now = nowFactory ? nowFactory() : null;

  const finalOutcome = mapFinalOutcomeByAction({ action: moderatorDecision?.action || null, decision });
  const learningStatus = mapLearningStatus({ action: moderatorDecision?.action || null, finalOutcome });
  const aiOutcome = pickOutcome(aiResult?.outcome ?? uploadData?.outcome);
  const comparableFinal = finalOutcome === 'forbidden' ? 'forbidden' : finalOutcome === 'allowed' ? 'allowed' : null;
  const agreed = Boolean(aiOutcome && comparableFinal && aiOutcome === comparableFinal);
  let mismatchType = agreed ? 'none' : null;
  if (!agreed && aiOutcome && comparableFinal) mismatchType = aiOutcome === 'forbidden' && comparableFinal === 'allowed' ? 'ai_overstrict' : aiOutcome === 'allowed' && comparableFinal === 'forbidden' ? 'ai_understrict' : 'wrong_taxonomy';

  const uploaderInput = {
    themes: toArray(uploadData?.themes || uploadData?.postDraft?.styles),
    makerTags: toArray(uploadData?.makerTags || uploadData?.postDraft?.makerTags),
    title: uploadData?.title || null,
    description: uploadData?.description || null,
  };
  const aiSnapshot = {
    outcome: pickOutcome(policyDecisionOutcome || aiResult?.outcome),
    classification: aiClassification,
    shouldReview: aiShouldReview,
    appliedTriggers: aiAppliedTriggers,
    suggestedTriggers: aiTriggers,
    forbiddenReasons: aiForbiddenReasons,
    requiredThemes: aiRequiredThemes,
    suggestedThemes: aiThemes,
    adultDecision: effectiveModerationSignals?.adultDecision ?? null,
    sexualExplicitConfidence: effectiveModerationSignals?.sexualExplicitConfidence ?? null,
    geminiDiagnostics: aiGeminiDiagnostics,
  };

  return {
    schemaVersion: MODERATION_EXAMPLE_SCHEMA_VERSION,
    source,
    caseType: reviewData?.caseType || (uploadId ? 'upload' : null),
    uploadId,
    reviewCaseId,
    postId,
    fingerprints: fingerprints || null,
    uploaderUid,
    decidedAt: now,
    createdAt: now,
    policyVersion: uploadData?.policyVersion || reviewData?.policyVersion || null,
    moderatorDecision,
    uploaderCorrectionResponse: uploaderCorrectionResponse || null,
    userCorrectionAction: userCorrectionAction || null,
    uploaderInput,
    aiSnapshot,
    correction: correctionSnapshot || null,
    finalOutcome,
    learningStatus,
    userSelectedTaxonomy: { themes: uploaderInput.themes, triggers: uploaderInput.makerTags, tags: toArray(uploadData?.tags), roles: userTaxRoles },
    aiSuggestedTaxonomy: { suggestedThemes: aiThemes, suggestedTriggers: aiTriggers, confidence: aiResult?.suggestedConfidence ?? null },
    aiSafetySignals: {
      safeSearch,
      geminiAdultDecision: effectiveModerationSignals?.adultDecision ?? null,
      explicitnessConfidence: effectiveModerationSignals?.sexualExplicitConfidence ?? null,
      nuditySignal: effectiveModerationSignals?.nuditySignal ?? effectiveModerationSignals?.nudityOrGenitalVisibility ?? null,
      uncertaintyFlags: toArray(aiResult?.uncertaintyFlags),
    },
    aiVisionLabels: { rawLabels: visionRaw, normalizedLabels: visionNorm, confidenceScores: aiResult?.visionLabelScores || null },
    policyDecision: {
      outcome: pickOutcome(policyDecisionOutcome || aiResult?.outcome),
      shouldReview: aiShouldReview,
      forbiddenReasons: aiForbiddenReasons,
      appliedPolicyTriggers: aiAppliedTriggers,
      requiredThemes: aiRequiredThemes,
      needsCorrection: Boolean(correctionSnapshot),
    },
    analytics: { aiModeratorAgreed: agreed, mismatchType, visionContributedToError: Boolean(!agreed && (visionRaw.length || visionNorm.length)) },
    provenance: {
      sourceEndpoint: source,
      policyVersion: uploadData?.policyVersion || reviewData?.policyVersion || null,
      modelVersions: aiResult?.modelVersions || effectiveModerationSignals?.modelVersions || null,
      createdAt: now,
      updatedAt: now,
    },
  };
};
