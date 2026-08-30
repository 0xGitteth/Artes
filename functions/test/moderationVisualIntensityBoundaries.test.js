import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiModerationPrompt } from '../geminiModerationContract.js';
import { composeModerationPolicyResult } from '../moderationPolicy.js';

const trustedGeminiDiagnostics = {
  attempted: true,
  success: true,
  contractValidated: true,
  graphicSensitiveSignals: [],
};

test('prompt keeps very mild blood and healed injury general', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /tiny superficial cut/i);
  assert.match(prompt, /minor nosebleed/i);
  assert.match(prompt, /trace or small amount of blood/i);
  assert.match(prompt, /fully healed scar/i);
  assert.match(prompt, /general content unless another sensitive rule independently applies/i);
});

test('prompt requires a meaningful injury threshold before bloodInjury warning', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /visually significant enough/i);
  assert.match(prompt, /clearly open or freshly stitched wound/i);
  assert.match(prompt, /notable bleeding/i);
  assert.match(prompt, /convincing traumatic wound/i);
});

test('warning-level blood or injury stays sensitive without adult access', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', source: 'gemini', score: 0.95 }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_general');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('convincing non-extreme wound SFX remains sensitive rather than adult', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [
      { trigger: 'bloodInjury', source: 'gemini', score: 0.95 },
      { trigger: 'horrorScare', source: 'gemini', score: 0.92 },
    ],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_general');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'horrorScare'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('batch 5A deeper open-looking trauma still remains sensitive when not exceptionally graphic', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Deep open wounds/i);
  assert.match(prompt, /not automatically graphic=true/i);
  assert.match(prompt, /overall scene is not exceptionally severe, catastrophic, mutilating or gory/i);

  const result = composeModerationPolicyResult({
    suggestedTriggers: [
      { trigger: 'bloodInjury', source: 'gemini', score: 0.98 },
      { trigger: 'horrorScare', source: 'gemini', score: 0.96 },
    ],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'horrorScare'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('batch 5B localized visible bone or internal organs remain warning-only by themselves', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /localized compound fracture with visible bone/i);
  assert.match(prompt, /localized wound showing tissue or internal organs/i);
  assert.match(prompt, /not automatically graphic=true/i);
  assert.match(prompt, /major realistic mutilation/i);
  assert.match(prompt, /dismemberment presented in a highly graphic way/i);
  assert.match(prompt, /extensive evisceration/i);

  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', source: 'gemini', score: 0.99 }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('documentary childbirth and placenta imagery stays warning-only unless overall scene is exceptionally graphic', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Documentary, medical and birth photography/i);
  assert.match(prompt, /Childbirth imagery with blood, placenta, umbilical cord/i);
  assert.match(prompt, /normally sensitive with graphic=false/i);
  assert.match(prompt, /Apply adultDecision separately from nonsexual graphicness/i);

  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', source: 'gemini', score: 0.97 }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('nonsexual adult-sensitive graphicness uses a total-impact age-rating formula', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /total-impact age-rating assessment inspired by established systems such as Kijkwijzer/i);
  assert.match(prompt, /realism, explicit injury detail, visible consequences and blood/i);
  assert.match(prompt, /apparent pain or suffering/i);
  assert.match(prompt, /how strongly graphic material dominates the still image/i);
  assert.match(prompt, /stylized\/fantastical or convincingly real/i);
  assert.match(prompt, /12\/14\/16 violence, injury or horror thresholds should remain graphic=false/i);
  assert.match(prompt, /No single visual fact decides graphic=true/i);
  assert.match(prompt, /none is an automatic adult-only trigger or exemption/i);
});

test('prompt reserves adult plus sensitive graphic flag for exceptional combined overall impact', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Reserve graphic=true for exceptionally graphic material whose combined overall impact/i);
  assert.match(prompt, /major realistic mutilation with explicit focus on the damage or suffering/i);
  assert.match(prompt, /dismemberment presented in a highly graphic way/i);
  assert.match(prompt, /catastrophic traumatic injury with extreme visible consequences/i);
  assert.match(prompt, /extensive evisceration/i);
  assert.match(prompt, /extensive gore/i);
  assert.match(prompt, /overwhelming amounts of blood/i);
  assert.match(prompt, /Artistic, documentary or medical context can reduce the impression of real victim suffering/i);
  assert.match(prompt, /does not automatically exempt an otherwise adults-only image/i);
});

test('exceptionally graphic injury still receives adult plus sensitive access', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', source: 'gemini', score: 0.97 }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: {
      ...trustedGeminiDiagnostics,
      graphicSensitiveSignals: [{ trigger: 'bloodInjury', score: 0.97 }],
    },
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_adult_sensitive_graphic');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), true);
});
