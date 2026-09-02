import { normalizeArtesDetectorLabel, validateArtesDetectorLabel } from './moderationLearningDataset.js';

export const MODERATOR_LEARNING_EVIDENCE_SCHEMA_VERSION = 1;

const NUDITY_VALUES = new Set([
  'none',
  'underwear_swimwear',
  'implied_nude',
  'bare_buttocks',
  'female_bare_breasts',
  'genitalia',
  'male_topless',
]);
const SEXUAL_CONTEXT_VALUES = new Set(['none', 'suggestive', 'bdsm_kink', 'explicit_act']);
const GRAPHIC_INJURY_VALUES = new Set(['none', 'mild', 'graphic']);
const SENSITIVE_SIGNAL_VALUES = new Set([
  'bloodInjury',
  'selfHarm',
  'suicide',
  'eatingDisorder',
  'substanceDistress',
  'violence',
  'horrorScare',
]);
const REQUIRED_FULL_FIELDS = [
  'nudity',
  'sexualContext',
  'graphicInjury',
  'sensitiveSignals',
  'possibleMinorConcern',
];

const cleanString = (value) => String(value || '').trim();
const cleanList = (value) => Array.from(new Set(
  (Array.isArray(value) ? value : [])
    .map(cleanString)
    .filter(Boolean),
)).sort();

const FIELD_PLANS_BY_REASON = {
  allowed_art_nude: ['nudity', 'sexualContext'],
  allowed_boudoir: ['nudity', 'sexualContext'],
  allowed_non_sensitive: ['nudity', 'sexualContext'],
  review_borderline_adult: ['nudity', 'sexualContext', 'possibleMinorConcern'],
  forbidden_explicit_sexual: ['nudity', 'sexualContext'],
  forbidden_non_consensual_context: ['nudity', 'sexualContext'],
  forbidden_self_harm_instruction: ['graphicInjury', 'sensitiveSignals'],
  forbidden_suicide_instruction: ['graphicInjury', 'sensitiveSignals'],
  forbidden_eating_disorder_instruction: ['sensitiveSignals'],
  forbidden_harmful_drug_instruction: ['sensitiveSignals'],
  forbidden_other_safety: ['graphicInjury', 'sensitiveSignals', 'possibleMinorConcern'],
  wrong_theme_or_label: REQUIRED_FULL_FIELDS,
  unclear_ai_result: REQUIRED_FULL_FIELDS,
};

const FIXED_FIELDS_BY_REASON = {
  forbidden_explicit_sexual: { sexualContext: 'explicit_act' },
  forbidden_self_harm_instruction: { sensitiveSignals: ['selfHarm'] },
  forbidden_suicide_instruction: { sensitiveSignals: ['suicide'] },
  forbidden_eating_disorder_instruction: { sensitiveSignals: ['eatingDisorder'] },
  forbidden_harmful_drug_instruction: { sensitiveSignals: ['substanceDistress'] },
};

export const buildModeratorLearningPromptPlan = ({ reasonCode = null, aiDetectorLabel = null } = {}) => {
  const normalizedReason = cleanString(reasonCode);
  const aiValidation = validateArtesDetectorLabel(aiDetectorLabel);
  if (aiValidation.valid) {
    return {
      mode: 'confirm_or_correct_ai_label',
      reasonCode: normalizedReason || null,
      suggestedFields: FIELD_PLANS_BY_REASON[normalizedReason] || REQUIRED_FULL_FIELDS,
      fixedFields: FIXED_FIELDS_BY_REASON[normalizedReason] || {},
      canConfirmAiAsFullLabel: true,
      aiDetectorLabel: normalizeArtesDetectorLabel(aiDetectorLabel),
    };
  }

  return {
    mode: 'collect_relevant_visual_evidence',
    reasonCode: normalizedReason || null,
    suggestedFields: FIELD_PLANS_BY_REASON[normalizedReason] || REQUIRED_FULL_FIELDS,
    fixedFields: FIXED_FIELDS_BY_REASON[normalizedReason] || {},
    canConfirmAiAsFullLabel: false,
    aiDetectorLabel: null,
  };
};

