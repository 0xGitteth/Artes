const INTERNAL_SEXUAL_EXPLICIT_TRIGGER = 'sexualExplicit';
const ADULT_ART_NUDE_TRIGGER = 'adultArtNude';
const ADULT_EROTIC_SUGGESTIVE_TRIGGER = 'adultEroticSuggestive';
const ADULT_GRAPHIC_SENSITIVE_TRIGGER = 'adultGraphicSensitive';
const KINK_BDSM_TRIGGER = 'kinkBdsm';
const ART_NUDE_THEME = 'Art Nude';
const MODERATOR_REJECTED_TRIGGER = 'moderatorRejected';
const GEMINI_SAFETY_BLOCK_REVIEW_TRIGGER = 'geminiSafetyBlocked';
const GEMINI_SEMANTIC_CONTRADICTION_REVIEW_TRIGGER = 'geminiSemanticContradiction';
const GEMINI_GRAPHIC_SENSITIVE_UNCERTAIN_REVIEW_TRIGGER = 'geminiGraphicSensitiveUncertain';
const SENSITIVE_WARNING_TRIGGERS = new Set([
  'bloodInjury',
  'selfHarm',
  'suicide',
  'eatingDisorder',
  'substanceDistress',
  'violence',
  'horrorScare',
]);
const GRAPHIC_ADULT_SENSITIVE_TRIGGERS = new Set([
  'bloodInjury',
  'selfHarm',
  'suicide',
  'violence',
]);
const DURABLE_CORRECTION_POLICY_SAFETY_TRIGGERS = new Set([
  ...SENSITIVE_WARNING_TRIGGERS,
  ADULT_GRAPHIC_SENSITIVE_TRIGGER,
]);
const FINALIZED_CORRECTION_ACTIONS = new Set(['acceptCorrection', 'approveWithTaxonomyCorrection']);

const VISION_DIAGNOSTIC_ONLY_TRIGGERS = new Set(['spidersInsects', 'needlesInjections']);
const RAW_VISION_SOURCES = new Set(['labeldetection', 'visionlabel', 'vision', 'cloudvision']);
const MODERATOR_APPROVAL_ACTIONS = new Set(['approveAsIs', 'approveWithTaxonomyCorrection']);
const MODERATOR_REJECTION_ACTION = 'rejectForbidden';
const MODERATOR_CORRECTION_ACTION = 'requestUserCorrection';
const UPLOADER_CORRECTION_REJECTED_ACTION = 'rejectCorrection';
const UPLOADER_CORRECTION_REJECTED_REVIEW_TRIGGER = 'uploaderCorrectionRejected';

