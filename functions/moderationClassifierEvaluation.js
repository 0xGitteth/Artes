import { normalizeGeminiModerationResult } from './geminiModerationContract.js';
import { composeModerationPolicyResult } from './moderationPolicy.js';
import { routeGeminiForbiddenReasons } from './geminiModerationRouting.js';

const NUDITY_LABELS = new Set([
  'none', 'male_topless', 'underwear_swimwear', 'implied_nude',
  'female_bare_breasts', 'bare_buttocks', 'genitalia',
]);
const SEXUAL_CONTEXTS = new Set(['none', 'suggestive', 'bdsm_kink', 'explicit_act']);
const ADULT_NUDITY = new Set(['implied_nude', 'female_bare_breasts', 'bare_buttocks', 'genitalia']);

export const getHumanClassifierExpectation = (label = {}) => {
  if (!NUDITY_LABELS.has(label.nudity) || !SEXUAL_CONTEXTS.has(label.sexualContext)) {
    throw new Error('invalid_human_detector_label');
  }
  const adultDecision = label.sexualContext === 'explicit_act'
    ? 'explicit' : ADULT_NUDITY.has(label.nudity) ? 'borderline' : 'none';
  const access = adultDecision === 'explicit'
    ? 'forbidden' : adultDecision === 'borderline' || label.sexualContext !== 'none' ? 'adult' : 'general';
  return { adultDecision, sexualContext: label.sexualContext, access };
};

export const evaluateClassifierAvailability = (result = {}) => {
  if (result.diagnostics?.safetyBlocked === true) return 'provider_safety_block';
  if (result.error) return 'provider_error';
  if (result.diagnostics?.success !== true || result.diagnostics?.contractValidated !== true
    || !normalizeGeminiModerationResult(result.parsed)) return 'unclassified';
  return 'classified';
};

export const evaluateReviewedClassifierResult = ({ label, result }) => {
  const expected = getHumanClassifierExpectation(label);
  const availability = evaluateClassifierAvailability(result);
  if (availability !== 'classified') {
    return {
      expected, availability, predicted: null, policyProjection: null,
      correct: null, adultDecisionCorrect: null, sexualContextCorrect: null,
      accessCorrect: null, requiresManualReview: true,
    };
  }
  const parsed = result.parsed;
  const hasTrigger = (trigger) => parsed.triggers.some((item) => item.trigger === trigger && item.confidence >= 0.7);
  const sexualContext = parsed.adultDecision === 'explicit'
    ? 'explicit_act' : hasTrigger('kinkBdsm') ? 'bdsm_kink' : hasTrigger('adultEroticSuggestive') ? 'suggestive' : 'none';
  const routed = routeGeminiForbiddenReasons({
    forbiddenReasons: parsed.forbiddenReasons,
    adultDecision: parsed.adultDecision,
    sexualExplicitConfidence: parsed.sexualExplicitConfidence,
  });
  // Run the existing pure policy function with classifier evidence only.
  // SafeSearch, uploader tags, caches, Firestore and publication are outside this test.
  const policy = composeModerationPolicyResult({
    geminiAdultDecision: parsed.adultDecision,
    geminiSexualExplicitConfidence: parsed.sexualExplicitConfidence,
    geminiDiagnostics: result.diagnostics,
    suggestedTriggers: parsed.triggers.map((item) => ({ trigger: item.trigger, score: item.confidence, source: 'gemini', graphic: item.graphic })),
    forbiddenReasons: routed.records,
    explicitDecisionBranchHit: parsed.adultDecision === 'explicit',
    explicitDecisionAddedForbiddenReason: routed.explicitDecisionAddedForbiddenReason,
  });
  const requiresManualReview = policy.outcome === 'review';
  const access = requiresManualReview ? 'review'
    : policy.outcome === 'forbidden' ? 'forbidden'
      : policy.classification.startsWith('allowed_adult_') ? 'adult' : 'general';
  const adultDecisionCorrect = parsed.adultDecision === expected.adultDecision;
  const sexualContextCorrect = sexualContext === expected.sexualContext;
  const accessCorrect = access === expected.access;
  return {
    expected, availability,
    predicted: { adultDecision: parsed.adultDecision, sexualContext, access },
    policyProjection: { outcome: policy.outcome, classification: policy.classification },
    adultDecisionCorrect, sexualContextCorrect, accessCorrect,
    correct: adultDecisionCorrect && sexualContextCorrect && accessCorrect,
    requiresManualReview,
  };
};

export const summarizeClassifierEvaluation = (rows = []) => {
  const classified = rows.filter((row) => row.availability === 'classified');
  const correct = classified.filter((row) => row.correct === true);
  const autoCorrect = correct.filter((row) => row.requiresManualReview !== true);
  const ratio = (count, total) => total ? count / total : null;
  const count = (availability) => rows.filter((row) => row.availability === availability).length;
  const matched = (key) => classified.filter((row) => row[key] === true).length;
  const measured = (key) => classified.filter((row) => typeof row[key] === 'boolean').length;
  const uncertain = rows.filter((row) => row.requiresManualReview === true).length;
  return {
    total: rows.length,
    classified: classified.length,
    correctClassifications: correct.length,
    incorrectClassifications: classified.filter((row) => row.correct === false).length,
    providerSafetyBlocks: count('provider_safety_block'),
    providerErrors: count('provider_error'),
    unclassified: count('unclassified'),
    requiresManualReview: uncertain,
    classifierCoverage: ratio(classified.length, rows.length),
    accuracyAmongClassified: ratio(correct.length, classified.length),
    correctWithoutReviewShare: ratio(autoCorrect.length, rows.length),
    manualReviewShare: ratio(uncertain, rows.length),
    adultDecisionAccuracy: ratio(matched('adultDecisionCorrect'), measured('adultDecisionCorrect')),
    sexualContextAccuracy: ratio(matched('sexualContextCorrect'), measured('sexualContextCorrect')),
    accessAccuracy: ratio(matched('accessCorrect'), measured('accessCorrect')),
    falseGeneralAccess: classified.filter((row) => row.expected?.access === 'adult' && row.predicted?.access === 'general').length,
    falseForbiddenAccess: classified.filter((row) => row.expected?.access !== 'forbidden' && row.predicted?.access === 'forbidden').length,
    missedExplicit: classified.filter((row) => row.expected?.access === 'forbidden' && ['general', 'adult'].includes(row.predicted?.access)).length,
    note: 'Observed research outcomes only. Model confidence is not measured accuracy. No full-app or production readiness claim.',
  };
};
