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
  const safeSearch = moderationSignals?.safeSearch || moderationSignals?.safeSearchLikelihoods || null;
  const visionRaw = Array.isArray(aiResult?.visionLabelsRaw) ? aiResult.visionLabelsRaw : toArray(aiResult?.visionLabels);
  const visionNorm = Array.isArray(aiResult?.visionLabelsNormalized) ? aiResult.visionLabelsNormalized : [];
  const aiThemes = toArray(aiResult?.suggestedThemes);
  const aiTriggers = toArray(aiResult?.suggestedTriggers);
  const userTaxRoles = toArray(uploadData?.roles || uploadData?.postDraft?.roles);
  const now = nowFactory ? nowFactory() : null;

  const finalOutcome = mapFinalOutcomeByAction({ action: moderatorDecision?.action || null, decision });
  const learningStatus = mapLearningStatus({ action: moderatorDecision?.action || null, finalOutcome });
  const aiOutcome = pickOutcome(aiResult?.outcome);
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
    classification: aiResult?.classification || null,
    shouldReview: typeof aiResult?.shouldReview === 'boolean' ? aiResult.shouldReview : null,
    appliedTriggers: toArray(aiResult?.appliedTriggers),
    suggestedTriggers: aiTriggers,
    forbiddenReasons: toArray(aiResult?.forbiddenReasons),
    requiredThemes: toArray(aiResult?.requiredThemes),
    suggestedThemes: aiThemes,
    adultDecision: moderationSignals?.adultDecision ?? null,
    sexualExplicitConfidence: moderationSignals?.sexualExplicitConfidence ?? null,
    geminiDiagnostics: aiResult?.geminiDiagnostics || null,
  };

  return {
    schemaVersion: MODERATION_EXAMPLE_SCHEMA_VERSION,
    source,
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
      geminiAdultDecision: moderationSignals?.adultDecision ?? null,
      explicitnessConfidence: moderationSignals?.sexualExplicitConfidence ?? null,
      nuditySignal: moderationSignals?.nuditySignal ?? moderationSignals?.nudityOrGenitalVisibility ?? null,
      uncertaintyFlags: toArray(aiResult?.uncertaintyFlags),
    },
    aiVisionLabels: { rawLabels: visionRaw, normalizedLabels: visionNorm, confidenceScores: aiResult?.visionLabelScores || null },
    policyDecision: {
      outcome: pickOutcome(policyDecisionOutcome || aiResult?.outcome),
      shouldReview: typeof aiResult?.shouldReview === 'boolean' ? aiResult.shouldReview : null,
      forbiddenReasons: toArray(aiResult?.forbiddenReasons),
      appliedPolicyTriggers: toArray(aiResult?.appliedTriggers),
      requiredThemes: toArray(aiResult?.requiredThemes),
      needsCorrection: Boolean(correctionSnapshot),
    },
    analytics: { aiModeratorAgreed: agreed, mismatchType, visionContributedToError: Boolean(!agreed && (visionRaw.length || visionNorm.length)) },
    provenance: {
      sourceEndpoint: source,
      policyVersion: uploadData?.policyVersion || reviewData?.policyVersion || null,
      modelVersions: aiResult?.modelVersions || moderationSignals?.modelVersions || null,
      createdAt: now,
      updatedAt: now,
    },
  };
};
