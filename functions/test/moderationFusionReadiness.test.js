import assert from 'node:assert/strict';
import test from 'node:test';

import { composeModerationPolicyResult } from '../moderationPolicy.js';
import { enforceCustomDetectorReview } from '../moderationCustomDetector.js';

test('experimental fusion cannot authorize unapproved model to skip review', () => {
  const baseline = composeModerationPolicyResult({
    normalizedThemes: ['Art Nude'],
  });
  assert.equal(baseline.outcome, 'allowed');
  const guarded = enforceCustomDetectorReview({
    policyResult: baseline,
    assessment: { automated: false, reason: 'model_not_approved' },
  });
  assert.equal(guarded.outcome, 'review');
  assert.equal(guarded.publishBlocked, true);
  assert.equal(guarded.shouldReview, true);
  assert.ok(guarded.forbiddenReasons.some(
    (reason) => reason.trigger === 'customDetectorReview'
      && reason.reason === 'model_not_approved',
  ));
});

test('reliable nonexplicit signal does not erase severe SafeSearch disagreement', () => {
  const policy = composeModerationPolicyResult({
    normalizedThemes: ['Art Nude'],
    customDetectorEvidence: {
      reliable: true,
      adultDecision: 'none',
      sexualExplicitConfidence: 0,
    },
    safeSearchAdultScore: 0.95,
    safeSearchNudityScore: 0.95,
  });
  assert.equal(policy.outcome, 'review');
  assert.equal(policy.classification, 'uncertain_possible_explicit');
  assert.equal(policy.publishBlocked, true);
});

test('existing explicit sexual act forbidden reason is never overridden by nudity theme', () => {
  const policy = composeModerationPolicyResult({
    normalizedThemes: ['Art Nude'],
    forbiddenReasons: [{
      trigger: 'sexualExplicit',
      reason: 'visible_explicit_sexual_act',
      source: 'artesCustomDetector',
      score: 1,
    }],
  });
  assert.equal(policy.outcome, 'forbidden');
  assert.equal(policy.classification, 'disallowed_sexual_explicit');
  assert.equal(policy.publishBlocked, true);
});

test('research-only evaluation never implies live moderation authorization', () => {
  const initial = composeModerationPolicyResult({
    normalizedThemes: ['Art Nude'],
    appliedTriggers: [{ trigger: 'adultArtNude', score: 1, source: 'themeRule' }],
  });
  const final = enforceCustomDetectorReview({
    policyResult: initial,
    assessment: { automated: false, reason: 'class_not_calibrated' },
  });
  assert.equal(final.outcome, 'review');
  assert.equal(final.publishBlocked, true);
});
