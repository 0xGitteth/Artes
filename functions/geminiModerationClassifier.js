import { VertexAI } from '@google-cloud/vertexai';
import {
  DEFAULT_GEMINI_MODERATION_MODEL,
  GEMINI_MODERATION_PROMPT_VERSION,
  buildGeminiModerationDiagnostics,
  buildGeminiModerationPrompt,
  getGeminiModerationContractIssue,
  getGeminiSafetyBlockReason,
  normalizeGeminiModerationResult,
  parseGeminiModerationJson,
} from './geminiModerationContract.js';

const buildRawPreview = (text, maxLength = 400) => {
  if (typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
};

const normalizeSafetyRatings = (ratings, scope) => (Array.isArray(ratings)
  ? ratings.map((item) => ({
      scope,
      category: item?.category || null,
      probability: item?.probability || null,
      blocked: Boolean(item?.blocked),
    }))
  : []);

export const runGeminiClassifier = async (
  { buffer, mimeType },
  { env = process.env, VertexAIClass = VertexAI } = {},
) => {
  const modelName = env.GEMINI_MODEL || DEFAULT_GEMINI_MODERATION_MODEL;
  const promptVersion = GEMINI_MODERATION_PROMPT_VERSION;

  if (env.ENABLE_GEMINI_CLASSIFIER !== 'true') {
    return {
      parsed: null,
      parseSucceeded: false,
      hasRawText: false,
      rawPreview: null,
      rawLength: 0,
      diagnostics: buildGeminiModerationDiagnostics({
        fallbackReason: 'classifier_disabled',
        model: modelName,
        promptVersion,
      }),
    };
  }

  const project = env.GOOGLE_CLOUD_PROJECT;
  const location = env.GOOGLE_CLOUD_LOCATION || 'europe-west4';
  if (!project) {
    return {
      parsed: null,
      parseSucceeded: false,
      hasRawText: false,
      rawPreview: null,
      rawLength: 0,
      diagnostics: buildGeminiModerationDiagnostics({
        attempted: false,
        fallbackUsed: true,
        fallbackReason: 'missing_google_cloud_project',
        model: modelName,
        promptVersion,
      }),
    };
  }

  const vertex = new VertexAIClass({ project, location });
  const model = vertex.getGenerativeModel({ model: modelName });
  const prompt = buildGeminiModerationPrompt();

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { data: buffer.toString('base64'), mimeType } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  });

  const candidate = result?.response?.candidates?.[0] || null;
  const promptFeedback = result?.response?.promptFeedback || null;
  const text = candidate?.content?.parts
    ?.map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('') || '';
  const finishReason = candidate?.finishReason || null;
  const safetyRatings = [
    ...normalizeSafetyRatings(candidate?.safetyRatings, 'candidate'),
    ...normalizeSafetyRatings(promptFeedback?.safetyRatings, 'prompt'),
  ];
  const safetyBlockReason = getGeminiSafetyBlockReason({ candidate, promptFeedback });

  const parsedJson = parseGeminiModerationJson(text);
  const contractIssue = parsedJson ? getGeminiModerationContractIssue(parsedJson) : null;
  const normalized = normalizeGeminiModerationResult(parsedJson);
  const trustedNormalized = safetyBlockReason ? null : normalized;
  const graphicSensitiveSignals = Array.isArray(trustedNormalized?.triggers)
    ? trustedNormalized.triggers
      .filter((item) => item?.graphic === true)
      .map((item) => ({ trigger: item.trigger, score: item.confidence }))
    : [];
  const missingFields = [];
  if (parsedJson && typeof parsedJson === 'object') {
    if (!Object.prototype.hasOwnProperty.call(parsedJson, 'adultDecision')) missingFields.push('adultDecision');
    if (!Object.prototype.hasOwnProperty.call(parsedJson, 'sexualExplicitConfidence')) missingFields.push('sexualExplicitConfidence');
    if (!Object.prototype.hasOwnProperty.call(parsedJson, 'triggers')) missingFields.push('triggers');
    if (!Object.prototype.hasOwnProperty.call(parsedJson, 'forbiddenReasons')) missingFields.push('forbiddenReasons');
  }

  const rawTextPresent = Boolean(text.trim());
  const parsedJsonPresent = Boolean(parsedJson);
  let fallbackReason = null;
  if (safetyBlockReason) fallbackReason = 'safety_blocked';
  else if (!rawTextPresent) fallbackReason = 'empty_response';
  else if (!parsedJsonPresent) fallbackReason = 'malformed_json';
  else if (!trustedNormalized) {
    if (contractIssue === 'semantic_contradiction') fallbackReason = 'semantic_contradiction';
    else fallbackReason = missingFields.length > 0 ? 'missing_required_fields' : 'invalid_required_fields';
  }

  return {
    parsed: trustedNormalized,
    parseSucceeded: Boolean(trustedNormalized),
    hasRawText: rawTextPresent,
    rawPreview: buildRawPreview(text),
    rawLength: text.length,
    diagnostics: buildGeminiModerationDiagnostics({
      attempted: true,
      success: Boolean(trustedNormalized),
      contractValidated: Boolean(trustedNormalized),
      contractIssue,
      fallbackUsed: Boolean(fallbackReason),
      fallbackReason,
      safetyBlocked: Boolean(safetyBlockReason),
      safetyBlockReason,
      graphicSensitiveSignals,
      finishReason,
      safetyRatings: safetyRatings.length ? safetyRatings : null,
      promptBlockReason: promptFeedback?.blockReason || null,
      rawTextPresent,
      parsedJsonPresent,
      missingFields,
      model: modelName,
      promptVersion,
    }),
  };
};
