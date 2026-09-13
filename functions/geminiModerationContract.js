export const GEMINI_MODERATION_PROMPT_VERSION = 'gemini_moderation_v2';
export const DEFAULT_GEMINI_MODERATION_MODEL = 'gemini-2.5-flash';
const DURABLE_ADULT_CONTEXT_CONFIDENCE = 0.7;

const SAFETY_BLOCK_FINISH_REASONS = new Set([
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'MODEL_ARMOR',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'SPII',
]);
const FORBIDDEN_AS_SUGGESTION_TRIGGERS = new Set([
  'sexualExplicit',
  'possible_minor_concern',
]);
const SUPPORTED_GEMINI_TRIGGER_IDS = new Set([
  'adultEroticSuggestive',
  'kinkBdsm',
  'bloodInjury',
  'selfHarm',
  'suicide',
  'eatingDisorder',
  'substanceDistress',
  'violence',
  'horrorScare',
  'sexualExplicit',
  'possible_minor_concern',
]);
const SUPPORTED_FORBIDDEN_REASON_IDS = new Set([
  'sexualExplicit',
  'sexual_explicit_uncertain',
  'possible_minor_concern',
  'other_safety_review',
]);
const SENSITIVE_GRAPHIC_METADATA_TRIGGERS = new Set([
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

export const buildGeminiModerationPrompt = () => [
  'You are the image-safety detector for Artes, a creative portfolio and community platform.',
  'Return ONLY one valid JSON object and no markdown.',
  'Schema: {"triggers": [{"trigger": string, "confidence": number, "severity": "suggest", "graphic": boolean}], "forbiddenReasons": ["sexualExplicit"|"sexual_explicit_uncertain"|"possible_minor_concern"|"other_safety_review"], "adultDecision": "none"|"borderline"|"explicit", "sexualExplicitConfidence": number}.',
  '',
  'adultDecision describes nudity / sexual explicitness only:',
  '- "none": no clear adult nudity and no explicit sexual act.',
  '- "borderline": adult-only nudity is present or clearly implied, but there is NO explicit sexual act.',
  '- "explicit": a clear sexual act is visible, such as penetration, oral sex, masturbation, genital stimulation, or another unambiguous sex act.',
  '- Visible genitals alone are NOT a sexual act. A close-up of exposed genitals, including visible natural moisture or a droplet/fluid, stays adultDecision="borderline" unless the image also visibly shows touching/stimulation, penetration, oral contact, masturbation or another unambiguous sex act.',
  '- Do not infer masturbation, stimulation or penetration from arousal, wetness, bodily fluid, pose, framing or a genital close-up alone. The act itself must be visibly evidenced.',
  '',
  'For Artes, classify the following as adultDecision="borderline" when no explicit sexual act is visible:',
  '- clearly implied nudity, even if breasts/genitals are strategically covered by hands, objects, fabric, cropping, or pose;',
  '- bare buttocks;',
  '- visible female nipples or bare female breasts;',
  '- visible genitalia;',
  '- transparent clothing that visibly exposes those intimate areas;',
  '- non-explicit artistic nude photography.',
  '',
  'Do NOT classify these as adult nudity by themselves:',
  '- a bare male chest;',
  '- underwear, lingerie, swimwear, a thong, or a string when intimate areas remain covered.',
  '',
  'adultDecision describes nudity / sexual explicitness only; adult-only sexual context is represented separately by triggers.',
  '- Covered lingerie/underwear remains adultDecision="none" when breasts, nipples, genitals and buttocks are not exposed and the visible body/clothing/crop does not create the appearance of nudity.',
  '- BDSM equipment, rope, restraints, fetish styling, erotic posing or sexual suggestion do NOT by themselves count as implied nudity. They may require adultEroticSuggestive/kinkBdsm triggers while adultDecision stays "none".',
  '- Do not infer nudity merely because a clothed BDSM/kink image is sexual or fetishistic.',
  '',
  'Sexual context can still make a clothed image adult-only:',
  '- If the pose/context is clearly erotic or sexually suggestive without an explicit sex act, add trigger "adultEroticSuggestive" with severity "suggest".',
  '- For BDSM or kink context without an explicit sex act, add triggers "adultEroticSuggestive" and "kinkBdsm" with severity "suggest".',
  '- Do not use adultDecision="explicit" merely because an image is nude, erotic, fetish, or BDSM. Explicit requires a visible sexual act.',
  '',
  'Nonsexual sensitive-content warnings:',
  '- When clearly visible and substantial enough to warrant a viewer warning, use these exact trigger IDs with severity "suggest": bloodInjury, selfHarm, suicide, eatingDisorder, substanceDistress, violence, horrorScare.',
  '- Do not emit bloodInjury for a tiny superficial cut, a minor nosebleed, a trace or small amount of blood, bruising alone, or a fully healed scar. These are general content unless another sensitive rule independently applies.',
  '- Emit bloodInjury when the blood or injury itself is visually significant enough that an ordinary viewer could reasonably benefit from a warning, for example a clearly open or freshly stitched wound, notable bleeding, a convincing traumatic wound, or similarly substantial visible injury.',
  '- Every nonsexual sensitive trigger item must include graphic=true or graphic=false.',
  '- For nonsexual adult-sensitive graphicness, use a total-impact age-rating assessment inspired by established systems such as Kijkwijzer: weigh realism, explicit injury detail, visible consequences and blood, severity of injury or violence, apparent pain or suffering, how strongly graphic material dominates the still image, and whether the presentation is clearly stylized/fantastical or convincingly real.',
  '- Treat graphic=true as the adults-only end of that scale, not merely as "graphic enough to blur". Material comparable to common 12/14/16 violence, injury or horror thresholds should remain graphic=false and rely on the sensitive warning.',
  '- No single visual fact decides graphic=true. Realism, blood, exposed anatomy, a mutilation theme, medical/documentary context, or artistic context can affect impact but none is an automatic adult-only trigger or exemption.',
  '- Reserve graphic=true for exceptionally graphic material whose combined overall impact is far beyond an ordinary warning-level wound or SFX, for example major realistic mutilation with explicit focus on the damage or suffering, dismemberment presented in a highly graphic way, catastrophic traumatic injury with extreme visible consequences, extensive evisceration or exposed viscera as part of a highly graphic overall scene, extensive gore, or overwhelming amounts of blood. Otherwise use graphic=false.',
  '- Convincing but non-extreme SFX such as stitched-wound makeup, burnt-skin makeup, zombie wounds, fake blood, or deep-looking prosthetic wounds can still be sensitive with graphic=false. Do not make such imagery adult-only merely because the simulated injury looks convincing.',
  '- Deep open wounds, a localized compound fracture with visible bone, or a localized wound showing tissue or internal organs (visible tissue/internal anatomy) are not automatically graphic=true. Keep graphic=false when the image is warning-worthy but the overall scene is not exceptionally severe, catastrophic, mutilating or gory.',
  '- Documentary, medical and birth photography must be judged by the same overall visual-severity threshold rather than by anatomy alone. Childbirth imagery with blood, placenta, umbilical cord or other visible birth anatomy is normally sensitive with graphic=false when the overall image is not exceptionally mutilating, catastrophic or gore-dominated.',
  '- Artistic, documentary or medical context can reduce the impression of real victim suffering, but it does not automatically exempt an otherwise adults-only image. Judge the visible image itself and its likely impact.',
  '- Apply adultDecision separately from nonsexual graphicness. If a documentary, medical or birth image independently meets an Artes nudity rule, preserve that adult access label in addition to any sensitive warning.',
  '- These warning triggers are not forbidden by themselves. Use forbiddenReasons only when the image has a separate serious safety issue requiring review/blocking.',
  '',
  'Self-harm, suicide and eating-disorder context:',
  '- Do not infer eatingDisorder from body size, thinness, weight, a scale, food, exercise, fitness, dieting, or body-image aesthetics alone. These remain general unless the image/context clearly establishes eating-disorder content.',
  '- Clear eating-disorder awareness, recovery or non-instructional depiction may use eatingDisorder with graphic=false when the topic itself is explicit enough that a viewer warning is useful. Serious visible eating-disorder-related physical distress or behavior may also use eatingDisorder with graphic=false.',
  '- Fully healed scars without clear self-harm context are general. If the post clearly presents healed self-harm scars as self-harm/recovery/awareness content, use selfHarm with graphic=false.',
  '- Fresh but non-exceptionally-graphic self-harm injuries, non-graphic depictions of self-harm acts, and clear non-graphic suicide attempts/scenes/aftermath are sensitive with graphic=false rather than automatically adult-only.',
  '- For selfHarm or suicide, use graphic=true only when the same total-impact adults-only threshold above is reached. The topic itself, seriousness of the act, or the fact that it depicts a suicide attempt does not by itself require graphic=true.',
  '- If the image encourages, glorifies, or gives actionable instructions for self-harm, suicide, dangerous eating-disorder behavior, or harmful drug use, add exactly "other_safety_review" to forbiddenReasons.',
  '- Awareness, recovery, prevention, or non-instructional depiction should not use other_safety_review solely because the topic is present.',
  '',
  'Substances:',
  '- Ordinary smoking of tobacco or cannabis, ordinary alcohol/drug consumption, pills/drugs shown as objects, or substance use without visible serious distress are not sensitive by themselves. Do not emit substanceDistress for these.',
  '- Use substanceDistress only when a person is clearly severely intoxicated, incapacitated, collapsed or unresponsive, in an overdose-like state, or in serious visible medical/physical distress apparently related to substance use. substanceDistress must use graphic=false; add bloodInjury, selfHarm, suicide, or violence separately when those visual signals are also present.',
  '',
  'Weapons and violence:',
  '- A weapon shown alone or in a posed non-threatening shoot is not sensitive by itself.',
  '- This also includes a real, replica or prop weapon held in a posed/editorial scene, aimed toward the camera/viewer, or shown with a blood-stained weapon but without a visible harmed/threatened victim. Do not emit a weapon-presence warning and do not infer violence solely from implied off-screen events.',
  '- For this policy, an apparent threat, attack or active violence requires direct visual evidence such as an active attack against a person, a clearly identifiable victim in immediate peril, convincing visible violent consequences/aftermath focused on a harmed victim, or another comparably direct depiction of interpersonal violence. Aiming at the camera alone does not qualify.',
  '- Emit violence only when that direct visual threshold is met. Add bloodInjury separately when the visible injury also meets its threshold.',
  '- A shooting-range or otherwise controlled weapon-use setting without a threatened/harmed person is general content.',
  '',
  'Horror:',
  '- A horror theme, costume, mask, prop or spooky setting is not sensitive by itself. Emit horrorScare only when the actual image is clearly visually disturbing or shock/scare-focused, such as convincing gore-like makeup, fake blood, severe injury illusion or similarly intense horror imagery. If blood/injury is visible, emit bloodInjury separately only when it also meets the bloodInjury warning threshold above.',
  '- Stylized decorative blood without a visible injury, distressed victim or genuinely disturbing horror presentation can remain general.',
  '- Standalone needles/injection equipment and spiders/insects are not Artes sensitive-warning categories. Do not emit phobia-only trigger IDs unless another supported sensitive rule independently applies.',
  '',
  'Minor-safety rule:',
  '- Do not estimate an exact age and do not use apparent age as routine age verification.',
  '- If nude/erotic content gives a credible reason to suspect a depicted person may be a minor, add exactly "possible_minor_concern" to forbiddenReasons so a human can review it.',
  '- When adultDecision="none", possible_minor_concern requires strong erotic/kink evidence with confidence at least 0.7 so the adult context survives policy filtering; do not pair a minor concern with only a weak erotic suggestion.',
  '',
  'Uncertainty rule:',
  '- If uncertain between non-explicit adult nudity and an explicit sexual act, choose "borderline" and add exactly "sexual_explicit_uncertain" to forbiddenReasons so a human reviews it.',
  '- Do not invent safety triggers when the visual evidence is weak.',
  '',
  'All trigger items must use severity "suggest". Put any serious safety issue that requires review/blocking in forbiddenReasons instead.',
  'Never put "sexualExplicit" or "possible_minor_concern" in triggers; those are safety-bearing reasons and belong in forbiddenReasons.',
  'Use only these exact forbiddenReasons IDs: sexualExplicit for a clear explicit sexual act; sexual_explicit_uncertain when the image may show an explicit sexual act but the visual evidence is genuinely uncertain; possible_minor_concern for credible minor-safety concern in nude/erotic content; other_safety_review for another serious safety issue that requires human review.',
  'Whenever adultDecision is "explicit", forbiddenReasons must include exactly sexualExplicit; do not use sexualExplicit with adultDecision "none" or "borderline".',
  'All confidence numbers must be between 0 and 1 inclusive.',
  'sexualExplicitConfidence must be below 0.5 for adultDecision "none" or "borderline", and at least 0.5 for adultDecision "explicit".',
  'If nothing relevant is detected, return {"triggers": [],"forbiddenReasons": [],"adultDecision": "none","sexualExplicitConfidence": 0}.',
].join('\n');

export const parseGeminiModerationJson = (text) => {
  if (typeof text !== 'string' || !text.trim()) return null;
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (_error) {
    return null;
  }
};

export const normalizeGeminiAdultDecision = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return ['none', 'borderline', 'explicit'].includes(normalized) ? normalized : null;
};

const isConfidence = (value) => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1
);

