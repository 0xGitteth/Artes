import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommonModerationExample, mapFinalOutcomeByAction } from '../moderationExampleBuilder.js';

const nowFactory = () => 'NOW';

const base = () => ({ source: 'moderatorDecide', nowFactory, uploadId: 'u1', reviewCaseId: 'r1', uploaderUid: 'owner1' });

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

test('correction paths use normalized shape and no sensitive blobs', () => {
  const accepted = buildCommonModerationExample({
    ...base(),
    moderatorDecision: { action: 'acceptCorrection', correctedTaxonomy: { themes: ['Art Nude'], triggers: [] } },
    aiResult: { outcome: 'allowed', prompt: 'secret', rawOutput: 'secret', visionLabelsRaw: ['nudity'] },
    userCorrectionAction: { acceptedCorrection: true, rejectedCorrection: false, requestedReview: false },
  });
  const rejected = buildCommonModerationExample({ ...base(), moderatorDecision: { action: 'rejectCorrection' }, userCorrectionAction: { acceptedCorrection: false, rejectedCorrection: true, requestedReview: true } });
  assert.equal(accepted.finalOutcome, 'correction_accepted');
  assert.equal(rejected.finalOutcome, 'user_disagreed');
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
