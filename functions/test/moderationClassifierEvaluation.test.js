import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateClassifierAvailability, evaluateReviewedClassifierResult,
  getHumanClassifierExpectation, summarizeClassifierEvaluation,
} from '../moderationClassifierEvaluation.js';

const trigger = (name, confidence = 0.9) => ({ trigger: name, confidence, severity: 'suggest', graphic: false });
const result = (adultDecision = 'none', triggers = [], forbiddenReasons = []) => ({
  parsed: { adultDecision, triggers, forbiddenReasons, sexualExplicitConfidence: adultDecision === 'explicit' ? 0.95 : 0.1 },
  diagnostics: { success: true, contractValidated: true, safetyBlocked: false },
});
const evaluate = (nudity, sexualContext, prediction) => evaluateReviewedClassifierResult({ label: { nudity, sexualContext }, result: prediction });

test('covered lingerie and a bare male torso remain general without sexual context', () => {
  for (const nudity of ['none', 'underwear_swimwear', 'male_topless']) {
    assert.deepEqual(getHumanClassifierExpectation({ nudity, sexualContext: 'none' }), { adultDecision: 'none', sexualContext: 'none', access: 'general' });
    assert.equal(evaluate(nudity, 'none', result()).correct, true);
  }
});

test('every adult nudity stratum, including the broadened pubic region, is non-explicit without an act', () => {
  for (const nudity of ['implied_nude', 'female_bare_breasts', 'bare_buttocks', 'genitalia']) {
    const evaluation = evaluate(nudity, 'none', result('borderline'));
    assert.equal(evaluation.correct, true);
    assert.equal(evaluation.predicted.access, 'adult');
  }
});

test('covered BDSM uses adult access without changing its nudity decision', () => {
  const evaluation = evaluate('underwear_swimwear', 'bdsm_kink', result('none', [trigger('adultEroticSuggestive'), trigger('kinkBdsm')]));
  assert.equal(evaluation.correct, true);
  assert.equal(evaluation.predicted.adultDecision, 'none');
  assert.equal(evaluation.policyProjection.classification, 'allowed_adult_erotic_suggestive');
});

test('explicit acts need an explicit decision and forbidden access', () => {
  const evaluation = evaluate('genitalia', 'explicit_act', result('explicit', [], ['sexualExplicit']));
  assert.equal(evaluation.correct, true);
  assert.equal(evaluation.predicted.access, 'forbidden');
  assert.equal(evaluation.requiresManualReview, false);
});

test('uses the live reason router for medium explicit confidence instead of forcing a prohibition', () => {
  const prediction = result('explicit', [], ['sexualExplicit']);
  prediction.parsed.sexualExplicitConfidence = 0.6;
  const evaluation = evaluate('genitalia', 'explicit_act', prediction);
  assert.equal(evaluation.availability, 'classified');
  assert.equal(evaluation.predicted.access, 'review');
  assert.equal(evaluation.requiresManualReview, true);
});

test('provider block does not become a correct classification or an automatic prohibition', () => {
  const evaluation = evaluate('underwear_swimwear', 'none', { parsed: null, diagnostics: { safetyBlocked: true } });
  assert.equal(evaluation.correct, null);
  assert.equal(evaluation.predicted, null);
  assert.equal(evaluation.requiresManualReview, true);
  const summary = summarizeClassifierEvaluation([evaluation]);
  assert.equal(summary.providerSafetyBlocks, 1);
  assert.equal(summary.classified, 0);
  assert.equal(summary.accuracyAmongClassified, null);
  assert.equal(summary.correctWithoutReviewShare, 0);
});

test('classification coverage and correctness include different denominators', () => {
  const correct = evaluate('none', 'none', result());
  const wrong = evaluate('genitalia', 'none', result());
  const blocked = evaluate('underwear_swimwear', 'none', { diagnostics: { safetyBlocked: true } });
  const error = evaluate('none', 'none', { error: { message: 'offline' } });
  const summary = summarizeClassifierEvaluation([correct, wrong, blocked, error]);
  assert.equal(summary.classifierCoverage, 0.5);
  assert.equal(summary.accuracyAmongClassified, 0.5);
  assert.equal(summary.correctWithoutReviewShare, 0.25);
  assert.equal(summary.manualReviewShare, 0.5);
  assert.equal(summary.falseGeneralAccess, 1);
});

test('well-formed responses with sexual safety uncertainty remain review outcomes', () => {
  for (const reason of ['sexual_explicit_uncertain', 'possible_minor_concern', 'other_safety_review']) {
    const evaluation = evaluate('genitalia', 'none', result('borderline', [], [reason]));
    assert.equal(evaluation.availability, 'classified');
    assert.equal(evaluation.predicted.access, 'review');
    assert.equal(evaluation.accessCorrect, false);
    assert.equal(evaluation.requiresManualReview, true);
  }
});

test('invalid or contradictory JSON cannot inflate coverage even with success diagnostics', () => {
  const contradictory = result('explicit', [], []);
  assert.equal(evaluateClassifierAvailability(contradictory), 'unclassified');
  assert.equal(evaluateClassifierAvailability({ parsed: result().parsed, diagnostics: {} }), 'unclassified');
});

test('missed explicit acts and false prohibitions are reported independently', () => {
  const summary = summarizeClassifierEvaluation([
    evaluate('genitalia', 'explicit_act', result('borderline')),
    evaluate('genitalia', 'none', result('explicit', [], ['sexualExplicit'])),
  ]);
  assert.equal(summary.missedExplicit, 1);
  assert.equal(summary.falseForbiddenAccess, 1);
});
