import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReusableCacheGeminiDiagnostics,
  canRouteNearDuplicateModerationExampleAction,
  compareModerationExampleCandidates,
  hasMatchingReusableModerationTaxonomy,
  isFinalModerationExampleAction,
  isModerationExampleGenerationRouteable,
  isNearDuplicateReuseOwnedByUploader,
  isReusableModerationCache,
  isUploadModerationExampleData,
  selectPreferredModerationExampleCandidate,
} from '../moderationReuseRouting.js';

const reusableDiagnostics = {
  promptVersion: 'gemini_moderation_v2',
  success: true,
  contractValidated: true,
  fallbackUsed: false,
  safetyBlocked: false,
};

test('only successful contract-validated caches from the active Gemini prompt are reusable', () => {
  assert.equal(isReusableModerationCache({}, 'gemini_moderation_v2'), false);
  assert.equal(isReusableModerationCache({ geminiDiagnostics: {} }, 'gemini_moderation_v2'), false);
  assert.equal(isReusableModerationCache({ geminiDiagnostics: { promptVersion: 'gemini_moderation_v1', success: true, contractValidated: true } }, 'gemini_moderation_v2'), false);
  assert.equal(isReusableModerationCache({ geminiDiagnostics: { promptVersion: 'gemini_moderation_v2', success: false, contractValidated: false, fallbackUsed: true } }, 'gemini_moderation_v2'), false);
  assert.equal(isReusableModerationCache({ geminiDiagnostics: { promptVersion: 'gemini_moderation_v2', success: false, contractValidated: false, safetyBlocked: true } }, 'gemini_moderation_v2'), false);
  assert.equal(isReusableModerationCache({ geminiDiagnostics: { promptVersion: 'gemini_moderation_v2', success: true, contractValidated: false } }, 'gemini_moderation_v2'), false);
  assert.equal(isReusableModerationCache({ geminiDiagnostics: reusableDiagnostics }, 'gemini_moderation_v2'), true);
});

test('cache reuse is fenced by the current moderation generation', () => {
  assert.equal(isReusableModerationCache({
    moderationGeneration: 2,
    geminiDiagnostics: reusableDiagnostics,
  }, 'gemini_moderation_v2', 2), true);
  assert.equal(isReusableModerationCache({
    moderationGeneration: 1,
    geminiDiagnostics: reusableDiagnostics,
  }, 'gemini_moderation_v2', 2), false);
  assert.equal(isReusableModerationCache({
    geminiDiagnostics: reusableDiagnostics,
  }, 'gemini_moderation_v2', 0), true, 'legacy generation-zero cache remains usable before any requeue');
  assert.equal(isReusableModerationCache({
    geminiDiagnostics: reusableDiagnostics,
  }, 'gemini_moderation_v2', 1), false, 'legacy cache becomes stale after first generation increment');
});

test('report decisions are excluded from upload moderation-example reuse', () => {
  assert.equal(isUploadModerationExampleData({ caseType: 'report', source: 'moderatorDecide', uploadId: 'upload-a' }), false);
  assert.equal(isUploadModerationExampleData({ caseType: 'upload', source: 'moderatorDecide', uploadId: 'upload-a' }), true);
  assert.equal(isUploadModerationExampleData({ source: 'moderatorDecideReport', uploadId: 'upload-a' }), false);
  assert.equal(isUploadModerationExampleData({ source: 'moderatorDecide' }), false);
  assert.equal(isUploadModerationExampleData({ source: 'moderatorDecide', uploadId: 'upload-a' }), true);
  assert.equal(isUploadModerationExampleData({ source: 'userModerationAction', uploadId: 'upload-a' }), true);
});

test('moderator examples obey the same generation fence as caches', () => {
  assert.equal(isModerationExampleGenerationRouteable({ moderationGeneration: 4 }, 4), true);
  assert.equal(isModerationExampleGenerationRouteable({ moderationGeneration: 3 }, 4), false);
  assert.equal(isModerationExampleGenerationRouteable({}, 0), true);
  assert.equal(isModerationExampleGenerationRouteable({}, 1), false);
});

test('newer fresh evaluation invalidates an older final routing example', () => {
  const oldFinal = {
    id: 'old-final',
    data: { moderatorDecision: { action: 'rejectForbidden', decidedAt: new Date('2026-08-25T20:00:00Z') } },
  };
  const freshBarrier = {
    id: 'fresh-barrier',
    data: { moderatorDecision: { action: 'queueFreshEvaluation', decidedAt: new Date('2026-08-25T20:05:00Z') } },
  };
  assert.ok(compareModerationExampleCandidates(freshBarrier, oldFinal) < 0);
  assert.equal(isFinalModerationExampleAction('queueFreshEvaluation'), false);
});

test('higher generation wins before timestamp ordering', () => {
  const olderTimeNewGeneration = {
    id: 'gen-2',
    data: { moderationGeneration: 2, moderatorDecision: { action: 'approveAsIs', decidedAt: new Date('2026-08-25T19:00:00Z') } },
  };
  const newerTimeOldGeneration = {
    id: 'gen-1',
    data: { moderationGeneration: 1, moderatorDecision: { action: 'rejectForbidden', decidedAt: new Date('2026-08-25T21:00:00Z') } },
  };
  assert.ok(compareModerationExampleCandidates(olderTimeNewGeneration, newerTimeOldGeneration) < 0);
});

