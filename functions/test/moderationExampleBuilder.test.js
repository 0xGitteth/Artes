import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCommonModerationExample, mapFinalOutcomeByAction } from '../moderationExampleBuilder.js';

const nowFactory = () => 'NOW';
const base = () => ({ source: 'moderatorDecide', nowFactory, uploadId: 'u1', reviewCaseId: 'r1', uploaderUid: 'owner1' });

test('upload payload in index preserves userId with uploaderUid additive', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(source, /userId:\s*userId\s*\|\|\s*null/);
  assert.match(source, /uploaderUid:\s*userId\s*\|\|\s*null/);
});

test('all paths include schemaVersion/source/finalOutcome/learningStatus', () => {
  const allowed = buildCommonModerationExample({ ...base(), decision: 'approved', moderatorDecision: { action: 'approveAsIs' } });
  const forbidden = buildCommonModerationExample({ ...base(), decision: 'rejected', moderatorDecision: { action: 'rejectForbidden' } });
  const needsCorrection = buildCommonModerationExample({ ...base(), moderatorDecision: { action: 'requestUserCorrection' } });
  const freshQueued = buildCommonModerationExample({ ...base(), source: 'moderatorQueueFreshEvaluation', moderatorDecision: { action: 'queueFreshEvaluation' } });
  for (const ex of [allowed, forbidden, needsCorrection, freshQueued]) {
    assert.equal(typeof ex.schemaVersion, 'number');
    assert.ok(ex.source);
    assert.ok(ex.finalOutcome);
    assert.ok(ex.learningStatus);
  }
});

test('specific finalOutcome mappings are correct', () => {
  assert.equal(mapFinalOutcomeByAction({ action: 'requestUserCorrection' }), 'needs_user_correction');
  assert.equal(mapFinalOutcomeByAction({ action: 'queueFreshEvaluation' }), 'fresh_eval_queued');
  assert.equal(mapFinalOutcomeByAction({ action: 'acceptCorrection' }), 'correction_accepted');
  assert.equal(mapFinalOutcomeByAction({ action: 'rejectCorrection' }), 'user_disagreed');
});

test('accept/reject correction outcomes are driven by correction action, not prior requestUserCorrection', () => {
  const accepted = buildCommonModerationExample({
    ...base(),
    moderatorDecision: { action: 'acceptCorrection', priorAction: 'requestUserCorrection' },
    userCorrectionAction: { acceptedCorrection: true, rejectedCorrection: false, requestedReview: false },
  });
  const rejected = buildCommonModerationExample({
    ...base(),
    moderatorDecision: { action: 'rejectCorrection', priorAction: 'requestUserCorrection' },
    userCorrectionAction: { acceptedCorrection: false, rejectedCorrection: true, requestedReview: true },
  });
  assert.equal(accepted.finalOutcome, 'correction_accepted');
  assert.equal(accepted.learningStatus, 'resolved');
  assert.equal(rejected.finalOutcome, 'user_disagreed');
  assert.equal(rejected.learningStatus, 'active');
});

test('correction paths use normalized shape and no sensitive blobs', () => {
  const accepted = buildCommonModerationExample({
    ...base(),
    moderatorDecision: { action: 'acceptCorrection', correctedTaxonomy: { themes: ['Art Nude'], triggers: [] } },
    aiResult: { outcome: 'allowed', prompt: 'secret', rawOutput: 'secret', visionLabelsRaw: ['nudity'] },
    userCorrectionAction: { acceptedCorrection: true, rejectedCorrection: false, requestedReview: false },
  });
  assert.equal(accepted.aiSnapshot.prompt, undefined);
  assert.equal(accepted.aiSnapshot.rawOutput, undefined);
  assert.equal(accepted.uploaderInput.prompt, undefined);
  assert.equal(accepted.userCorrectionAction.acceptedCorrection, true);
});

