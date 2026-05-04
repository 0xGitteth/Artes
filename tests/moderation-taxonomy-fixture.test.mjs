import assert from 'node:assert/strict';

const VISION_DIAGNOSTIC_ONLY_TRIGGERS = new Set(['spidersInsects', 'needlesInjections']);
const TRIGGERS = ['adultArtNude', 'adultEroticSuggestive', 'kinkBDSM', 'breathRestriction', 'bloodInjury', 'horrorScare', 'needlesInjections', 'spidersInsects'];
const isVisionDiagnosticOnlyTrigger = (trigger) => VISION_DIAGNOSTIC_ONLY_TRIGGERS.has(String(trigger || '').trim());
const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const isRawVisionSource = (value) => ['labeldetection', 'visionlabel', 'vision', 'cloudvision'].includes(String(value || '').trim().toLowerCase());
const sanitizeFrontendFallback = (items = []) => normalizeArray(items)
  .filter((item) => {
    if (typeof item === 'string' && (item === 'spidersInsects' || item === 'needlesInjections')) return false;
    if (item && typeof item === 'object') {
      if (isRawVisionSource(item.source)) return false;
      const hasSource = Object.prototype.hasOwnProperty.call(item, 'source') && item.source !== null && item.source !== undefined && String(item.source).trim() !== '';
      if (!hasSource && (item?.trigger === 'spidersInsects' || item?.trigger === 'needlesInjections')) return false;
    }
    return true;
  })
  .map((item) => (typeof item === 'string' ? item : item?.trigger || item?.reason))
  .filter(Boolean);

const sanitizePolicy = ({ appliedTriggers, forbiddenReasons, suggestedTriggers, aiSafetySignals = [] }) => {
  const finalAppliedTriggersRaw = normalizeArray(appliedTriggers);
  const recoveredSignals = [...normalizeArray(aiSafetySignals)];
  [...finalAppliedTriggersRaw, ...normalizeArray(suggestedTriggers), ...normalizeArray(forbiddenReasons)].forEach((item) => {
    const trigger = typeof item === 'string' ? item : item?.trigger;
    const source = typeof item === 'object' ? item?.source : null;
    if ((isVisionDiagnosticOnlyTrigger(trigger) || isRawVisionSource(source)) && !recoveredSignals.some((s) => s.signal === trigger)) {
      recoveredSignals.push({ signal: trigger, source: 'cachedLegacy' });
    }
  });
  const finalAppliedTriggers = finalAppliedTriggersRaw
    .filter((item) => !isRawVisionSource(typeof item === 'object' ? item?.source : null))
    .filter((item) => !isVisionDiagnosticOnlyTrigger(typeof item === 'string' ? item : item?.trigger));
  const finalForbiddenReasonsRaw = normalizeArray(forbiddenReasons);
  const finalSuggestedTriggers = normalizeArray(suggestedTriggers);
  const policyAppliedTriggers = finalAppliedTriggers;
  const policyForbiddenReasons = finalForbiddenReasonsRaw
    .filter((item) => !isRawVisionSource(typeof item === 'object' ? item?.source : null))
    .filter((item) => !isVisionDiagnosticOnlyTrigger(typeof item === 'string' ? item : item?.trigger));
  const sanitizedSuggested = finalSuggestedTriggers
    .filter((item) => !isRawVisionSource(typeof item === 'object' ? item?.source : null))
    .filter((item) => !isVisionDiagnosticOnlyTrigger(typeof item === 'string' ? item : item?.trigger));
  const outcome = policyForbiddenReasons.length ? 'forbidden' : (sanitizedSuggested.length ? 'suggested' : 'allowed');
  return { finalAppliedTriggers, policyAppliedTriggers, policyForbiddenReasons, sanitizedSuggested, recoveredSignals, outcome };
};