const normalizeModeratorAction = (action) => {
  const normalized = String(action || '').trim();
  if (normalized === 'approve') return 'approveAsIs';
  if (normalized === 'reject') return 'rejectForbidden';
  if (normalized === 'acceptCorrection') return 'approveWithTaxonomyCorrection';
  return normalized;
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const normalizeStringArray = (value) => normalizeArray(value).map((item) => String(item || '').trim()).filter(Boolean);
const isRawVisionSource = (source) => RAW_VISION_SOURCES.has(String(source || '').trim().toLowerCase());
const extractTriggerKey = (item) => (typeof item === 'string' ? item : item?.trigger || item?.reason || null);
const isVisionDiagnosticOnlyTrigger = (trigger) => VISION_DIAGNOSTIC_ONLY_TRIGGERS.has(String(trigger || '').trim());

const isRawVisionDerivedRecord = (item) => {
  if (!item || typeof item !== 'object') return false;
  const source = String(item.source || '').trim().toLowerCase();
  return isRawVisionSource(source);
};

const sanitizeRawVisionDerivedRecords = (items = []) => normalizeArray(items)
  .filter((item) => {
    const trigger = extractTriggerKey(item);
    if (isVisionDiagnosticOnlyTrigger(trigger)) return false;
    if (isRawVisionDerivedRecord(item)) return false;
    return true;
  });

const hasReliableGeminiDecision = ({ geminiAdultDecision, geminiDiagnostics }) => (
  geminiDiagnostics?.success === true
  && geminiDiagnostics?.contractValidated === true
  && (geminiAdultDecision === 'none' || geminiAdultDecision === 'borderline' || geminiAdultDecision === 'explicit')
);

const appendPolicyTrigger = (items, trigger, source = 'policyAuto') => (
  items.some((item) => extractTriggerKey(item) === trigger)
    ? items
    : [...items, { trigger, score: 1, source }]
);


const isPolicyOwnedAppliedTrigger = (item) => {
  if (!item || typeof item !== 'object') return false;
  const source = String(item.source || '').trim().toLowerCase();
  return source.startsWith('policy')
    || source === 'moderatorcorrection'
    || source === 'acceptedcorrection';
};

const collectDurableCorrectionPolicySafetyTriggers = (...groups) => {
  const byTrigger = new Map();
  groups.flatMap((group) => normalizeArray(group)).forEach((item) => {
    const trigger = String(extractTriggerKey(item) || '').trim();
    if (!DURABLE_CORRECTION_POLICY_SAFETY_TRIGGERS.has(trigger)) return;
    if (!isPolicyOwnedAppliedTrigger(item)) return;
    if (!byTrigger.has(trigger)) byTrigger.set(trigger, item);
  });
  return [...byTrigger.values()];
};

const appendReviewReason = (items, trigger, reason) => (
  items.some((item) => extractTriggerKey(item) === trigger)
    ? items
    : [...items, { trigger, reason, source: 'geminiDiagnostics' }]
);

const reviewReasonIdentity = (item) => {
  const trigger = String(extractTriggerKey(item) || '').trim();
  const reason = String(typeof item === 'string' ? item : (item?.reason || item?.trigger || '')).trim();
  return trigger || reason ? `${trigger}\u0000${reason}` : '';
};

const collectApprovedReviewReasonIdentities = (exampleData = {}) => new Set([
  ...normalizeArray(exampleData?.aiSnapshot?.forbiddenReasons),
  ...normalizeArray(exampleData?.policyDecision?.forbiddenReasons),
].map(reviewReasonIdentity).filter(Boolean));

export function composeModerationPolicyResult({
  cachedResult = null,
  appliedTriggers = [],
  suggestedTriggers = [],
  forbiddenReasons = [],
  aiSafetySignals = [],
  rawVisionLabels = [],
  normalizedThemes = [],
  normalizedMakerTags = [],
  geminiAdultDecision = null,
  geminiSexualExplicitConfidence = 0,
  explicitDecisionBranchHit = false,
  explicitDecisionAddedForbiddenReason = false,
  shouldRouteByPreviousExample = false,
  matchedModerationExample = null,
  safeSearchAdultScore = 0,
  safeSearchNudityScore = 0,
  forbiddenThreshold = 0.7,
  mediumLogThreshold = 0.4,
  geminiDiagnostics = null,
}) {
  const cachedAppliedTriggers = normalizeArray(cachedResult?.appliedTriggers);
  const cachedSuggestedTriggers = normalizeArray(cachedResult?.suggestedTriggers);
  const cachedForbiddenReasons = normalizeArray(cachedResult?.forbiddenReasons);
  const mergedAiSafetySignals = [...normalizeArray(aiSafetySignals), ...normalizeArray(cachedResult?.aiSafetySignals)];

  if (cachedResult && !mergedAiSafetySignals.length) {
    [...cachedAppliedTriggers, ...cachedSuggestedTriggers, ...cachedForbiddenReasons].forEach((item) => {
      const trigger = extractTriggerKey(item);
      if (isRawVisionDerivedRecord(item) || isVisionDiagnosticOnlyTrigger(trigger)) {
        mergedAiSafetySignals.push({ signal: trigger, score: Number(item?.score) || 0, source: 'cachedLegacy' });
      }
    });
  }

  const previousModeratorDecision = matchedModerationExample?.data?.moderatorDecision || null;
  const rawPreviousModeratorAction = String(previousModeratorDecision?.action || '').trim();
  const previousModeratorAction = normalizeModeratorAction(rawPreviousModeratorAction);
  const shouldApplyPreviousExample = Boolean(shouldRouteByPreviousExample && matchedModerationExample?.data);
  const previousModeratorApproved = shouldApplyPreviousExample && MODERATOR_APPROVAL_ACTIONS.has(previousModeratorAction);
  const previousModeratorRejected = shouldApplyPreviousExample && previousModeratorAction === MODERATOR_REJECTION_ACTION;
  const previousModeratorRequiresCorrection = shouldApplyPreviousExample && previousModeratorAction === MODERATOR_CORRECTION_ACTION;
  const previousUploaderRejectedCorrection = shouldApplyPreviousExample && previousModeratorAction === UPLOADER_CORRECTION_REJECTED_ACTION;
  const previousModeratorActionKnown = MODERATOR_APPROVAL_ACTIONS.has(previousModeratorAction)
    || previousModeratorAction === MODERATOR_REJECTION_ACTION
    || previousModeratorAction === MODERATOR_CORRECTION_ACTION
    || previousModeratorAction === UPLOADER_CORRECTION_REJECTED_ACTION;
  const shouldApplyModeratorTaxonomyCorrection = previousModeratorApproved
    && previousModeratorAction === 'approveWithTaxonomyCorrection';
  const shouldReplaceCachedTaxonomyForModeratorCorrection = shouldApplyModeratorTaxonomyCorrection
    || previousModeratorRequiresCorrection;
  const shouldSurfaceModeratorTaxonomyCorrection = shouldApplyModeratorTaxonomyCorrection || previousModeratorRequiresCorrection;
  const rawModeratorCorrectedTaxonomy = previousModeratorDecision?.correctedTaxonomy
    && typeof previousModeratorDecision.correctedTaxonomy === 'object'
    ? previousModeratorDecision.correctedTaxonomy
    : {};
  const hasStoredModeratorCorrectedTriggers = Array.isArray(rawModeratorCorrectedTaxonomy.triggers);
  const storedModeratorCorrectedThemes = shouldSurfaceModeratorTaxonomyCorrection
    ? normalizeStringArray(rawModeratorCorrectedTaxonomy.themes)
    : [];
  const storedModeratorCorrectedTriggers = shouldSurfaceModeratorTaxonomyCorrection
    ? normalizeStringArray(rawModeratorCorrectedTaxonomy.triggers)
    : [];
  const moderatorCorrectedThemes = previousModeratorRequiresCorrection && storedModeratorCorrectedThemes.length === 0
    ? normalizeStringArray(normalizedThemes)
    : storedModeratorCorrectedThemes;
  const moderatorCorrectedTriggers = previousModeratorRequiresCorrection && !hasStoredModeratorCorrectedTriggers
    ? normalizeStringArray(normalizedMakerTags)
    : storedModeratorCorrectedTriggers;
  const previousCorrectionWasFinalized = shouldApplyPreviousExample
    && FINALIZED_CORRECTION_ACTIONS.has(rawPreviousModeratorAction);
  const durableCorrectionPolicySafetyTriggers = previousCorrectionWasFinalized
    ? collectDurableCorrectionPolicySafetyTriggers(
        cachedAppliedTriggers,
        matchedModerationExample?.data?.aiSnapshot?.appliedTriggers,
        matchedModerationExample?.data?.policyDecision?.appliedPolicyTriggers,
      )
    : [];

  const aiVisionLabels = cachedResult ? normalizeArray(cachedResult?.aiVisionLabels) : normalizeArray(rawVisionLabels);
  const finalAppliedTriggersRaw = shouldReplaceCachedTaxonomyForModeratorCorrection
    ? durableCorrectionPolicySafetyTriggers
    : cachedResult
      ? [...cachedAppliedTriggers, ...normalizeArray(appliedTriggers).filter((item) =>
        !cachedAppliedTriggers.some((cached) => cached?.trigger === item?.trigger && cached?.source === item?.source)
      )]
      : normalizeArray(appliedTriggers);
  let finalAppliedTriggers = sanitizeRawVisionDerivedRecords(finalAppliedTriggersRaw);
  const finalSuggestedTriggersRaw = shouldReplaceCachedTaxonomyForModeratorCorrection
    ? normalizeArray(suggestedTriggers).filter((item) => SENSITIVE_WARNING_TRIGGERS.has(extractTriggerKey(item)))
    : cachedResult
      ? cachedSuggestedTriggers
      : normalizeArray(suggestedTriggers);
  let finalSuggestedTriggers = sanitizeRawVisionDerivedRecords(finalSuggestedTriggersRaw);
  const freshForbiddenReasons = normalizeArray(forbiddenReasons);
  const finalForbiddenReasonsRaw = cachedResult
    ? ((previousModeratorApproved || previousModeratorRequiresCorrection) ? freshForbiddenReasons : cachedForbiddenReasons)
    : freshForbiddenReasons;
  let finalPolicyAppliedTriggers = sanitizeRawVisionDerivedRecords(finalAppliedTriggers);
  let finalForbiddenReasons = sanitizeRawVisionDerivedRecords(finalForbiddenReasonsRaw);

  const highConfidenceSensitiveSignals = finalSuggestedTriggers.filter((item) => (
    item?.source === 'gemini'
    && SENSITIVE_WARNING_TRIGGERS.has(extractTriggerKey(item))
    && Number(item?.score) >= forbiddenThreshold
  ));
  const graphicSensitiveSignals = normalizeArray(geminiDiagnostics?.graphicSensitiveSignals).filter((item) => (
    GRAPHIC_ADULT_SENSITIVE_TRIGGERS.has(extractTriggerKey(item))
  ));
  const highConfidenceGraphicSensitiveSignals = graphicSensitiveSignals.filter((item) => (
    Number(item?.score) >= forbiddenThreshold
  ));
  const mediumConfidenceGraphicSensitiveSignals = graphicSensitiveSignals.filter((item) => (
    Number(item?.score) >= mediumLogThreshold
    && Number(item?.score) < forbiddenThreshold
  ));
  highConfidenceSensitiveSignals.forEach((item) => {
    const trigger = extractTriggerKey(item);
    finalAppliedTriggers = appendPolicyTrigger(finalAppliedTriggers, trigger, 'policySensitive');
    finalPolicyAppliedTriggers = appendPolicyTrigger(finalPolicyAppliedTriggers, trigger, 'policySensitive');
  });
  if (highConfidenceSensitiveSignals.length > 0) {
    const promotedSensitiveTriggers = new Set(highConfidenceSensitiveSignals.map(extractTriggerKey));
    finalSuggestedTriggers = finalSuggestedTriggers.filter((item) => !promotedSensitiveTriggers.has(extractTriggerKey(item)));
  }

  if (shouldApplyModeratorTaxonomyCorrection) {
    moderatorCorrectedTriggers.forEach((trigger) => {
      finalAppliedTriggers = appendPolicyTrigger(finalAppliedTriggers, trigger, 'moderatorCorrection');
      finalPolicyAppliedTriggers = appendPolicyTrigger(finalPolicyAppliedTriggers, trigger, 'moderatorCorrection');
    });
  }

  if (previousModeratorRejected && !finalForbiddenReasons.some((reason) => reason?.trigger === MODERATOR_REJECTED_TRIGGER)) {
    finalForbiddenReasons = [
      ...finalForbiddenReasons,
      {
        trigger: MODERATOR_REJECTED_TRIGGER,
        reason: String(previousModeratorDecision?.reasonCode || 'previous_moderator_rejection'),
        source: 'moderatorExample',
      },
    ];
  }
  if (previousUploaderRejectedCorrection) {
    finalForbiddenReasons = appendReviewReason(
      finalForbiddenReasons,
      UPLOADER_CORRECTION_REJECTED_REVIEW_TRIGGER,
      'uploader_rejected_correction',
    );
  }

  const hasGeminiSafetyBlock = geminiDiagnostics?.safetyBlocked === true;
  const hasGeminiSemanticContradiction = geminiDiagnostics?.contractIssue === 'semantic_contradiction';
  if (hasGeminiSafetyBlock) {
    finalForbiddenReasons = appendReviewReason(
      finalForbiddenReasons,
      GEMINI_SAFETY_BLOCK_REVIEW_TRIGGER,
      String(geminiDiagnostics?.safetyBlockReason || 'vertex_safety_block'),
    );
  }
  if (hasGeminiSemanticContradiction) {
    finalForbiddenReasons = appendReviewReason(
      finalForbiddenReasons,
      GEMINI_SEMANTIC_CONTRADICTION_REVIEW_TRIGGER,
      'gemini_semantic_contradiction',
    );
  }
  if (mediumConfidenceGraphicSensitiveSignals.length > 0) {
    finalForbiddenReasons = appendReviewReason(
      finalForbiddenReasons,
      GEMINI_GRAPHIC_SENSITIVE_UNCERTAIN_REVIEW_TRIGGER,
      'medium_confidence_adult_graphic_signal',
    );
  }

  if (previousModeratorApproved) {
    const previouslyApprovedReviewReasons = collectApprovedReviewReasonIdentities(matchedModerationExample?.data);
    finalForbiddenReasons = finalForbiddenReasons.filter((reason) => {
      const trigger = extractTriggerKey(reason);
      if (trigger === INTERNAL_SEXUAL_EXPLICIT_TRIGGER || trigger === 'reportedContent') return true;
      const identity = reviewReasonIdentity(reason);
      return !identity || !previouslyApprovedReviewReasons.has(identity);
    });
  }

  const effectiveThemes = shouldApplyModeratorTaxonomyCorrection
    ? (moderatorCorrectedThemes.length > 0 ? moderatorCorrectedThemes : normalizeStringArray(normalizedThemes))
    : normalizeStringArray(normalizedThemes);
  const effectiveMakerTags = shouldApplyModeratorTaxonomyCorrection
    ? moderatorCorrectedTriggers
    : normalizeStringArray(normalizedMakerTags);
  const hasSexualExplicitReason = finalForbiddenReasons.some((reason) => reason?.trigger === INTERNAL_SEXUAL_EXPLICIT_TRIGGER);
  const hasReportedContentReason = finalForbiddenReasons.some((reason) => reason?.trigger === 'reportedContent');
  const hasModeratorRejectedReason = finalForbiddenReasons.some((reason) => reason?.trigger === MODERATOR_REJECTED_TRIGGER);
  const hasArtNudeTrigger = finalPolicyAppliedTriggers.some((item) => item.trigger === ADULT_ART_NUDE_TRIGGER);
  const hasGraphicSensitiveAdultTrigger = finalPolicyAppliedTriggers.some((item) => item.trigger === ADULT_GRAPHIC_SENSITIVE_TRIGGER);
  const hasEroticSuggestiveTrigger = finalPolicyAppliedTriggers.some((item) => item.trigger === ADULT_EROTIC_SUGGESTIVE_TRIGGER);
  const hasKinkBdsmTrigger = finalPolicyAppliedTriggers.some((item) => item.trigger === KINK_BDSM_TRIGGER);
  const hasManualEroticSuggestiveTag = effectiveMakerTags.includes(ADULT_EROTIC_SUGGESTIVE_TRIGGER);
  const hasManualKinkBdsmTag = effectiveMakerTags.includes(KINK_BDSM_TRIGGER);
  const hasHighConfidenceGeminiEroticSuggestiveSignal = finalSuggestedTriggers.some((item) => (
    item?.trigger === ADULT_EROTIC_SUGGESTIVE_TRIGGER
    && item?.source === 'gemini'
    && Number(item?.score) >= forbiddenThreshold
  ));
  const hasHighConfidenceGeminiKinkBdsmSignal = finalSuggestedTriggers.some((item) => (
    item?.trigger === KINK_BDSM_TRIGGER
    && item?.source === 'gemini'
    && Number(item?.score) >= forbiddenThreshold
  ));
  const hasGeminiNudityDecision = !shouldApplyModeratorTaxonomyCorrection && geminiAdultDecision === 'borderline';
  const hasGeminiExplicitDecision = geminiAdultDecision === 'explicit';
  const hasKnownNudityEvidence = hasGeminiNudityDecision
    || hasArtNudeTrigger
    || effectiveThemes.includes(ART_NUDE_THEME);
  const hasGraphicSensitiveAdultEvidence = hasGraphicSensitiveAdultTrigger
    || (!shouldApplyModeratorTaxonomyCorrection && highConfidenceGraphicSensitiveSignals.length > 0);
  const hasStrongEroticSuggestiveCorroboration = hasEroticSuggestiveTrigger
    || hasKinkBdsmTrigger
    || hasManualEroticSuggestiveTag
    || hasManualKinkBdsmTag
    || hasHighConfidenceGeminiEroticSuggestiveSignal
    || hasHighConfidenceGeminiKinkBdsmSignal;
  const hasGeminiForbiddenSignal = finalForbiddenReasons.some((reason) => reason?.trigger === 'gemini' || reason?.trigger === 'gemini_uncertain_fallback');
  const hasGeminiUncertainFallbackSuggestion = finalSuggestedTriggers.some((item) => item?.trigger === 'gemini_uncertain_fallback');
  const geminiDecisionIsReliable = hasReliableGeminiDecision({ geminiAdultDecision, geminiDiagnostics });
  const hasMixedAdultSignalsWithoutReliableGemini = !geminiDecisionIsReliable
    && safeSearchAdultScore >= forbiddenThreshold
    && safeSearchNudityScore >= mediumLogThreshold;
  const hasActionableGeminiUncertainFallback = hasGeminiUncertainFallbackSuggestion
    && safeSearchAdultScore >= forbiddenThreshold
    && safeSearchNudityScore >= mediumLogThreshold;
  const hasSevereSignalDisagreement = geminiDecisionIsReliable
    && geminiAdultDecision === 'none'
    && safeSearchAdultScore >= 0.9
    && safeSearchNudityScore >= 0.9;
  const hasCachedReviewOutcome = cachedResult?.outcome === 'review'
    && !previousModeratorApproved
    && !previousModeratorRequiresCorrection;
  const hasFreshReviewReasonAfterApproval = previousModeratorApproved
    && finalForbiddenReasons.some((reason) => {
      const trigger = extractTriggerKey(reason);
      return trigger !== INTERNAL_SEXUAL_EXPLICIT_TRIGGER && trigger !== 'reportedContent';
    });
  const finalApprovalOverridesReviewOnlySignals = previousModeratorApproved
    && !hasSexualExplicitReason
    && !hasReportedContentReason
    && !hasFreshReviewReasonAfterApproval;
  const shouldEscalateToUncertain = !finalApprovalOverridesReviewOnlySignals && !hasSexualExplicitReason && !previousModeratorRejected && (
    hasGeminiForbiddenSignal
    || hasActionableGeminiUncertainFallback
    || hasMixedAdultSignalsWithoutReliableGemini
    || hasSevereSignalDisagreement
    || hasGeminiSafetyBlock
    || hasGeminiSemanticContradiction
    || mediumConfidenceGraphicSensitiveSignals.length > 0
    || hasCachedReviewOutcome
  );
  const hasSexualReviewEvidence = hasGeminiExplicitDecision
    || hasStrongEroticSuggestiveCorroboration
    || hasActionableGeminiUncertainFallback
    || hasMixedAdultSignalsWithoutReliableGemini
    || hasSevereSignalDisagreement
    || safeSearchAdultScore >= mediumLogThreshold
    || safeSearchNudityScore >= mediumLogThreshold;

  let classification = 'allowed_general';
  if (hasSexualExplicitReason || hasReportedContentReason) classification = 'disallowed_sexual_explicit';
  else if (hasModeratorRejectedReason) classification = 'disallowed_moderator_rejected';
  else if (!finalApprovalOverridesReviewOnlySignals && (shouldEscalateToUncertain || hasGeminiExplicitDecision)) classification = 'uncertain_possible_explicit';
  else if (hasGraphicSensitiveAdultEvidence) classification = 'allowed_adult_sensitive_graphic';
  else if (hasKnownNudityEvidence) classification = 'allowed_adult_art_nude';
  else if (hasStrongEroticSuggestiveCorroboration) classification = 'allowed_adult_erotic_suggestive';

  const requiredThemes = [];
  const autoAppliedTriggers = [];
  const isAllowedAdultClassification = classification === 'allowed_adult_art_nude'
    || classification === 'allowed_adult_erotic_suggestive'
    || classification === 'allowed_adult_sensitive_graphic';
  if (isAllowedAdultClassification && hasKnownNudityEvidence) autoAppliedTriggers.push(ADULT_ART_NUDE_TRIGGER);
  if (isAllowedAdultClassification && hasStrongEroticSuggestiveCorroboration) autoAppliedTriggers.push(ADULT_EROTIC_SUGGESTIVE_TRIGGER);
  if (isAllowedAdultClassification && hasGraphicSensitiveAdultEvidence) autoAppliedTriggers.push(ADULT_GRAPHIC_SENSITIVE_TRIGGER);
  if (classification === 'uncertain_possible_explicit') {
    if (hasKnownNudityEvidence) autoAppliedTriggers.push(ADULT_ART_NUDE_TRIGGER);
    if (hasGraphicSensitiveAdultEvidence) autoAppliedTriggers.push(ADULT_GRAPHIC_SENSITIVE_TRIGGER);
    if (hasStrongEroticSuggestiveCorroboration || (hasSexualReviewEvidence && !hasKnownNudityEvidence)) {
      autoAppliedTriggers.push(ADULT_EROTIC_SUGGESTIVE_TRIGGER);
    }
  }

  let persistedAppliedTriggers = finalAppliedTriggers;
  let persistedPolicyAppliedTriggers = finalPolicyAppliedTriggers;
  autoAppliedTriggers.forEach((trigger) => {
    persistedAppliedTriggers = appendPolicyTrigger(persistedAppliedTriggers, trigger);
    persistedPolicyAppliedTriggers = appendPolicyTrigger(persistedPolicyAppliedTriggers, trigger);
  });

  const shouldReview = classification === 'uncertain_possible_explicit';
  const hasStrongForbiddenReason = hasSexualExplicitReason || hasReportedContentReason || hasModeratorRejectedReason;
  const shouldHonorUnknownPreviousExample = shouldApplyPreviousExample && !previousModeratorActionKnown;
  const shouldReviewWithPreviousExample = shouldReview || previousUploaderRejectedCorrection || shouldHonorUnknownPreviousExample;
  const needsCorrection = previousModeratorRequiresCorrection && !hasStrongForbiddenReason && !shouldReviewWithPreviousExample;
  const outcome = hasStrongForbiddenReason ? 'forbidden' : shouldReviewWithPreviousExample ? 'review' : needsCorrection ? 'needsCorrection' : 'allowed';

  return {
    outcome,
    classification,
    shouldReview: shouldReviewWithPreviousExample,
    requiredThemes,
    suggestedTriggers: finalSuggestedTriggers,
    appliedTriggers: persistedAppliedTriggers,
    policyAppliedTriggers: persistedPolicyAppliedTriggers.filter(isPolicyOwnedAppliedTrigger),
    forbiddenReasons: finalForbiddenReasons,
    aiSafetySignals: mergedAiSafetySignals,
    aiVisionLabels,
    userSelectedTaxonomy: { themes: effectiveThemes, triggers: effectiveMakerTags },
    moderatorCorrectedTaxonomy: { themes: moderatorCorrectedThemes, triggers: moderatorCorrectedTriggers },
    moderatorCorrectionApplied: shouldApplyModeratorTaxonomyCorrection,
    aiSuggestedTaxonomy: { triggers: finalSuggestedTriggers },
    publishBlocked: outcome !== 'allowed',
    needsCorrection,
    autoAppliedTriggers,
    moderationSignals: {
      adultDecision: geminiAdultDecision,
      sexualExplicitConfidence: geminiSexualExplicitConfidence,
      explicitDecisionBranchHit,
      explicitDecisionAddedForbiddenReason,
    },
    geminiDiagnostics,
    reviewCaseId: (shouldApplyPreviousExample && previousModeratorActionKnown) ? null : (cachedResult?.reviewCaseId || null),
    previousModeratorExample: matchedModerationExample?.data ? {
      exampleId: matchedModerationExample.id,
      matchedFingerprintType: 'sha256',
      action: previousModeratorAction || null,
      routingApplied: shouldApplyPreviousExample,
    } : null,
  };
}