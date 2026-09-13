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

test('weapons and implied off-screen violence stay general without a harmed or threatened victim', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /aimed toward the camera\/viewer/i);
  assert.match(prompt, /blood-stained weapon but without a visible harmed\/threatened victim/i);
  assert.match(prompt, /do not infer violence solely from implied off-screen events/i);
  assert.match(prompt, /shooting-range or otherwise controlled weapon-use setting without a threatened\/harmed person is general content/i);
});

test('violence warning requires direct interpersonal violence or convincing victim-focused consequences', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /active attack against a person/i);
  assert.match(prompt, /clearly identifiable victim in immediate peril/i);
  assert.match(prompt, /convincing visible violent consequences\/aftermath focused on a harmed victim/i);

  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'violence', source: 'gemini', score: 0.95 }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'violence'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('decorative blood can remain general while disturbing horror receives a warning', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Stylized decorative blood without a visible injury, distressed victim or genuinely disturbing horror presentation can remain general/i);
  assert.match(prompt, /Emit horrorScare only when the actual image is clearly visually disturbing/i);
});

test('body size and ordinary body-image cues do not imply an eating disorder', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Do not infer eatingDisorder from body size, thinness, weight, a scale, food, exercise, fitness, dieting, or body-image aesthetics alone/i);
  assert.match(prompt, /These remain general unless the image\/context clearly establishes eating-disorder content/i);
});

test('eating-disorder awareness and serious visible distress are warning content rather than automatic safety review', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /eating-disorder awareness, recovery or non-instructional depiction may use eatingDisorder with graphic=false/i);
  assert.match(prompt, /Serious visible eating-disorder-related physical distress or behavior may also use eatingDisorder with graphic=false/i);

  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'eatingDisorder', source: 'gemini', score: 0.93 }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'eatingDisorder'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('healed scars alone stay general while explicit self-harm recovery context can receive a warning', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Fully healed scars without clear self-harm context are general/i);
  assert.match(prompt, /clearly presents healed self-harm scars as self-harm\/recovery\/awareness content, use selfHarm with graphic=false/i);
});

test('non-graphic self-harm and suicide depictions stay sensitive instead of automatically adult-only', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /Fresh but non-exceptionally-graphic self-harm injuries/i);
  assert.match(prompt, /clear non-graphic suicide attempts\/scenes\/aftermath are sensitive with graphic=false rather than automatically adult-only/i);
  assert.match(prompt, /topic itself, seriousness of the act, or the fact that it depicts a suicide attempt does not by itself require graphic=true/i);

  for (const trigger of ['selfHarm', 'suicide']) {
    const result = composeModerationPolicyResult({
      suggestedTriggers: [{ trigger, source: 'gemini', score: 0.96 }],
      geminiAdultDecision: 'none',
      geminiDiagnostics: trustedGeminiDiagnostics,
    });
    assert.equal(result.outcome, 'allowed');
    assert.equal(result.appliedTriggers.some((item) => item.trigger === trigger), true);
    assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
  }
});

test('exceptionally graphic self-harm or suicide can still cross the adult-sensitive threshold', () => {
  for (const trigger of ['selfHarm', 'suicide']) {
    const result = composeModerationPolicyResult({
      suggestedTriggers: [{ trigger, source: 'gemini', score: 0.98 }],
      geminiAdultDecision: 'none',
      geminiDiagnostics: {
        ...trustedGeminiDiagnostics,
        graphicSensitiveSignals: [{ trigger, score: 0.98 }],
      },
    });
    assert.equal(result.outcome, 'allowed');
    assert.equal(result.classification, 'allowed_adult_sensitive_graphic');
    assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), true);
  }
});

test('harmful instructions or glorification route separately to safety review', () => {
  const prompt = buildGeminiModerationPrompt();
  assert.match(prompt, /encourages, glorifies, or gives actionable instructions for self-harm, suicide, dangerous eating-disorder behavior, or harmful drug use/i);
  assert.match(prompt, /add exactly "other_safety_review" to forbiddenReasons/i);
  assert.match(prompt, /Awareness, recovery, prevention, or non-instructional depiction should not use other_safety_review solely because the topic is present/i);
});