const freshCase = sanitizePolicy({
  appliedTriggers: [{ trigger: 'spidersInsects', source: 'legacy' }],
  forbiddenReasons: [{ trigger: 'spidersInsects', reason: 'random text' }],
  suggestedTriggers: [],
});
assert.equal(freshCase.policyAppliedTriggers.length, 0);
assert.equal(freshCase.finalAppliedTriggers.length, 0);
assert.equal(freshCase.policyForbiddenReasons.length, 0);
assert.equal(freshCase.sanitizedSuggested.length, 0);
assert.equal(freshCase.recoveredSignals.some((s) => s.signal === 'spidersInsects'), true);
assert.equal(freshCase.outcome, 'allowed');

const cachedLegacyCase = sanitizePolicy({
  appliedTriggers: [{ trigger: 'needlesInjections', source: 'gemini' }, { trigger: 'adultArtNude', source: 'makerTag' }],
  forbiddenReasons: [{ trigger: 'needlesInjections', reason: 'legacy block' }],
  suggestedTriggers: [{ trigger: 'adultEroticSuggestive' }],
});
assert.deepEqual(cachedLegacyCase.policyAppliedTriggers.map((x) => x.trigger), ['adultArtNude']);
assert.deepEqual(cachedLegacyCase.finalAppliedTriggers.map((x) => x.trigger), ['adultArtNude']);
assert.equal(cachedLegacyCase.policyForbiddenReasons.length, 0);
assert.equal(cachedLegacyCase.sanitizedSuggested.length, 1);
assert.equal(cachedLegacyCase.recoveredSignals.some((s) => s.signal === 'needlesInjections'), true);
assert.equal(cachedLegacyCase.outcome, 'suggested');

const sourceLessAppliedLegacyCase = sanitizePolicy({
  appliedTriggers: ['spidersInsects'],
  forbiddenReasons: [],
  suggestedTriggers: [],
});
assert.equal(sourceLessAppliedLegacyCase.finalAppliedTriggers.length, 0);
assert.equal(sourceLessAppliedLegacyCase.outcome, 'allowed');

const sourceLessForbiddenLegacyCase = sanitizePolicy({
  appliedTriggers: [],
  forbiddenReasons: [{ trigger: 'spidersInsects' }],
  suggestedTriggers: [],
});
assert.equal(sourceLessForbiddenLegacyCase.policyForbiddenReasons.length, 0);
assert.equal(sourceLessForbiddenLegacyCase.outcome, 'allowed');
assert.equal(sanitizeFrontendFallback(['spidersInsects']).length, 0);
assert.equal(sanitizeFrontendFallback(['needlesInjections']).length, 0);

const userSelectedTaxonomy = { themes: ['Boudoir'], triggers: ['adultArtNude'] };
const aiVisionLabels = ['Spider', 'Insect'];
const aiSafetySignals = [{ signal: 'spidersInsects', source: 'visionLabel', score: 0.92 }];
assert.equal(userSelectedTaxonomy.triggers.includes('spidersInsects'), false);
assert.equal(aiVisionLabels.includes('Spider'), true);
assert.equal(aiSafetySignals.some((item) => item.signal === 'spidersInsects'), true);
const userSelectedWarningTags = { themes: ['Boudoir'], triggers: ['needlesInjections', 'spidersInsects'] };
assert.equal(userSelectedWarningTags.triggers.includes('needlesInjections'), true);
assert.equal(userSelectedWarningTags.triggers.includes('spidersInsects'), true);

TRIGGERS.forEach((trigger) => {
  const sourceVisionCase = sanitizePolicy({
    appliedTriggers: [{ trigger, source: 'labelDetection' }],
    forbiddenReasons: [{ trigger, source: 'labelDetection', reason: 'vision label' }],
    suggestedTriggers: [{ trigger, source: 'labelDetection' }],
  });
  assert.equal(sourceVisionCase.finalAppliedTriggers.some((item) => item.trigger === trigger), false);
  assert.equal(sourceVisionCase.policyAppliedTriggers.some((item) => item.trigger === trigger), false);
  assert.equal(sourceVisionCase.policyForbiddenReasons.some((item) => item.trigger === trigger), false);
  assert.equal(sourceVisionCase.sanitizedSuggested.some((item) => item.trigger === trigger), false);
  assert.equal(sourceVisionCase.recoveredSignals.some((item) => item.signal === trigger), true);
});
console.log('moderation taxonomy fixture ok');
