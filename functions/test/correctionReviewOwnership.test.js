import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeCorrectionReviewCasePlan, resolveCorrectionReviewReopenPlan, validateCorrectionAcceptancePlanProvenance, validateRoutedCorrectionAcceptanceProvenance } from '../correctionReviewOwnership.js';

test('direct review case on the owned upload can be reopened', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { reviewCaseId: 'case-owned' },
    userId: 'u1',
    newReviewCaseId: 'case-fresh',
  });
  assert.equal(plan.targetReviewCaseId, 'case-owned');
  assert.equal(plan.createNewReviewCase, false);
});

test('same-uploader routed correction keeps the source case as provenance only', () => {
  const acceptancePlan = resolveCorrectionReviewReopenPlan({
    upload: {
      correctionReviewCaseId: 'case-source',
      correctionReviewCaseOwnerUid: 'u1',
    },
    userId: 'u1',
    newReviewCaseId: null,
  });
  assert.equal(acceptancePlan.targetReviewCaseId, null);
  assert.equal(acceptancePlan.sourceReviewCaseId, 'case-source');
  assert.equal(acceptancePlan.createNewReviewCase, true);

  const rejectionPlan = resolveCorrectionReviewReopenPlan({
    upload: {
      correctionReviewCaseId: 'case-source',
      correctionReviewCaseOwnerUid: 'u1',
    },
    userId: 'u1',
    newReviewCaseId: 'case-fresh',
  });
  assert.equal(rejectionPlan.targetReviewCaseId, 'case-fresh');
  assert.equal(rejectionPlan.sourceReviewCaseId, 'case-source');
  assert.equal(rejectionPlan.createNewReviewCase, true);
});

test('cross-uploader routed correction gets a fresh owned case', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: {
      correctionReviewCaseId: 'case-uploader-a',
      correctionReviewCaseOwnerUid: 'uploader-a',
    },
    userId: 'uploader-b',
    newReviewCaseId: 'case-uploader-b',
  });
  assert.equal(plan.targetReviewCaseId, 'case-uploader-b');
  assert.equal(plan.sourceReviewCaseId, 'case-uploader-a');
  assert.equal(plan.createNewReviewCase, true);
});

test('legacy routed correction with unknown source owner fails closed to a fresh case', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { correctionReviewCaseId: 'legacy-case' },
    userId: 'u1',
    newReviewCaseId: 'fresh-case',
  });
  assert.equal(plan.targetReviewCaseId, 'fresh-case');
  assert.equal(plan.createNewReviewCase, true);
});


test('cross-uploader acceptance does not adopt the source review case', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: {
      correctionReviewCaseId: 'case-uploader-a',
      correctionReviewCaseOwnerUid: 'uploader-a',
    },
    userId: 'uploader-b',
    newReviewCaseId: null,
  });
  assert.equal(plan.targetReviewCaseId, null);
  assert.equal(plan.sourceReviewCaseId, 'case-uploader-a');
  assert.equal(plan.createNewReviewCase, true);
});


test('routed siblings cannot share an operational correction case in either ordering', () => {
  const acceptedSibling = resolveCorrectionReviewReopenPlan({
    upload: { correctionReviewCaseId: 'shared-source', correctionReviewCaseOwnerUid: 'u1' },
    userId: 'u1',
    newReviewCaseId: null,
  });
  const rejectedSibling = resolveCorrectionReviewReopenPlan({
    upload: { correctionReviewCaseId: 'shared-source', correctionReviewCaseOwnerUid: 'u1' },
    userId: 'u1',
    newReviewCaseId: 'fresh-rejection-case',
  });
  assert.equal(acceptedSibling.targetReviewCaseId, null);
  assert.equal(rejectedSibling.targetReviewCaseId, 'fresh-rejection-case');
  assert.notEqual(rejectedSibling.targetReviewCaseId, acceptedSibling.sourceReviewCaseId);
});

test('legacy foreign direct cases are not adopted by correction acceptance', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { reviewCaseId: 'foreign-case' },
    userId: 'u1',
    newReviewCaseId: null,
  });
  const finalized = finalizeCorrectionReviewCasePlan({
    plan,
    action: 'acceptCorrection',
    userId: 'u1',
    persistedCaseExists: true,
    persistedCase: { userId: 'u2', status: 'approved' },
  });
  assert.equal(finalized.targetReviewCaseId, null);
  assert.equal(finalized.createNewReviewCase, true);
  assert.equal(finalized.acceptanceBlocked, true);
});

test('legacy foreign direct cases get a fresh owned case on correction rejection', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { reviewCaseId: 'foreign-case' },
    userId: 'u1',
    newReviewCaseId: 'fresh-u1-case',
  });
  const finalized = finalizeCorrectionReviewCasePlan({
    plan,
    action: 'rejectCorrection',
    userId: 'u1',
    persistedCaseExists: true,
    persistedCase: { userId: 'u2', status: 'approved' },
    newReviewCaseId: 'fresh-u1-case',
  });
  assert.equal(finalized.targetReviewCaseId, 'fresh-u1-case');
  assert.equal(finalized.createNewReviewCase, true);
});