export const normalizeModeratorPartialVisualEvidence = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['invalid_visual_evidence_shape'], evidence: null };
  }

  const errors = [];
  const fields = {};
  const confirmedFields = new Set();

  if (Object.hasOwn(input, 'nudity')) {
    const value = cleanString(input.nudity);
    if (!NUDITY_VALUES.has(value)) errors.push('invalid_nudity');
    else {
      fields.nudity = value;
      confirmedFields.add('nudity');
    }
  }

  if (Object.hasOwn(input, 'sexualContext')) {
    const value = cleanString(input.sexualContext);
    if (!SEXUAL_CONTEXT_VALUES.has(value)) errors.push('invalid_sexual_context');
    else {
      fields.sexualContext = value;
      confirmedFields.add('sexualContext');
    }
  }

  if (Object.hasOwn(input, 'graphicInjury')) {
    const value = cleanString(input.graphicInjury);
    if (!GRAPHIC_INJURY_VALUES.has(value)) errors.push('invalid_graphic_injury');
    else {
      fields.graphicInjury = value;
      confirmedFields.add('graphicInjury');
    }
  }

  if (Object.hasOwn(input, 'sensitiveSignals')) {
    if (!Array.isArray(input.sensitiveSignals)) {
      errors.push('invalid_sensitive_signals');
    } else {
      const values = cleanList(input.sensitiveSignals);
      if (values.some((value) => !SENSITIVE_SIGNAL_VALUES.has(value))) errors.push('unsupported_sensitive_signal');
      else {
        fields.sensitiveSignals = values;
        confirmedFields.add('sensitiveSignals');
      }
    }
  }

  if (Object.hasOwn(input, 'possibleMinorConcern')) {
    if (typeof input.possibleMinorConcern !== 'boolean') errors.push('invalid_possible_minor_concern');
    else {
      fields.possibleMinorConcern = input.possibleMinorConcern;
      confirmedFields.add('possibleMinorConcern');
    }
  }

  if (errors.length > 0) return { valid: false, errors, evidence: null };
  if (confirmedFields.size === 0) return { valid: false, errors: ['no_visual_fields_confirmed'], evidence: null };

  const confirmed = REQUIRED_FULL_FIELDS.filter((field) => confirmedFields.has(field));
  return {
    valid: true,
    errors: [],
    evidence: {
      fields,
      confirmedFields: confirmed,
      completeness: confirmed.length === REQUIRED_FULL_FIELDS.length ? 'full' : 'partial',
    },
  };
};

const buildFullDetectorLabelFromEvidence = (evidence) => {
  if (evidence?.completeness !== 'full') return null;
  const label = {
    nudity: evidence.fields.nudity,
    sexualContext: evidence.fields.sexualContext,
    graphicInjury: evidence.fields.graphicInjury,
    sensitiveSignals: evidence.fields.sensitiveSignals,
    possibleMinorConcern: evidence.fields.possibleMinorConcern,
    confidence: 1,
    uncertaintyFlags: [],
  };
  return validateArtesDetectorLabel(label).valid ? normalizeArtesDetectorLabel(label) : null;
};

export const buildModeratorLearningEvidence = ({
  reasonCode = null,
  aiDetectorLabel = null,
  confirmAiLabel = false,
  visualEvidence = null,
} = {}) => {
  const plan = buildModeratorLearningPromptPlan({ reasonCode, aiDetectorLabel });

  if (confirmAiLabel === true) {
    if (!plan.canConfirmAiAsFullLabel || !plan.aiDetectorLabel) {
      throw new Error('cannot_confirm_missing_or_invalid_ai_detector_label');
    }
    return {
      schemaVersion: MODERATOR_LEARNING_EVIDENCE_SCHEMA_VERSION,
      source: 'moderator_confirmed_ai_detector_label',
      reasonCode: plan.reasonCode,
      completeness: 'full',
      confirmedFields: [...REQUIRED_FULL_FIELDS],
      visualEvidence: {
        nudity: plan.aiDetectorLabel.nudity,
        sexualContext: plan.aiDetectorLabel.sexualContext,
        graphicInjury: plan.aiDetectorLabel.graphicInjury,
        sensitiveSignals: plan.aiDetectorLabel.sensitiveSignals,
        possibleMinorConcern: plan.aiDetectorLabel.possibleMinorConcern,
      },
      detectorLabel: { ...plan.aiDetectorLabel, confidence: 1 },
    };
  }

  const fixedFields = plan.fixedFields || {};
  const mergedVisualEvidence = {
    ...(visualEvidence && typeof visualEvidence === 'object' ? visualEvidence : {}),
    ...fixedFields,
  };
  const normalized = normalizeModeratorPartialVisualEvidence(mergedVisualEvidence);
  if (!normalized.valid) {
    throw new Error(`invalid_moderator_visual_evidence:${normalized.errors.join(',')}`);
  }

  return {
    schemaVersion: MODERATOR_LEARNING_EVIDENCE_SCHEMA_VERSION,
    source: 'moderator_visual_evidence',
    reasonCode: plan.reasonCode,
    completeness: normalized.evidence.completeness,
    confirmedFields: normalized.evidence.confirmedFields,
    visualEvidence: normalized.evidence.fields,
    detectorLabel: buildFullDetectorLabelFromEvidence(normalized.evidence),
  };
};
