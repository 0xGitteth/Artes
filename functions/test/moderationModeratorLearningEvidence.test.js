import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModeratorLearningEvidence,
  buildModeratorLearningPromptPlan,
  normalizeModeratorPartialVisualEvidence,
} from '../moderationModeratorLearningEvidence.js';

const fullAiLabel = () => ({
  nudity: 'underwear_swimwear',
  sexualContext: 'suggestive',
  graphicInjury: 'none',
  sensitiveSignals: [],
  possibleMinorConcern: false,
  confidence: 0.86,
  uncertaintyFlags: [],
});

test('valid AI detector output can be confirmed with one moderator action', () => {
  const plan = buildModeratorLearningPromptPlan({
    reasonCode: 'allowed_boudoir',
    aiDetectorLabel: fullAiLabel(),
  });
  assert.equal(plan.mode, 'confirm_or_correct_ai_label');
  assert.equal(plan.canConfirmAiAsFullLabel, true);
  assert.deepEqual(plan.suggestedFields, ['nudity', 'sexualContext']);

  const evidence = buildModeratorLearningEvidence({
    reasonCode: 'allowed_boudoir',
    aiDetectorLabel: fullAiLabel(),
    confirmAiLabel: true,
  });
  assert.equal(evidence.completeness, 'full');
  assert.equal(evidence.source, 'moderator_confirmed_ai_detector_label');
  assert.equal(evidence.detectorLabel.nudity, 'underwear_swimwear');
  assert.equal(evidence.detectorLabel.confidence, 1);
});

test('boudoir correction can store only the relevant confirmed visual fields', () => {
  const evidence = buildModeratorLearningEvidence({
    reasonCode: 'allowed_boudoir',
    visualEvidence: {
      nudity: 'implied_nude',
      sexualContext: 'suggestive',
    },
  });
  assert.equal(evidence.completeness, 'partial');
  assert.deepEqual(evidence.confirmedFields, ['nudity', 'sexualContext']);
  assert.equal(evidence.detectorLabel, null);
  assert.deepEqual(evidence.visualEvidence, {
    nudity: 'implied_nude',
    sexualContext: 'suggestive',
  });
});

test('explicit-sex reason fixes explicit_act without inventing unrelated detector fields', () => {
  const plan = buildModeratorLearningPromptPlan({ reasonCode: 'forbidden_explicit_sexual' });
  assert.equal(plan.fixedFields.sexualContext, 'explicit_act');

  const evidence = buildModeratorLearningEvidence({
    reasonCode: 'forbidden_explicit_sexual',
    visualEvidence: { nudity: 'genitalia' },
  });
  assert.equal(evidence.completeness, 'partial');
  assert.equal(evidence.visualEvidence.sexualContext, 'explicit_act');
  assert.equal(evidence.visualEvidence.nudity, 'genitalia');
  assert.equal(evidence.detectorLabel, null);
});

test('safety reasons can confirm the relevant sensitive signal without pretending to know the rest', () => {
  const evidence = buildModeratorLearningEvidence({
    reasonCode: 'forbidden_self_harm_instruction',
    visualEvidence: { graphicInjury: 'mild' },
  });
  assert.deepEqual(evidence.visualEvidence.sensitiveSignals, ['selfHarm']);
  assert.equal(evidence.visualEvidence.graphicInjury, 'mild');
  assert.equal(evidence.completeness, 'partial');
});

test('all concrete visual fields produce a full training label', () => {
  const evidence = buildModeratorLearningEvidence({
    reasonCode: 'wrong_theme_or_label',
    visualEvidence: {
      nudity: 'female_bare_breasts',
      sexualContext: 'none',
      graphicInjury: 'none',
      sensitiveSignals: [],
      possibleMinorConcern: false,
    },
  });
  assert.equal(evidence.completeness, 'full');
  assert.equal(evidence.detectorLabel.nudity, 'female_bare_breasts');
  assert.equal(evidence.detectorLabel.confidence, 1);
});

test('partial evidence validation rejects unsupported values rather than silently normalizing them', () => {
  const result = normalizeModeratorPartialVisualEvidence({
    nudity: 'somewhat_nude',
    sexualContext: 'none',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('invalid_nudity'));
});

test('AI confirmation fails closed when no valid full detector label exists', () => {
  assert.throws(
    () => buildModeratorLearningEvidence({ reasonCode: 'allowed_art_nude', confirmAiLabel: true }),
    /cannot_confirm_missing_or_invalid_ai_detector_label/,
  );
});
