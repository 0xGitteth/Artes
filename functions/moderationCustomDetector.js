import { normalizeArtesDetectorLabel } from './moderationLearningDataset.js';
import { validateDetectorResult } from './moderationVisionProvider.js';
import { createModerationCustomVisionClient } from './moderationCustomVisionClient.js';

export const CUSTOM_DETECTOR_POLICY_VERSION = 'artes_detector_policy_v1';
const NUDE = new Set(['implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia']);
export const getCustomDetectorClass = (label) => {
  if (label?.sexualContext === 'explicit_act') return 'explicit';
  if (label?.graphicInjury !== 'none' || label?.sensitiveSignals?.length) return 'sensitive';
  if (NUDE.has(label?.nudity)) return 'adult_nudity';
  if (['suggestive', 'bdsm_kink'].includes(label?.sexualContext)) return 'erotic';
  return 'general';
};

// Release approval is server configuration, never a claim from the vision endpoint.
export const assessCustomDetectorAutomation = ({ detectorResult, approval = null } = {}) => {
  const validation = validateDetectorResult(detectorResult || {});
  const label = normalizeArtesDetectorLabel(detectorResult?.detectorLabel);
  const review = reason => ({ automated: false, reason, detectorLabel: label, classKey: label ? getCustomDetectorClass(label) : null });
  if (!validation.valid || !label) return review('custom_detector_missing_or_invalid');
  if (label.possibleMinorConcern) return review('possible_minor_concern');
  if (label.uncertaintyFlags.length) return review('detector_uncertainty');
  if (approval?.approved !== true || approval?.policyVersion !== CUSTOM_DETECTOR_POLICY_VERSION) return review('model_not_approved');
  if (approval.modelVersion !== detectorResult.modelVersion || approval.datasetVersion !== detectorResult.datasetVersion) return review('approved_model_version_mismatch');
  if (detectorResult.labelVersion !== 'artes_detector_v1' || approval.labelVersion !== detectorResult.labelVersion) return review('detector_label_version_mismatch');
  // Current policy schema lacks encouragement/instruction and total-impact evidence.
  // Keep such cases in review until the richer sensitive contract is validated.
  if (label.graphicInjury !== 'none' || label.sensitiveSignals.length) return review('sensitive_context_requires_review');
  const classKey = getCustomDetectorClass(label);
  const gate = approval.classes?.[classKey];
  if (!gate || gate.validated !== true || !Number.isFinite(gate.minConfidence) || gate.minConfidence < 0.9 || gate.minConfidence > 1) return review('class_not_calibrated');
  if (!Number.isInteger(gate.heldOutGroups) || gate.heldOutGroups < 20
    || !Number.isInteger(gate.heldOutExamples) || gate.heldOutExamples < 100
    || gate.heldOutGroups > gate.heldOutExamples
    || gate.criticalMisses !== 0 || !Number.isFinite(gate.precisionLowerBound)
    || gate.precisionLowerBound < 0.99 || gate.precisionLowerBound > 1) return review('benchmark_gate_not_met');
  if (label.confidence < gate.minConfidence) return review('below_calibrated_threshold');
  return { automated: true, reason: 'calibrated_model_decision', detectorLabel: label, classKey };
};

export const buildCustomDetectorPolicyEvidence = (assessment) => {
  if (assessment?.automated !== true) return null;
  const label = normalizeArtesDetectorLabel(assessment.detectorLabel);
  if (!label || label.possibleMinorConcern || label.uncertaintyFlags.length || label.graphicInjury !== 'none' || label.sensitiveSignals.length) return null;
  const appliedTriggers = [];
  const add = trigger => appliedTriggers.push({ trigger, score: label.confidence, source: 'policyCustomDetector' });
  if (NUDE.has(label.nudity)) add('adultArtNude');
  if (['suggestive', 'bdsm_kink'].includes(label.sexualContext)) add('adultEroticSuggestive');
  if (label.sexualContext === 'bdsm_kink') add('kinkBdsm');
  const explicit = label.sexualContext === 'explicit_act';
  return {
    appliedTriggers,
    forbiddenReasons: explicit ? [{ trigger: 'sexualExplicit', reason: 'visible_explicit_sexual_act', score: label.confidence, source: 'artesCustomDetector' }] : [],
    adultDecision: explicit ? 'explicit' : NUDE.has(label.nudity) ? 'borderline' : 'none',
    sexualExplicitConfidence: explicit ? label.confidence : 0,
    reliable: true,
  };
};

export const enforceCustomDetectorReview = ({ policyResult, assessment, previousAuthority = false } = {}) => {
  if (assessment?.automated === true || previousAuthority || policyResult?.outcome === 'forbidden') return policyResult;
  return {
    ...policyResult,
    outcome: 'review', classification: 'uncertain_custom_detector', shouldReview: true, publishBlocked: true,
    forbiddenReasons: [...(policyResult?.forbiddenReasons || []), { trigger: 'customDetectorReview', reason: assessment?.reason || 'custom_detector_unavailable', source: 'artesCustomDetector' }],
  };
};

export const runCustomDetectorInference = async ({ image, releaseJson = null, ...clientOptions } = {}) => {
  try {
    const approval = releaseJson ? JSON.parse(releaseJson) : null;
    const inference = await createModerationCustomVisionClient(clientOptions).infer(image);
    const assessment = assessCustomDetectorAutomation({ detectorResult: inference.detectorResult, approval });
    const evidence = buildCustomDetectorPolicyEvidence(assessment);
    return {
      assessment: evidence ? assessment : { ...assessment, automated: false }, evidence,
      diagnostics: {
        attempted: true, automated: Boolean(evidence), reason: assessment.reason,
        modelVersion: inference.detectorResult?.modelVersion || null,
        datasetVersion: inference.detectorResult?.datasetVersion || null,
        labelVersion: inference.detectorResult?.labelVersion || null,
        classKey: assessment.classKey, detectorLabel: assessment.detectorLabel,
      },
    };
  } catch {
    return {
      assessment: { automated: false, reason: 'custom_detector_unavailable' }, evidence: null,
      diagnostics: { attempted: true, automated: false, reason: 'custom_detector_unavailable' },
    };
  }
};
