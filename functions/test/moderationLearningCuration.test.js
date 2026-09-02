import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModeratorLearningLabelPayload,
  resolveLearningCurationFromModeratorDecision,
} from '../moderationLearningCuration.js';

const validLabel = () => ({
  nudity: 'implied_nude',
  sexualContext: 'suggestive',
  graphicInjury: 'none',
  sensitiveSignals: [],
  possibleMinorConcern: false,
  confidence: 1,
  uncertaintyFlags: [],
});

test('a complete human detector label can become approved curation automatically', () => {
  const result = resolveLearningCurationFromModeratorDecision({
    example: {
      moderatorDecision: {
        action: 'approveWithTaxonomyCorrection',
        detectorLabel: validLabel(),
      },
    },
  });
  assert.equal(result.status, 'approved');
  assert.equal(result.requiresAdditionalLabeling, false);
  assert.equal(result.labelSource, 'moderator_decision_detector_label');
});

test('a complete label embedded in moderator learning evidence becomes approved curation', () => {
  const result = resolveLearningCurationFromModeratorDecision({
    example: {
      moderatorDecision: {
        action: 'approveWithTaxonomyCorrection',
        learningEvidence: {
          source: 'moderator_confirmed_ai_detector_label',
          completeness: 'full',
          confirmedFields: ['nudity', 'sexualContext', 'graphicInjury', 'sensitiveSignals', 'possibleMinorConcern'],
          visualEvidence: {
            nudity: 'implied_nude',
            sexualContext: 'suggestive',
            graphicInjury: 'none',
            sensitiveSignals: [],
            possibleMinorConcern: false,
          },
          detectorLabel: validLabel(),
        },
      },
    },
  });
  assert.equal(result.status, 'approved');
  assert.equal(result.requiresAdditionalLabeling, false);
  assert.equal(result.labelSource, 'moderator_confirmed_ai_detector_label');
  assert.equal(result.partialVisualEvidence.completeness, 'full');
});

test('partial moderator visual evidence is preserved without pretending it is a full training label', () => {
  const result = resolveLearningCurationFromModeratorDecision({
    example: {
      moderatorDecision: {
        action: 'approveWithTaxonomyCorrection',
        learningEvidence: {
          source: 'moderator_visual_evidence',
          completeness: 'partial',
          confirmedFields: ['nudity', 'sexualContext'],
          visualEvidence: {
            nudity: 'female_bare_breasts',
            sexualContext: 'none',
          },
          detectorLabel: null,
        },
      },
    },
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.requiresAdditionalLabeling, true);
  assert.equal(result.detectorLabel, null);
  assert.equal(result.labelSource, 'moderator_visual_evidence');
  assert.deepEqual(result.partialVisualEvidence.confirmedFields, ['nudity', 'sexualContext']);
  assert.ok(result.reasons.includes('partial_human_visual_evidence_available'));
});

test('a policy approval alone remains useful evidence but is not falsely treated as a full detector label', () => {
  const result = resolveLearningCurationFromModeratorDecision({
    example: { moderatorDecision: { action: 'approveAsIs' } },
  });
  assert.equal(result.status, 'pending');
  assert.equal(result.requiresAdditionalLabeling, true);
  assert.ok(result.reasons.includes('approval_confirms_policy_outcome_not_every_detector_field'));
});

test('a forbidden moderation decision does not invent the visual reason for rejection', () => {
  const result = resolveLearningCurationFromModeratorDecision({
    example: { moderatorDecision: { action: 'rejectForbidden' } },
  });
  assert.equal(result.status, 'pending');
  assert.ok(result.reasons.includes('forbidden_outcome_does_not_identify_visual_detector_reason'));
});

test('explicit human labels can upgrade historic moderator evidence without mutating the source example', () => {
  const source = { moderatorDecision: { action: 'approveAsIs' } };
  const result = resolveLearningCurationFromModeratorDecision({ example: source, explicitDetectorLabel: validLabel() });
  assert.equal(result.status, 'approved');
  assert.equal(result.labelSource, 'explicit_human_detector_label');
  assert.equal(Object.hasOwn(source.moderatorDecision, 'detectorLabel'), false);
});

test('moderator learning payload rejects malformed detector labels', () => {
  assert.throws(() => buildModeratorLearningLabelPayload({ ...validLabel(), nudity: 'sort_of_nude' }), /invalid_detector_label/);
});