test('a final decision made after fresh evaluation becomes routable again', () => {
  const freshBarrier = {
    id: 'fresh-barrier',
    data: { moderatorDecision: { action: 'queueFreshEvaluation', decidedAt: new Date('2026-08-25T20:05:00Z') } },
  };
  const newFinal = {
    id: 'new-final',
    data: { moderatorDecision: { action: 'approveAsIs', decidedAt: new Date('2026-08-25T20:10:00Z') } },
  };
  assert.ok(compareModerationExampleCandidates(newFinal, freshBarrier) < 0);
  assert.equal(isFinalModerationExampleAction('approveAsIs'), true);
});

test('near-duplicate reuse can route the finalized source correction example', () => {
  const currentExact = { id: 'current', data: { moderatorDecision: { action: 'queueFreshEvaluation', decidedAt: new Date('2026-08-26T19:00:00Z') } } };
  const sourceFinal = { id: 'source', data: { moderatorDecision: { action: 'acceptCorrection', decidedAt: new Date('2026-08-26T19:05:00Z') } } };
  assert.equal(selectPreferredModerationExampleCandidate([currentExact, sourceFinal])?.id, 'source');
  assert.equal(selectPreferredModerationExampleCandidate([null, sourceFinal])?.id, 'source');
});

test('cache-hit diagnostics preserve verified provenance without claiming a fresh Gemini call', () => {
  const sourceUpload = {
    moderationGeneration: 3,
    geminiDiagnostics: {
      attempted: true,
      success: true,
      contractValidated: true,
      fallbackUsed: false,
      safetyBlocked: false,
      promptVersion: 'gemini_moderation_v2',
      model: 'gemini-2.5-flash',
      graphicSensitiveSignals: [{ trigger: 'bloodInjury', score: 0.8 }],
    },
  };
  const reused = buildReusableCacheGeminiDiagnostics({
    uploadData: sourceUpload,
    expectedPromptVersion: 'gemini_moderation_v2',
    sourceUploadId: 'source-upload',
    currentGeneration: 3,
  });
  assert.equal(reused.attempted, false);
  assert.equal(reused.success, true);
  assert.equal(reused.contractValidated, true);
  assert.equal(reused.fallbackUsed, false);
  assert.equal(reused.cacheReused, true);
  assert.equal(reused.cacheSourceUploadId, 'source-upload');
  assert.equal(reused.cacheModerationGeneration, 3);
  assert.equal(reused.model, 'gemini-2.5-flash');
  assert.deepEqual(reused.graphicSensitiveSignals, [{ trigger: 'bloodInjury', score: 0.8 }]);
  assert.equal(isReusableModerationCache({ moderationGeneration: 3, geminiDiagnostics: reused }, 'gemini_moderation_v2', 3), true);

  assert.equal(buildReusableCacheGeminiDiagnostics({
    uploadData: { geminiDiagnostics: { promptVersion: 'gemini_moderation_v2', success: false, contractValidated: false } },
    expectedPromptVersion: 'gemini_moderation_v2',
    sourceUploadId: 'bad-source',
  }), null);
});

test('cache taxonomy match is order-independent but fails closed on changed uploader taxonomy', () => {
  const source = {
    userSelectedTaxonomy: {
      themes: ['Boudoir', 'Portrait'],
      triggers: ['kinkBdsm', 'bloodInjury'],
    },
  };
  assert.equal(hasMatchingReusableModerationTaxonomy({
    uploadData: source,
    themes: ['Portrait', 'Boudoir', 'Portrait'],
    makerTags: ['bloodInjury', 'kinkBdsm', 'bloodInjury'],
  }), true);
  assert.equal(hasMatchingReusableModerationTaxonomy({
    uploadData: source,
    themes: ['Portrait', 'Boudoir'],
    makerTags: ['bloodInjury'],
  }), false, 'removing kink/BDSM invalidates composed-result cache reuse');
  assert.equal(hasMatchingReusableModerationTaxonomy({
    uploadData: source,
    themes: ['Portrait'],
    makerTags: ['bloodInjury', 'kinkBdsm'],
  }), false, 'theme edits also invalidate composed-result cache reuse');
  assert.equal(hasMatchingReusableModerationTaxonomy({
    uploadData: {},
    themes: [],
    makerTags: [],
  }), false, 'legacy cache entries without uploader taxonomy fail closed');
  assert.equal(hasMatchingReusableModerationTaxonomy({
    uploadData: { userSelectedTaxonomy: { themes: [], triggers: [] } },
    themes: [],
    makerTags: [],
  }), true, 'explicit empty taxonomy can still be reused');
});

test('near-duplicate moderator routing is restrictive-only', () => {
  for (const action of ['rejectForbidden', 'reject', 'requestUserCorrection', 'rejectCorrection']) {
    assert.equal(canRouteNearDuplicateModerationExampleAction(action), true, action);
  }
  for (const action of ['approveAsIs', 'approve', 'approveWithTaxonomyCorrection', 'acceptCorrection', 'queueFreshEvaluation', '']) {
    assert.equal(canRouteNearDuplicateModerationExampleAction(action), false, action);
  }
});

test('near-duplicate routing is scoped to the same uploader', () => {
  assert.equal(isNearDuplicateReuseOwnedByUploader({ uploadData: { userId: 'user-a' }, userId: 'user-a' }), true);
  assert.equal(isNearDuplicateReuseOwnedByUploader({ uploadData: { uploaderUid: 'user-a' }, userId: 'user-a' }), true);
  assert.equal(isNearDuplicateReuseOwnedByUploader({ uploadData: { ownerUid: 'user-b' }, userId: 'user-a' }), false);
  assert.equal(isNearDuplicateReuseOwnedByUploader({ uploadData: {}, userId: 'user-a' }), false);
  assert.equal(isNearDuplicateReuseOwnedByUploader({ uploadData: { userId: 'user-a' }, userId: null }), false);
});