const isValidTrigger = (item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (typeof item.trigger !== 'string' || !item.trigger.trim()) return false;
  if (!isConfidence(item.confidence) || item.severity !== 'suggest') return false;
  const trigger = item.trigger.trim();
  if (!SUPPORTED_GEMINI_TRIGGER_IDS.has(trigger)) return false;
  if (SENSITIVE_GRAPHIC_METADATA_TRIGGERS.has(trigger) && typeof item.graphic !== 'boolean') return false;
  if (item.graphic === true && !GRAPHIC_ADULT_SENSITIVE_TRIGGERS.has(trigger)) return false;
  return true;
};

export const getGeminiModerationContractIssue = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid_shape';
  const adultDecision = normalizeGeminiAdultDecision(value.adultDecision);
  if (!adultDecision) return 'invalid_adult_decision';
  if (!isConfidence(value.sexualExplicitConfidence)) return 'invalid_explicit_confidence';
  if (!Array.isArray(value.triggers) || !value.triggers.every(isValidTrigger)) return 'invalid_triggers';
  if (!Array.isArray(value.forbiddenReasons) || !value.forbiddenReasons.every((reason) => typeof reason === 'string' && SUPPORTED_FORBIDDEN_REASON_IDS.has(reason.trim()))) return 'invalid_forbidden_reasons';

  const hasMisplacedSafetyTrigger = value.triggers.some((item) => FORBIDDEN_AS_SUGGESTION_TRIGGERS.has(item.trigger.trim()));
  if (hasMisplacedSafetyTrigger) return 'semantic_contradiction';

  const isExplicitDecision = adultDecision === 'explicit';
  const confidenceSupportsExplicitDecision = value.sexualExplicitConfidence >= 0.5;
  const hasSexualExplicitReason = value.forbiddenReasons.some((reason) => reason.trim() === 'sexualExplicit');
  const hasPossibleMinorConcern = value.forbiddenReasons.some((reason) => reason.trim() === 'possible_minor_concern');
  const hasSexualExplicitUncertainty = value.forbiddenReasons.some((reason) => reason.trim() === 'sexual_explicit_uncertain');
  const hasAdultContextForPossibleMinor = adultDecision !== 'none'
    || value.triggers.some((item) => (
      ['adultEroticSuggestive', 'kinkBdsm'].includes(item.trigger.trim())
      && item.confidence >= DURABLE_ADULT_CONTEXT_CONFIDENCE
    ));
  const hasAdultContextForSexualUncertainty = adultDecision === 'borderline';
  if (isExplicitDecision !== confidenceSupportsExplicitDecision) return 'semantic_contradiction';
  if (isExplicitDecision !== hasSexualExplicitReason) return 'semantic_contradiction';
  if (hasPossibleMinorConcern && !hasAdultContextForPossibleMinor) return 'semantic_contradiction';
  if (hasSexualExplicitUncertainty && !hasAdultContextForSexualUncertainty) return 'semantic_contradiction';
  return null;
};

