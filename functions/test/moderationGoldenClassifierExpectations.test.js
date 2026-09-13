import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoldenClassifierExpectationFailure } from '../moderationGoldenClassifierExpectations.js';

const result = (parsed, diagnostics = {}) => ({ parsed, diagnostics });
const trigger = (name, confidence) => ({ trigger: name, confidence, severity: 'suggest', graphic: false });

test('accepts covered BDSM as adult context without nudity', () => {
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'ADULT_BDSM_01',
    result: result({
      triggers: [trigger('adultEroticSuggestive', 0.85), trigger('kinkBdsm', 0.8)],
      forbiddenReasons: [],
      adultDecision: 'none',
      sexualExplicitConfidence: 0.1,
    }),
  }), null);
});

test('rejects covered BDSM when adultDecision incorrectly becomes borderline', () => {
  assert.match(getGoldenClassifierExpectationFailure({
    id: 'ADULT_BDSM_01',
    result: result({
      triggers: [trigger('adultEroticSuggestive', 0.9), trigger('kinkBdsm', 0.9)],
      forbiddenReasons: [],
      adultDecision: 'borderline',
      sexualExplicitConfidence: 0.1,
    }),
  }), /must not be labelled as nudity/);
});

test('accepts ordinary boudoir or a provider safety block for fail-closed review', () => {
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'BOUDOIR_01',
    result: result({ triggers: [], forbiddenReasons: [], adultDecision: 'none', sexualExplicitConfidence: 0 }),
  }), null);
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'BOUDOIR_01',
    result: result(null, { safetyBlocked: true }),
  }), null);
});

test('keeps visible genitalia without a sex act non-explicit', () => {
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'BORDERLINE_01',
    result: result({
      triggers: [trigger('adultEroticSuggestive', 0.9)],
      forbiddenReasons: [],
      adultDecision: 'borderline',
      sexualExplicitConfidence: 0.2,
    }),
  }), null);
  assert.match(getGoldenClassifierExpectationFailure({
    id: 'BORDERLINE_01',
    result: result({
      triggers: [],
      forbiddenReasons: ['sexualExplicit'],
      adultDecision: 'explicit',
      sexualExplicitConfidence: 0.9,
    }),
  }), /must remain borderline adult nudity/);
});

test('requires explicit sexual acts to be forbidden, while accepting a provider safety block', () => {
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'EXPLICIT_01',
    result: result({
      triggers: [],
      forbiddenReasons: ['sexualExplicit'],
      adultDecision: 'explicit',
      sexualExplicitConfidence: 0.95,
    }),
  }), null);
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'EXPLICIT_01',
    result: result(null, { safetyBlocked: true }),
  }), null);
});
