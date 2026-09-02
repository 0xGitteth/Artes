import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModeratorDecisionLearningFields,
  sanitizeModeratorLearningSubmission,
} from '../moderationModeratorLearningSubmission.js';

const fullAiLabel = () => ({
  nudity: 'underwear_swimwear',
  sexualContext: 'suggestive',
  graphicInjury: 'none',
  sensitiveSignals: [],
  possibleMinorConcern: false,
  confidence: 0.82,
  uncertaintyFlags: [],
});

test('missing learning submission remains optional and adds no decision fields', () => {
  assert.deepEqual(buildModeratorDecisionLearningFields({ reasonCode: 'allowed_boudoir' }), {});
});

test('moderator can confirm a valid AI detector label in one action', () => {
  const fields = buildModeratorDecisionLearningFields({
    reasonCode: 'allowed_boudoir',
    aiDetectorLabel: fullAiLabel(),
    submission: { confirmAiLabel: true },
  });
  assert.equal(fields.moderatorLearningEvidence.completeness, 'full');
  assert.equal(fields.moderatorLearningEvidence.source, 'moderator_confirmed_ai_detector_label');
  assert.equal(fields.detectorLabel.confidence, 1);
});

test('partial moderator evidence is preserved without being promoted to a full detector label', () => {
  const fields = buildModeratorDecisionLearningFields({
    reasonCode: 'allowed_art_nude',
    submission: {
      visualEvidence: {
        nudity: 'female_bare_breasts',
        sexualContext: 'none',
      },
    },
  });
  assert.equal(fields.moderatorLearningEvidence.completeness, 'partial');
  assert.equal(Object.hasOwn(fields, 'detectorLabel'), false);
});

test('explicit sexual rejection fixes the sexual context server-side', () => {
  const fields = buildModeratorDecisionLearningFields({
    reasonCode: 'forbidden_explicit_sexual',
    submission: {
      visualEvidence: {
        nudity: 'genitalia',
      },
    },
  });
  assert.equal(fields.moderatorLearningEvidence.visualEvidence.sexualContext, 'explicit_act');
});

test('submission fails closed for unsupported fields and conflicting modes', () => {
  assert.throws(
    () => sanitizeModeratorLearningSubmission({
      reasonCode: 'allowed_boudoir',
      submission: { unexpected: true },
    }),
    /unsupported_moderator_learning_submission_fields/,
  );
  assert.throws(
    () => sanitizeModeratorLearningSubmission({
      reasonCode: 'allowed_boudoir',
      aiDetectorLabel: fullAiLabel(),
      submission: {
        confirmAiLabel: true,
        visualEvidence: { nudity: 'underwear_swimwear' },
      },
    }),
    /conflicting_modes/,
  );
});
