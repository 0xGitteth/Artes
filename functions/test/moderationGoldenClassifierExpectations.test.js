import test from 'node:test';
import assert from 'node:assert/strict';
import { getGoldenClassifierExpectationFailure } from '../moderationGoldenClassifierExpectations.js';

const result = (parsed, diagnostics = {}) => ({
  parsed, diagnostics: { success: true, contractValidated: true, ...diagnostics },
});
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

test('requires automatic general allowance for covered ordinary boudoir', () => {
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'BOUDOIR_01',
    result: result({ triggers: [], forbiddenReasons: [], adultDecision: 'none', sexualExplicitConfidence: 0 }),
  }), null);
  assert.match(getGoldenClassifierExpectationFailure({
    id: 'BOUDOIR_01',
    result: result(null, { safetyBlocked: true }),
  }), /provider refusal does not satisfy automatic Artes classification/);
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

test('requires clear explicit sexual acts to be automatically forbidden', () => {
  assert.equal(getGoldenClassifierExpectationFailure({
    id: 'EXPLICIT_01',
    result: result({
      triggers: [],
      forbiddenReasons: ['sexualExplicit'],
      adultDecision: 'explicit',
      sexualExplicitConfidence: 0.95,
    }),
  }), null);
  assert.match(getGoldenClassifierExpectationFailure({
    id: 'EXPLICIT_01',
    result: result(null, { safetyBlocked: true }),
  }), /provider refusal does not satisfy automatic Artes classification/);
});

test('provider refusal never passes the automatic decision goal for any clear golden fixture', () => {
  for (const id of ['ADULT_BDSM_01', 'BOUDOIR_01', 'BORDERLINE_01', 'EXPLICIT_01']) {
    assert.match(getGoldenClassifierExpectationFailure({ id, result: result(null, { safetyBlocked: true }) }), /provider refusal/);
  }
});

test('clear non-explicit nudity does not pass when the model asks for sexual uncertainty review', () => {
  assert.match(getGoldenClassifierExpectationFailure({
    id: 'BORDERLINE_01',
    result: result({ triggers: [], forbiddenReasons: ['sexual_explicit_uncertain'], adultDecision: 'borderline', sexualExplicitConfidence: 0.2 }),
  }), /not sent to review/);
});

test('clear explicit acts do not pass when medium confidence would send them to review', () => {
  assert.match(getGoldenClassifierExpectationFailure({
    id: 'EXPLICIT_01',
    result: result({ triggers: [], forbiddenReasons: ['sexualExplicit'], adultDecision: 'explicit', sexualExplicitConfidence: 0.6 }),
  }), /automatic prohibition.*not review/);
});

test('unvalidated responses cannot pass the automatic decision goal', () => {
  assert.match(getGoldenClassifierExpectationFailure({
    id: 'BOUDOIR_01',
    result: result({ triggers: [], forbiddenReasons: [], adultDecision: 'none', sexualExplicitConfidence: 0 }, { contractValidated: false }),
  }), /expected a validated classifier result/);
});
