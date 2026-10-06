import { evaluateClassifierAvailability } from './moderationClassifierEvaluation.js';
import { routeGeminiForbiddenReasons } from './geminiModerationRouting.js';

const DURABLE_ADULT_CONTEXT_CONFIDENCE = 0.7;

const forbiddenReasons = (parsed) => (
  Array.isArray(parsed?.forbiddenReasons) ? parsed.forbiddenReasons : []
);

const hasTrigger = (parsed, trigger, minConfidence = 0) => (
  Array.isArray(parsed?.triggers)
  && parsed.triggers.some((item) => (
    item?.trigger === trigger
    && typeof item?.confidence === 'number'
    && item.confidence >= minConfidence
  ))
);

const hasDurableAdultContext = (parsed) => (
  hasTrigger(parsed, 'adultEroticSuggestive', DURABLE_ADULT_CONTEXT_CONFIDENCE)
  || hasTrigger(parsed, 'kinkBdsm', DURABLE_ADULT_CONTEXT_CONFIDENCE)
);

export const getGoldenClassifierExpectationFailure = ({ id, result }) => {
  const parsed = result?.parsed || null;
  const safetyBlocked = result?.diagnostics?.safetyBlocked === true;

  if (safetyBlocked) return `${id}: provider refusal does not satisfy automatic Artes classification; an independently validated detector decision is required`;
  if (evaluateClassifierAvailability(result) !== 'classified') return `${id}: expected a validated classifier result`;

  if (id === 'ADULT_BDSM_01') {
    if (parsed.adultDecision !== 'none') return `${id}: covered BDSM/kink must not be labelled as nudity`;
    if (forbiddenReasons(parsed).length) return `${id}: covered non-explicit BDSM/kink must not be forbidden`;
    if (!hasTrigger(parsed, 'adultEroticSuggestive', DURABLE_ADULT_CONTEXT_CONFIDENCE)) return `${id}: missing durable adultEroticSuggestive trigger`;
    if (!hasTrigger(parsed, 'kinkBdsm', DURABLE_ADULT_CONTEXT_CONFIDENCE)) return `${id}: missing durable kinkBdsm trigger`;
    return null;
  }

  if (id === 'BOUDOIR_01') {
    if (parsed.adultDecision !== 'none') return `${id}: covered ordinary boudoir must remain non-nude`;
    if (forbiddenReasons(parsed).length) return `${id}: covered ordinary boudoir must not be forbidden`;
    if (hasDurableAdultContext(parsed)) return `${id}: ordinary boudoir must not gain durable erotic/kink adult context`;
    return null;
  }

  if (id === 'BORDERLINE_01') {
    if (parsed.adultDecision !== 'borderline') return `${id}: visible genitalia without a visible sex act must remain borderline adult nudity`;
    if (forbiddenReasons(parsed).includes('sexualExplicit')) return `${id}: visible genitalia alone must not become sexualExplicit`;
    if (forbiddenReasons(parsed).length) return `${id}: clear non-explicit nudity must be automatically allowed for adults, not sent to review`;
    if (!(typeof parsed.sexualExplicitConfidence === 'number' && parsed.sexualExplicitConfidence < 0.5)) return `${id}: non-explicit nudity must keep sexualExplicitConfidence below 0.5`;
    return null;
  }

  if (id === 'EXPLICIT_01') {
    if (parsed.adultDecision !== 'explicit') return `${id}: visible explicit sexual act must be explicit`;
    if (!forbiddenReasons(parsed).includes('sexualExplicit')) return `${id}: explicit sexual act must include sexualExplicit forbidden reason`;
    const routed = routeGeminiForbiddenReasons({
      forbiddenReasons: parsed.forbiddenReasons,
      adultDecision: parsed.adultDecision,
      sexualExplicitConfidence: parsed.sexualExplicitConfidence,
    });
    if (!routed.explicitDecisionAddedForbiddenReason) return `${id}: clear explicit act must reach automatic prohibition under the existing policy, not review`;
    return null;
  }

  return `${id}: no golden classifier expectation is defined`;
};
