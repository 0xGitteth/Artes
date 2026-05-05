const INTERNAL_SEXUAL_EXPLICIT_TRIGGER = 'sexualExplicit';
const ADULT_ART_NUDE_TRIGGER = 'adultArtNude';
const ADULT_EROTIC_SUGGESTIVE_TRIGGER = 'adultEroticSuggestive';
const ART_NUDE_THEME = 'Art Nude';

const VISION_DIAGNOSTIC_ONLY_TRIGGERS = new Set(['spidersInsects', 'needlesInjections']);
const RAW_VISION_SOURCES = new Set(['labeldetection', 'visionlabel', 'vision', 'cloudvision']);

const normalizeArray = (value) => (Array.isArray(value) ? value : []);
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
  forbiddenThreshold = 0.75,
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

  const aiVisionLabels = cachedResult ? normalizeArray(cachedResult?.aiVisionLabels) : normalizeArray(rawVisionLabels);
  const finalAppliedTriggersRaw = cachedResult
    ? [...cachedAppliedTriggers, ...normalizeArray(appliedTriggers).filter((item) =>
      !cachedAppliedTriggers.some((cached) => cached?.trigger === item?.trigger && cached?.source === item?.source)
    )]
    : normalizeArray(appliedTriggers);
  const finalAppliedTriggers = sanitizeRawVisionDerivedRecords(finalAppliedTriggersRaw);
  const finalSuggestedTriggersRaw = cachedResult ? cachedSuggestedTriggers : normalizeArray(suggestedTriggers);
  const finalSuggestedTriggers = sanitizeRawVisionDerivedRecords(finalSuggestedTriggersRaw);
  const finalForbiddenReasonsRaw = cachedResult ? cachedForbiddenReasons : normalizeArray(forbiddenReasons);
  const finalPolicyAppliedTriggers = sanitizeRawVisionDerivedRecords(finalAppliedTriggers);
  const finalForbiddenReasons = sanitizeRawVisionDerivedRecords(finalForbiddenReasonsRaw);

  const hasSexualExplicitReason = finalForbiddenReasons.some((reason) => reason?.trigger === INTERNAL_SEXUAL_EXPLICIT_TRIGGER);
  const hasReportedContentReason = finalForbiddenReasons.some((reason) => reason?.trigger === 'reportedContent');
  const hasArtNudeTrigger = finalPolicyAppliedTriggers.some((item) => item.trigger === ADULT_ART_NUDE_TRIGGER);
  const hasEroticSuggestiveTrigger = finalPolicyAppliedTriggers.some((item) => item.trigger === ADULT_EROTIC_SUGGESTIVE_TRIGGER);
  const hasManualEroticSuggestiveTag = normalizedMakerTags.includes(ADULT_EROTIC_SUGGESTIVE_TRIGGER);
  const hasGeminiEroticSuggestiveSignal = finalSuggestedTriggers.some((item) => item?.trigger === ADULT_EROTIC_SUGGESTIVE_TRIGGER && item?.source === 'gemini');
  const hasGeminiExplicitDecision = geminiAdultDecision === 'explicit';
  const hasGeminiAdultSupportSignal = geminiAdultDecision === 'adult';
  const hasStrongEroticSuggestiveCorroboration = hasEroticSuggestiveTrigger
    || hasManualEroticSuggestiveTag
    || hasGeminiEroticSuggestiveSignal
    || hasGeminiAdultSupportSignal;
  const hasGeminiForbiddenSignal = finalForbiddenReasons.some((reason) => reason?.trigger === 'gemini' || reason?.trigger === 'gemini_uncertain_fallback');
  const hasGeminiUncertainFallbackSuggestion = finalSuggestedTriggers.some((item) => item?.trigger === 'gemini_uncertain_fallback');
  const hasMixedAdultSignals = safeSearchAdultScore >= forbiddenThreshold && safeSearchNudityScore >= mediumLogThreshold;
  const shouldEscalateToUncertain = !hasSexualExplicitReason && (hasGeminiForbiddenSignal || hasGeminiUncertainFallbackSuggestion || hasMixedAdultSignals);

  let classification = 'allowed_general';
  if (hasSexualExplicitReason || hasReportedContentReason) classification = 'disallowed_sexual_explicit';
  else if (shouldEscalateToUncertain || hasGeminiExplicitDecision) classification = 'uncertain_possible_explicit';
  else if (hasArtNudeTrigger || normalizedThemes.includes(ART_NUDE_THEME)) classification = 'allowed_adult_art_nude';
  else if (hasStrongEroticSuggestiveCorroboration) classification = 'allowed_adult_erotic_suggestive';

  const requiredThemes = [];
  if (classification === 'allowed_adult_art_nude' && !normalizedThemes.includes(ART_NUDE_THEME)) requiredThemes.push(ART_NUDE_THEME);
  const autoAppliedTriggers = [];
  if (classification === 'allowed_adult_art_nude') autoAppliedTriggers.push(ADULT_ART_NUDE_TRIGGER);
  else if (classification === 'allowed_adult_erotic_suggestive' || classification === 'uncertain_possible_explicit') autoAppliedTriggers.push(ADULT_EROTIC_SUGGESTIVE_TRIGGER);

  const shouldReview = classification === 'uncertain_possible_explicit';
  const hasTaxonomyMismatch = requiredThemes.length > 0;
  const hasStrongForbiddenReason = hasSexualExplicitReason || hasReportedContentReason;
  const needsCorrection = !hasStrongForbiddenReason && !shouldReview && hasTaxonomyMismatch;
  const outcome = hasStrongForbiddenReason ? 'forbidden' : shouldReview ? 'review' : needsCorrection ? 'needsCorrection' : 'allowed';
  const shouldReviewWithPreviousExample = shouldReview || shouldRouteByPreviousExample;

  return {
    outcome,
    classification,
    shouldReview: shouldReviewWithPreviousExample,
    requiredThemes,
    suggestedTriggers: finalSuggestedTriggers,
    appliedTriggers: finalAppliedTriggers,
    policyAppliedTriggers: finalPolicyAppliedTriggers,
    forbiddenReasons: finalForbiddenReasons,
    aiSafetySignals: mergedAiSafetySignals,
    aiVisionLabels,
    userSelectedTaxonomy: { themes: normalizedThemes, triggers: normalizedMakerTags },
    aiSuggestedTaxonomy: { triggers: finalSuggestedTriggers },
    publishBlocked: outcome === 'forbidden' || shouldReviewWithPreviousExample,
    needsCorrection,
    autoAppliedTriggers,
    moderationSignals: {
      adultDecision: geminiAdultDecision,
      sexualExplicitConfidence: geminiSexualExplicitConfidence,
      explicitDecisionBranchHit,
      explicitDecisionAddedForbiddenReason,
    },
    geminiDiagnostics,
    reviewCaseId: cachedResult?.reviewCaseId || null,
    previousModeratorExample: matchedModerationExample?.data ? {
      exampleId: matchedModerationExample.id,
      matchedFingerprintType: 'sha256',
    } : null,
  };
}