test('a new moderator correction epoch clears the old rejection and accepts only the current request', () => {
  const currentDecision = {
    action: 'requestUserCorrection',
    correctedTaxonomy: { themes: ['Portrait'], triggers: ['bloodInjury'] },
  };
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { reviewCaseId: 'case-a' },
    userId: 'u1',
  });
  const finalized = finalizeCorrectionReviewCasePlan({
    plan,
    action: 'acceptCorrection',
    userId: 'u1',
    persistedCaseExists: true,
    persistedCase: { userId: 'u1', status: 'approved', uploadId: 'upload-a', moderatorDecision: currentDecision },
    upload: { moderatorDecision: currentDecision },
    uploadId: 'upload-a',
  });
  assert.equal(finalized.correctionSuperseded, false);
  assert.equal(finalized.acceptanceBlocked, false);
});

test('direct correction case must reference the current upload before it can be reused', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { reviewCaseId: 'case-direct' },
    userId: 'u1',
    newReviewCaseId: 'fresh-case',
  });
  const detached = finalizeCorrectionReviewCasePlan({
    plan,
    action: 'rejectCorrection',
    userId: 'u1',
    persistedCaseExists: true,
    persistedCase: { userId: 'u1', status: 'approved', uploadId: 'different-upload' },
    newReviewCaseId: 'fresh-case',
    uploadId: 'current-upload',
    upload: { moderatorDecision: { action: 'requestUserCorrection', correctedTaxonomy: { themes: ['Portrait'], triggers: [] } } },
  });
  assert.equal(detached.targetReviewCaseId, 'fresh-case');
  assert.equal(detached.createNewReviewCase, true);
});

test('direct case rejection cannot reopen after a newer moderator decision', () => {
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { reviewCaseId: 'direct-case' },
    userId: 'u1',
    newReviewCaseId: 'fresh-case',
  });
  const finalized = finalizeCorrectionReviewCasePlan({
    plan,
    action: 'rejectCorrection',
    userId: 'u1',
    persistedCaseExists: true,
    persistedCase: {
      userId: 'u1',
      uploadId: 'upload-a',
      status: 'approved',
      moderatorDecision: { action: 'approveAsIs', correctedTaxonomy: { themes: [], triggers: [] } },
    },
    upload: {
      moderatorDecision: {
        action: 'requestUserCorrection',
        correctedTaxonomy: { themes: ['Portrait'], triggers: ['bloodInjury'] },
      },
    },
    uploadId: 'upload-a',
    newReviewCaseId: 'fresh-case',
  });
  assert.equal(finalized.correctionSuperseded, true);
  assert.equal(finalized.rejectionBlocked, true);
});

test('reissuing the exact same correction keeps a linked direct-case response semantically valid', () => {
  const decision = {
    action: 'requestUserCorrection',
    correctedTaxonomy: { themes: ['Portrait'], triggers: ['bloodInjury'] },
  };
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { reviewCaseId: 'direct-case' },
    userId: 'u1',
  });
  const finalized = finalizeCorrectionReviewCasePlan({
    plan,
    action: 'acceptCorrection',
    userId: 'u1',
    persistedCaseExists: true,
    persistedCase: { userId: 'u1', uploadId: 'upload-a', status: 'approved', moderatorDecision: decision },
    upload: { moderatorDecision: decision },
    uploadId: 'upload-a',
  });
  assert.equal(finalized.correctionSuperseded, false);
  assert.equal(finalized.acceptanceBlocked, false);
});

test('fresh-evaluation queue invalidates direct correction acceptance', () => {
  const decision = {
    action: 'requestUserCorrection',
    correctedTaxonomy: { themes: ['Portrait'], triggers: ['selfHarm'] },
  };
  for (const status of ['freshEvalQueued', 'closedNoFingerprint', 'inReview', 'rejected']) {
    const plan = resolveCorrectionReviewReopenPlan({ upload: { reviewCaseId: 'case-a' }, userId: 'u1' });
    const finalized = finalizeCorrectionReviewCasePlan({
      plan,
      action: 'acceptCorrection',
      userId: 'u1',
      persistedCaseExists: true,
      persistedCase: { userId: 'u1', uploadId: 'upload-a', status, moderatorDecision: decision },
      upload: { moderatorDecision: decision },
      uploadId: 'upload-a',
    });
    assert.equal(finalized.acceptanceBlocked, true, `status ${status} must invalidate acceptance`);
  }
});

