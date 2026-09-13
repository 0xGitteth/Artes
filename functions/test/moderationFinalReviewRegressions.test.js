import test from 'node:test';
import assert from 'node:assert/strict';
import { composeModerationPolicyResult } from '../moderationPolicy.js';

const base = {
  cachedResult: null,
  appliedTriggers: [],
  suggestedTriggers: [],
  forbiddenReasons: [],
  aiSafetySignals: [],
  rawVisionLabels: [],
  normalizedThemes: ['Portrait'],
  normalizedMakerTags: [],
  geminiAdultDecision: 'none',
  geminiSexualExplicitConfidence: 0,
  explicitDecisionBranchHit: false,
  explicitDecisionAddedForbiddenReason: false,
  shouldRouteByPreviousExample: false,
  matchedModerationExample: null,
  safeSearchAdultScore: 0,
  safeSearchNudityScore: 0,
  forbiddenThreshold: 0.7,
  mediumLogThreshold: 0.55,
  geminiDiagnostics: { success: true, contractValidated: true, graphicSensitiveSignals: [] },
};

test('fresh sensitive warnings survive an older moderator taxonomy correction', () => {
  const result = composeModerationPolicyResult({
    ...base,
    suggestedTriggers: [{ trigger: 'selfHarm', score: 0.95, source: 'gemini' }],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'example-1',
      data: {
        moderatorDecision: {
          action: 'approveWithTaxonomyCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });
  assert.ok(result.appliedTriggers.some((item) => item?.trigger === 'selfHarm'));
  assert.ok(result.policyAppliedTriggers.some((item) => item?.trigger === 'selfHarm'));
});

test('uploader maker tags are not exposed as policy-owned applied labels', () => {
  const result = composeModerationPolicyResult({
    ...base,
    appliedTriggers: [{ trigger: 'weapons', score: 1, source: 'makerTag' }],
    normalizedMakerTags: ['weapons'],
  });
  assert.equal(result.policyAppliedTriggers.some((item) => item?.source === 'makerTag'), false);
  assert.equal(result.policyAppliedTriggers.some((item) => item?.trigger === 'weapons'), false);
});


test('fresh adult taxonomy suggestions do not override an authoritative moderator correction', () => {
  const result = composeModerationPolicyResult({
    ...base,
    suggestedTriggers: [{ trigger: 'adultEroticSuggestive', score: 0.95, source: 'gemini' }],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'example-adult-correction',
      data: {
        moderatorDecision: {
          action: 'approveWithTaxonomyCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });
  assert.equal(result.appliedTriggers.some((item) => item?.trigger === 'adultEroticSuggestive'), false);
  assert.equal(result.appliedTriggers.some((item) => item?.trigger === 'kinkBdsm'), false);
});

test('accepted correction cache reuse preserves canonical policy safety warnings', () => {
  const result = composeModerationPolicyResult({
    ...base,
    cachedResult: {
      outcome: 'allowed',
      appliedTriggers: [
        { trigger: 'selfHarm', score: 1, source: 'policySensitive' },
        { trigger: 'adultArtNude', score: 1, source: 'policyAuto' },
        { trigger: 'violence', score: 1, source: 'makerTag' },
      ],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'accepted-correction',
      data: {
        moderatorDecision: {
          action: 'acceptCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });
  assert.ok(result.appliedTriggers.some((item) => item?.trigger === 'selfHarm'));
  assert.ok(result.policyAppliedTriggers.some((item) => item?.trigger === 'selfHarm'));
  assert.equal(result.appliedTriggers.some((item) => item?.trigger === 'adultArtNude'), false);
  assert.equal(result.appliedTriggers.some((item) => item?.trigger === 'violence'), false);
});

test('accepted correction safety evidence survives even when cache selection lacks the warning', () => {
  const result = composeModerationPolicyResult({
    ...base,
    cachedResult: {
      outcome: 'allowed',
      appliedTriggers: [],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'accepted-correction-evidence',
      data: {
        moderatorDecision: {
          action: 'acceptCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
        aiSnapshot: {
          appliedTriggers: [{ trigger: 'selfHarm', score: 1, source: 'policySensitive' }],
        },
      },
    },
  });
  assert.ok(result.policyAppliedTriggers.some((item) => item?.trigger === 'selfHarm'));
});

test('finalized automatic correction cache reuse preserves adult graphic safety gate', () => {
  const result = composeModerationPolicyResult({
    ...base,
    cachedResult: {
      outcome: 'allowed',
      appliedTriggers: [{ trigger: 'adultGraphicSensitive', score: 1, source: 'policyAuto' }],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'automatic-correction',
      data: {
        moderatorDecision: {
          action: 'approveWithTaxonomyCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });
  assert.ok(result.policyAppliedTriggers.some((item) => item?.trigger === 'adultGraphicSensitive'));
  assert.equal(result.classification, 'allowed_adult_sensitive_graphic');
});

test('active requested correction still replaces stale cached policy warnings', () => {
  const result = composeModerationPolicyResult({
    ...base,
    cachedResult: {
      outcome: 'allowed',
      appliedTriggers: [{ trigger: 'selfHarm', score: 1, source: 'policySensitive' }],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'active-correction',
      data: {
        moderatorDecision: {
          action: 'requestUserCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });
  assert.equal(result.appliedTriggers.some((item) => item?.trigger === 'selfHarm'), false);
});
