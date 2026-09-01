import test from 'node:test';
import assert from 'node:assert/strict';
import { composeModerationPolicyResult } from '../moderationPolicy.js';

const trustedGeminiDiagnostics = { attempted: true, success: true, contractValidated: true };

test('final moderator approval clears stale cached forbidden reasons', () => {
  const r = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'forbidden',
      appliedTriggers: [],
      suggestedTriggers: [],
      forbiddenReasons: [{ trigger: 'sexualExplicit', reason: 'stale_ai_reason' }],
    },
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'approved-override',
      data: { moderatorDecision: { action: 'approveAsIs' } },
    },
  });

  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_general');
  assert.equal(r.publishBlocked, false);
  assert.equal(r.forbiddenReasons.some((x) => x.trigger === 'sexualExplicit'), false);
});

test('diagnostic-only Gemini escalations persist a review reason', () => {
  const cases = [
    {
      diagnostics: {
        success: false,
        fallbackUsed: true,
        safetyBlocked: true,
        safetyBlockReason: 'candidate_safety',
      },
      expectedTrigger: 'geminiSafetyBlocked',
    },
    {
      diagnostics: {
        success: false,
        fallbackUsed: true,
        contractIssue: 'semantic_contradiction',
      },
      expectedTrigger: 'geminiSemanticContradiction',
    },
  ];

  for (const { diagnostics, expectedTrigger } of cases) {
    const r = composeModerationPolicyResult({
      geminiAdultDecision: null,
      geminiDiagnostics: diagnostics,
      safeSearchAdultScore: 0.1,
      safeSearchNudityScore: 0.1,
    });

    assert.equal(r.outcome, 'review');
    assert.equal(r.shouldReview, true);
    assert.equal(r.publishBlocked, true);
    assert.equal(r.forbiddenReasons.some((x) => x.trigger === expectedTrigger), true);
  }
});

test('standalone kinkBdsm signal is always classified as adult content', () => {
  const r = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'kinkBdsm', source: 'gemini', score: 0.9 }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });

  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_erotic_suggestive');
  assert.equal(r.shouldReview, false);
  assert.equal(r.appliedTriggers.some((x) => x.trigger === 'adultEroticSuggestive'), true);
});

test('moderator taxonomy correction replaces stale cached adult taxonomy', () => {
  const r = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'review',
      appliedTriggers: [{ trigger: 'adultArtNude', source: 'policyAuto', score: 1 }],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    normalizedThemes: ['Art Nude'],
    normalizedMakerTags: ['adultArtNude'],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'corrected-to-general',
      data: {
        moderatorDecision: {
          action: 'approveWithTaxonomyCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });

  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_general');
  assert.equal(r.publishBlocked, false);
  assert.equal(r.appliedTriggers.some((x) => x.trigger === 'adultArtNude'), false);
  assert.deepEqual(r.moderatorCorrectedTaxonomy, { themes: ['Portrait'], triggers: [] });
});