export const normalizeGeminiModerationResult = (value) => {
  const contractIssue = getGeminiModerationContractIssue(value);
  if (contractIssue) return null;
  const adultDecision = normalizeGeminiAdultDecision(value.adultDecision);
  return {
    ...value,
    triggers: value.triggers,
    forbiddenReasons: value.forbiddenReasons,
    adultDecision,
    sexualExplicitConfidence: value.sexualExplicitConfidence,
  };
};

const normalizeReason = (value) => String(value || '').trim().toUpperCase();

export const getGeminiSafetyBlockReason = ({ candidate = null, promptFeedback = null } = {}) => {
  const finishReason = normalizeReason(candidate?.finishReason);
  if (SAFETY_BLOCK_FINISH_REASONS.has(finishReason)) return `candidate_${finishReason.toLowerCase()}`;

  const candidateBlockedRating = Array.isArray(candidate?.safetyRatings)
    && candidate.safetyRatings.some((item) => item?.blocked === true);
  if (candidateBlockedRating) return 'candidate_safety_rating';

  const promptBlockReason = normalizeReason(promptFeedback?.blockReason);
  if (promptBlockReason) return `prompt_${promptBlockReason.toLowerCase()}`;

  const promptBlockedRating = Array.isArray(promptFeedback?.safetyRatings)
    && promptFeedback.safetyRatings.some((item) => item?.blocked === true);
  if (promptBlockedRating) return 'prompt_safety_rating';

  return null;
};

export const buildGeminiModerationDiagnostics = (overrides = {}) => ({
  attempted: false,
  success: false,
  contractValidated: false,
  contractIssue: null,
  fallbackUsed: false,
  fallbackReason: null,
  safetyBlocked: false,
  safetyBlockReason: null,
  graphicSensitiveSignals: [],
  apiErrorCode: null,
  finishReason: null,
  safetyRatings: null,
  promptBlockReason: null,
  rawTextPresent: false,
  parsedJsonPresent: false,
  missingFields: [],
  model: null,
  promptVersion: GEMINI_MODERATION_PROMPT_VERSION,
  ...overrides,
});