test('routed correction acceptance revalidates source provenance without adopting the source case', () => {
  const decision = {
    action: 'requestUserCorrection',
    correctedTaxonomy: { themes: ['Portrait'], triggers: ['selfHarm'] },
  };
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { correctionReviewCaseId: 'source-case', correctionReviewCaseOwnerUid: 'source-user' },
    userId: 'routed-user',
  });
  const valid = validateRoutedCorrectionAcceptanceProvenance({
    plan,
    action: 'acceptCorrection',
    persistedSourceCaseExists: true,
    persistedSourceCase: { userId: 'source-user', status: 'approved', moderatorDecision: decision },
    upload: { moderatorDecision: decision },
  });
  assert.equal(valid.acceptanceBlocked, false);
  assert.equal(plan.targetReviewCaseId, null);
  assert.equal(plan.createNewReviewCase, true);

  for (const status of ['freshEvalQueued', 'closedNoFingerprint', 'inReview', 'rejected']) {
    const invalid = validateRoutedCorrectionAcceptanceProvenance({
      plan,
      action: 'acceptCorrection',
      persistedSourceCaseExists: true,
      persistedSourceCase: { userId: 'source-user', status, moderatorDecision: decision },
      upload: { moderatorDecision: decision },
    });
    assert.equal(invalid.acceptanceBlocked, true, `source status ${status} must invalidate routed acceptance`);
  }
});

test('routed correction acceptance fails closed for missing, mismatched-owner, or superseded provenance', () => {
  const decision = {
    action: 'requestUserCorrection',
    correctedTaxonomy: { themes: ['Portrait'], triggers: ['selfHarm'] },
  };
  const plan = resolveCorrectionReviewReopenPlan({
    upload: { correctionReviewCaseId: 'source-case', correctionReviewCaseOwnerUid: 'source-user' },
    userId: 'routed-user',
  });
  const missing = validateRoutedCorrectionAcceptanceProvenance({
    plan,
    action: 'acceptCorrection',
    persistedSourceCaseExists: false,
    upload: { moderatorDecision: decision },
  });
  assert.equal(missing.acceptanceBlocked, true);

  const ownerMismatch = validateRoutedCorrectionAcceptanceProvenance({
    plan,
    action: 'acceptCorrection',
    persistedSourceCaseExists: true,
    persistedSourceCase: { userId: 'different-source-user', status: 'approved', moderatorDecision: decision },
    upload: { moderatorDecision: decision },
  });
  assert.equal(ownerMismatch.acceptanceBlocked, true);

  const superseded = validateRoutedCorrectionAcceptanceProvenance({
    plan,
    action: 'acceptCorrection',
    persistedSourceCaseExists: true,
    persistedSourceCase: {
      userId: 'source-user',
      status: 'approved',
      moderatorDecision: { action: 'approveAsIs', correctedTaxonomy: { themes: [], triggers: [] } },
    },
    upload: { moderatorDecision: decision },
  });
  assert.equal(superseded.acceptanceBlocked, true);
  assert.equal(superseded.correctionSuperseded, true);
});

test('routed correction acceptance requires explicit matching source ownership', () => {
  const decision = {
    action: 'requestUserCorrection',
    correctedTaxonomy: { themes: ['Portrait'], triggers: ['selfHarm'] },
  };

  const legacyPlan = resolveCorrectionReviewReopenPlan({
    upload: { correctionReviewCaseId: 'legacy-source-case' },
    userId: 'routed-user',
  });
  const unknownExpectedOwner = validateRoutedCorrectionAcceptanceProvenance({
    plan: legacyPlan,
    action: 'acceptCorrection',
    persistedSourceCaseExists: true,
    persistedSourceCase: { userId: 'source-user', status: 'approved', moderatorDecision: decision },
    upload: { moderatorDecision: decision },
  });
  assert.equal(unknownExpectedOwner.acceptanceBlocked, true);

  const ownedPlan = resolveCorrectionReviewReopenPlan({
    upload: {
      correctionReviewCaseId: 'source-case',
      correctionReviewCaseOwnerUid: 'source-user',
    },
    userId: 'routed-user',
  });
  const missingPersistedOwner = validateRoutedCorrectionAcceptanceProvenance({
    plan: ownedPlan,
    action: 'acceptCorrection',
    persistedSourceCaseExists: true,
    persistedSourceCase: { status: 'approved', moderatorDecision: decision },
    upload: { moderatorDecision: decision },
  });
  assert.equal(missingPersistedOwner.acceptanceBlocked, true);
});


test('correction acceptance plan requires a verifiable persisted source id', () => {
  const missing = resolveCorrectionReviewReopenPlan({ upload: {}, userId: 'u1', newReviewCaseId: null });
  assert.deepEqual(validateCorrectionAcceptancePlanProvenance({ plan: missing, action: 'acceptCorrection' }), { acceptanceBlocked: true, provenanceMissing: true });
  assert.deepEqual(validateCorrectionAcceptancePlanProvenance({ plan: missing, action: 'rejectCorrection' }), { acceptanceBlocked: false, provenanceMissing: false });
  const direct = resolveCorrectionReviewReopenPlan({ upload: { reviewCaseId: 'direct-case' }, userId: 'u1' });
  assert.equal(validateCorrectionAcceptancePlanProvenance({ plan: direct, action: 'acceptCorrection' }).acceptanceBlocked, false);
  const routed = resolveCorrectionReviewReopenPlan({ upload: { correctionReviewCaseId: 'source-case', correctionReviewCaseOwnerUid: 'source-user' }, userId: 'u1' });
  assert.equal(validateCorrectionAcceptancePlanProvenance({ plan: routed, action: 'acceptCorrection' }).acceptanceBlocked, false);
});
