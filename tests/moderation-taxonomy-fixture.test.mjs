import assert from 'node:assert/strict';

const VISION_DIAGNOSTIC_ONLY_TRIGGERS = new Set(['spidersInsects', 'needlesInjections']);
const isVisionDiagnosticOnlyTrigger = (trigger) => VISION_DIAGNOSTIC_ONLY_TRIGGERS.has(String(trigger || '').trim());
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const sanitizePolicy = ({ appliedTriggers, forbiddenReasons, suggestedTriggers }) => {
  const finalAppliedTriggers = normalizeArray(appliedTriggers);
  const finalForbiddenReasonsRaw = normalizeArray(forbiddenReasons);
  const finalSuggestedTriggers = normalizeArray(suggestedTriggers);
  const policyAppliedTriggers = finalAppliedTriggers.filter((item) => !isVisionDiagnosticOnlyTrigger(typeof item === 'string' ? item : item?.trigger));
  const policyForbiddenReasons = finalForbiddenReasonsRaw.filter((item) => !isVisionDiagnosticOnlyTrigger(typeof item === 'string' ? item : item?.trigger));
  const outcome = policyForbiddenReasons.length ? 'forbidden' : (finalSuggestedTriggers.length ? 'suggested' : 'allowed');
  return { policyAppliedTriggers, policyForbiddenReasons, outcome };
};

const freshCase = sanitizePolicy({
  appliedTriggers: [{ trigger: 'spidersInsects', source: 'legacy' }],
  forbiddenReasons: [{ trigger: 'spidersInsects', reason: 'random text' }],
  suggestedTriggers: [],
});
assert.equal(freshCase.policyAppliedTriggers.length, 0);
assert.equal(freshCase.policyForbiddenReasons.length, 0);
assert.equal(freshCase.outcome, 'allowed');

const cachedLegacyCase = sanitizePolicy({
  appliedTriggers: [{ trigger: 'needlesInjections', source: 'gemini' }, { trigger: 'adultArtNude', source: 'makerTag' }],
  forbiddenReasons: [{ trigger: 'needlesInjections', reason: 'legacy block' }],
  suggestedTriggers: [{ trigger: 'adultEroticSuggestive' }],
});
assert.deepEqual(cachedLegacyCase.policyAppliedTriggers.map((x) => x.trigger), ['adultArtNude']);
assert.equal(cachedLegacyCase.policyForbiddenReasons.length, 0);
assert.equal(cachedLegacyCase.outcome, 'suggested');

const userSelectedTaxonomy = { themes: ['Boudoir'], triggers: ['adultArtNude'] };
const aiVisionLabels = ['Spider', 'Insect'];
const aiSafetySignals = [{ signal: 'spidersInsects', source: 'visionLabel', score: 0.92 }];
assert.equal(userSelectedTaxonomy.triggers.includes('spidersInsects'), false);
assert.equal(aiVisionLabels.includes('Spider'), true);
assert.equal(aiSafetySignals.some((item) => item.signal === 'spidersInsects'), true);
console.log('moderation taxonomy fixture ok');