test('missing optional fields do not crash', () => {
  const ex = buildCommonModerationExample({ nowFactory });
  assert.equal(ex.aiSuggestedTaxonomy.confidence, null);
  assert.deepEqual(ex.policyDecision.forbiddenReasons, []);
  assert.equal(ex.aiSafetySignals.safeSearch, null);
});


test('moderator examples retain top-level persisted review evidence when aiResult is absent', () => {
  const ex = buildCommonModerationExample({
    ...base(),
    decision: 'approved',
    policyDecisionOutcome: 'allowed',
    uploadData: {
      outcome: 'review',
      classification: 'uncertain_possible_explicit',
      shouldReview: true,
      appliedTriggers: [{ trigger: 'adultArtNude', source: 'policyAuto' }],
      suggestedTriggers: [{ trigger: 'bloodInjury', source: 'gemini', score: 0.6 }],
      forbiddenReasons: [{ trigger: 'geminiSafetyBlocked', reason: 'candidate_safety' }],
      requiredThemes: ['Art Nude'],
      geminiDiagnostics: { safetyBlocked: true, safetyBlockReason: 'candidate_safety' },
    },
    aiResult: {},
    moderatorDecision: { action: 'approveAsIs' },
  });

  assert.equal(ex.aiSnapshot.classification, 'uncertain_possible_explicit');
  assert.equal(ex.aiSnapshot.shouldReview, true);
  assert.deepEqual(ex.aiSnapshot.forbiddenReasons, [{ trigger: 'geminiSafetyBlocked', reason: 'candidate_safety' }]);
  assert.deepEqual(ex.policyDecision.forbiddenReasons, [{ trigger: 'geminiSafetyBlocked', reason: 'candidate_safety' }]);
  assert.deepEqual(ex.aiSnapshot.appliedTriggers, [{ trigger: 'adultArtNude', source: 'policyAuto' }]);
  assert.deepEqual(ex.aiSnapshot.requiredThemes, ['Art Nude']);
  assert.equal(ex.aiSnapshot.geminiDiagnostics.safetyBlocked, true);
});

test('moderator examples fall back to review-case aiSummary evidence when upload evidence is absent', () => {
  const ex = buildCommonModerationExample({
    ...base(),
    decision: 'approved',
    policyDecisionOutcome: 'allowed',
    uploadData: { outcome: 'review' },
    reviewData: {
      caseType: 'upload',
      aiSummary: {
        classification: 'uncertain_possible_explicit',
        shouldReview: true,
        forbiddenReasons: [{ trigger: 'geminiSafetyBlocked', reason: 'candidate_safety' }],
        appliedTriggers: [{ trigger: 'adultArtNude', source: 'policyAuto' }],
        suggestedTriggers: [{ trigger: 'bloodInjury', source: 'gemini', score: 0.6 }],
        moderationSignals: {
          adultDecision: 'borderline',
          sexualExplicitConfidence: 0.2,
        },
        geminiDiagnostics: {
          safetyBlocked: true,
          safetyBlockReason: 'candidate_safety',
        },
      },
    },
    aiResult: {},
    moderationSignals: {},
    moderatorDecision: { action: 'approveAsIs' },
  });

  assert.equal(ex.aiSnapshot.classification, 'uncertain_possible_explicit');
  assert.equal(ex.aiSnapshot.shouldReview, true);
  assert.equal(ex.policyDecision.shouldReview, true);
  assert.deepEqual(ex.aiSnapshot.forbiddenReasons, [{ trigger: 'geminiSafetyBlocked', reason: 'candidate_safety' }]);
  assert.deepEqual(ex.aiSnapshot.appliedTriggers, [{ trigger: 'adultArtNude', source: 'policyAuto' }]);
  assert.deepEqual(ex.aiSnapshot.suggestedTriggers, [{ trigger: 'bloodInjury', source: 'gemini', score: 0.6 }]);
  assert.equal(ex.aiSnapshot.adultDecision, 'borderline');
  assert.equal(ex.aiSnapshot.sexualExplicitConfidence, 0.2);
  assert.equal(ex.aiSnapshot.geminiDiagnostics.safetyBlocked, true);
});
