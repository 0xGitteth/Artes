import test from 'node:test';
import assert from 'node:assert/strict';
import { composeModerationPolicyResult } from '../moderationPolicy.js';
import { routeGeminiForbiddenReasons } from '../geminiModerationRouting.js';
import {
  getGeminiModerationContractIssue,
  normalizeGeminiModerationResult,
} from '../geminiModerationContract.js';

const correctedExample = (correctedTaxonomy) => ({
  id: 'moderator-corrected',
  data: {
    moderatorDecision: {
      action: 'approveWithTaxonomyCorrection',
      correctedTaxonomy,
    },
  },
});

test('rejects safety-bearing triggers that are misplaced in Gemini suggestions', () => {
  for (const trigger of ['sexualExplicit', 'possible_minor_concern']) {
    const value = {
      triggers: [{ trigger, confidence: 1, severity: 'suggest' }],
      forbiddenReasons: [],
      adultDecision: 'none',
      sexualExplicitConfidence: 0,
    };
    assert.equal(getGeminiModerationContractIssue(value), 'semantic_contradiction');
    assert.equal(normalizeGeminiModerationResult(value), null);
  }
});

test('moderator taxonomy correction discards stale cached suggestions', () => {
  const result = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'review',
      appliedTriggers: [],
      suggestedTriggers: [
        { trigger: 'kinkBdsm', source: 'gemini', score: 0.95 },
        { trigger: 'adultEroticSuggestive', source: 'gemini', score: 0.95 },
      ],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: correctedExample({ themes: ['Portrait'], triggers: [] }),
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_general');
  assert.deepEqual(result.suggestedTriggers, []);
  assert.deepEqual(result.aiSuggestedTaxonomy.triggers, []);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultEroticSuggestive'), false);
});

test('moderator approval clears cached review case id before reuse', () => {
  const result = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'review',
      reviewCaseId: 'closed-case-123',
      appliedTriggers: [],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'moderator-approved',
      data: { moderatorDecision: { action: 'approveAsIs' } },
    },
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.reviewCaseId, null);
});

test('moderator theme correction becomes the effective publish taxonomy', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Fashion'],
    normalizedMakerTags: [],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: correctedExample({ themes: ['Portrait'], triggers: [] }),
  });

  assert.equal(result.outcome, 'allowed');
  assert.deepEqual(result.moderatorCorrectedTaxonomy, { themes: ['Portrait'], triggers: [] });
  assert.deepEqual(result.userSelectedTaxonomy, { themes: ['Portrait'], triggers: [] });
});

test('nonsexual Gemini safety reviews do not receive an erotic adult trigger', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Portrait'],
    normalizedMakerTags: [],
    safeSearchAdultScore: 0.1,
    safeSearchNudityScore: 0.1,
    geminiDiagnostics: {
      attempted: true,
      success: false,
      safetyBlocked: true,
      safetyBlockReason: 'HARM_CATEGORY_VIOLENCE',
    },
  });

  assert.equal(result.outcome, 'review');
  assert.equal(result.shouldReview, true);
  assert.equal(result.classification, 'uncertain_possible_explicit');
  assert.deepEqual(result.autoAppliedTriggers, []);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultEroticSuggestive'), false);
});


test('high-confidence sensitive Gemini signals become mandatory warnings', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', score: 0.92, source: 'gemini' }],
    forbiddenThreshold: 0.75,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury' && item.source === 'policySensitive'), true);
  assert.equal(result.policyAppliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.suggestedTriggers.some((item) => item.trigger === 'bloodInjury'), false);
});

test('lower-confidence sensitive Gemini signals remain suggestions', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'horrorScare', score: 0.6, source: 'gemini' }],
    forbiddenThreshold: 0.75,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'horrorScare'), false);
  assert.equal(result.suggestedTriggers.some((item) => item.trigger === 'horrorScare'), true);
});


test('borderline nudity keeps Art Nude adult access through review and approved cache reuse', () => {
  const first = composeModerationPolicyResult({
    geminiAdultDecision: 'borderline',
    geminiSexualExplicitConfidence: 0.2,
    geminiDiagnostics: { attempted: true, success: true, contractValidated: true },
    forbiddenReasons: [{ trigger: 'gemini', reason: 'possible_minor_concern', source: 'gemini' }],
    safeSearchAdultScore: 0.1,
    safeSearchNudityScore: 0.1,
  });

  assert.equal(first.outcome, 'review');
  assert.equal(first.appliedTriggers.some((item) => item.trigger === 'adultArtNude'), true);
  assert.equal(first.appliedTriggers.some((item) => item.trigger === 'adultEroticSuggestive'), false);

  const second = composeModerationPolicyResult({
    cachedResult: {
      outcome: first.outcome,
      appliedTriggers: first.appliedTriggers,
      suggestedTriggers: first.suggestedTriggers,
      forbiddenReasons: first.forbiddenReasons,
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'approved-borderline-nude',
      data: { moderatorDecision: { action: 'approveAsIs' } },
    },
  });

  assert.equal(second.outcome, 'allowed');
  assert.equal(second.classification, 'allowed_adult_art_nude');
  assert.equal(second.appliedTriggers.some((item) => item.trigger === 'adultArtNude'), true);
});

test('high-confidence graphic sensitive content is adult plus sensitive', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', score: 0.92, source: 'gemini' }],
    geminiDiagnostics: {
      graphicSensitiveSignals: [{ trigger: 'bloodInjury', score: 0.92 }],
    },
    forbiddenThreshold: 0.75,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_adult_sensitive_graphic');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), true);
});

test('medium-confidence adult-graphic detection routes to review without prematurely applying an adult label', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', score: 0.6, source: 'gemini' }],
    geminiDiagnostics: {
      graphicSensitiveSignals: [{ trigger: 'bloodInjury', score: 0.6 }],
    },
    forbiddenThreshold: 0.75,
    mediumLogThreshold: 0.55,
  });

  assert.equal(result.outcome, 'review');
  assert.equal(result.shouldReview, true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultEroticSuggestive'), false);
  assert.equal(result.suggestedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.forbiddenReasons.some((item) => item.trigger === 'geminiGraphicSensitiveUncertain'), true);
});

test('sub-medium graphic metadata remains a suggestion instead of forcing review', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', score: 0.5, source: 'gemini' }],
    geminiDiagnostics: {
      graphicSensitiveSignals: [{ trigger: 'bloodInjury', score: 0.5 }],
    },
    forbiddenThreshold: 0.75,
    mediumLogThreshold: 0.55,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.shouldReview, false);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
  assert.equal(result.suggestedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
});

test('non-graphic sensitive content stays ordinary sensitive content', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', score: 0.92, source: 'gemini' }],
    geminiDiagnostics: { graphicSensitiveSignals: [] },
    forbiddenThreshold: 0.75,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_general');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});

test('cached graphic-sensitive adult access survives classifier skipping', () => {
  const result = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'allowed',
      appliedTriggers: [
        { trigger: 'bloodInjury', score: 1, source: 'policySensitive' },
        { trigger: 'adultGraphicSensitive', score: 1, source: 'policyAuto' },
      ],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_adult_sensitive_graphic');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), true);
});


test('unsupported graphic metadata cannot age-gate ordinary sensitive categories', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'substanceDistress', score: 0.92, source: 'gemini' }],
    geminiDiagnostics: { graphicSensitiveSignals: [{ trigger: 'substanceDistress', score: 0.92 }] },
    forbiddenThreshold: 0.75,
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_general');
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'substanceDistress'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
});


test('trigger-only moderator corrections preserve existing themes', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Portrait'],
    normalizedMakerTags: [],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: correctedExample({ themes: [], triggers: ['bloodInjury'] }),
  });

  assert.equal(result.outcome, 'allowed');
  assert.deepEqual(result.userSelectedTaxonomy.themes, ['Portrait']);
  assert.deepEqual(result.userSelectedTaxonomy.triggers, ['bloodInjury']);
  assert.deepEqual(result.moderatorCorrectedTaxonomy, { themes: [], triggers: ['bloodInjury'] });
});


test('requestUserCorrection returns stored taxonomy as a correction outcome', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Fashion'],
    normalizedMakerTags: [],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'needs-correction',
      data: { moderatorDecision: { action: 'requestUserCorrection', correctedTaxonomy: { themes: ['Portrait'], triggers: ['bloodInjury'] } } },
    },
  });
  assert.equal(result.outcome, 'needsCorrection');
  assert.equal(result.shouldReview, false);
  assert.equal(result.needsCorrection, true);
  assert.equal(result.publishBlocked, true);
  assert.deepEqual(result.userSelectedTaxonomy, { themes: ['Fashion'], triggers: [] });
  assert.deepEqual(result.moderatorCorrectedTaxonomy, { themes: ['Portrait'], triggers: ['bloodInjury'] });
});

test('trigger-only requestUserCorrection preserves the current theme for acceptance', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Portrait'],
    normalizedMakerTags: [],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'needs-trigger-correction',
      data: { moderatorDecision: { action: 'requestUserCorrection', correctedTaxonomy: { themes: [], triggers: ['bloodInjury'] } } },
    },
  });
  assert.equal(result.outcome, 'needsCorrection');
  assert.deepEqual(result.moderatorCorrectedTaxonomy, { themes: ['Portrait'], triggers: ['bloodInjury'] });
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), false);
});


test('graphic sensitive content preserves simultaneous nudity and graphic adult labels', () => {
  const result = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'bloodInjury', score: 0.92, source: 'gemini' }],
    geminiAdultDecision: 'borderline',
    geminiDiagnostics: {
      attempted: true,
      success: true,
      contractValidated: true,
      graphicSensitiveSignals: [{ trigger: 'bloodInjury', score: 0.92 }],
    },
    forbiddenThreshold: 0.75,
  });
  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_adult_sensitive_graphic');
  assert.equal(result.autoAppliedTriggers.includes('adultArtNude'), true);
  assert.equal(result.autoAppliedTriggers.includes('adultGraphicSensitive'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultArtNude'), true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), true);
});


test('requestUserCorrection supersedes cached review state and closed case', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Portrait'],
    normalizedMakerTags: [],
    cachedResult: {
      outcome: 'review',
      appliedTriggers: [],
      suggestedTriggers: [],
      forbiddenReasons: [{ trigger: 'geminiSafetyBlocked', reason: 'old_review' }],
      reviewCaseId: 'closed-review-case',
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'needs-correction-cached-review',
      data: {
        moderatorDecision: {
          action: 'requestUserCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: ['bloodInjury'] },
        },
      },
    },
  });
  assert.equal(result.outcome, 'needsCorrection');
  assert.equal(result.shouldReview, false);
  assert.equal(result.needsCorrection, true);
  assert.deepEqual(result.forbiddenReasons, []);
  assert.equal(result.reviewCaseId, null);
});

test('final moderator rejection clears the old review case id', () => {
  const result = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'review',
      appliedTriggers: [],
      suggestedTriggers: [],
      forbiddenReasons: [],
      reviewCaseId: 'closed-rejected-case',
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'rejected-example',
      data: { moderatorDecision: { action: 'rejectForbidden', reasonCode: 'explicit_content' } },
    },
  });
  assert.equal(result.outcome, 'forbidden');
  assert.equal(result.reviewCaseId, null);
});



test('requestUserCorrection replaces stale cached taxonomy labels', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Portrait'],
    normalizedMakerTags: [],
    cachedResult: {
      outcome: 'allowed',
      appliedTriggers: [{ trigger: 'adultArtNude', source: 'policyAuto' }],
      suggestedTriggers: [{ trigger: 'adultEroticSuggestive', score: 0.8, source: 'gemini' }],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'requested-correction-clears-stale-labels',
      data: {
        moderatorDecision: {
          action: 'requestUserCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });

  assert.equal(result.outcome, 'needsCorrection');
  assert.equal(result.needsCorrection, true);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultArtNude'), false);
  assert.equal(result.policyAppliedTriggers.some((item) => item.trigger === 'adultArtNude'), false);
  assert.equal(result.suggestedTriggers.some((item) => item.trigger === 'adultEroticSuggestive'), false);
  assert.deepEqual(result.moderatorCorrectedTaxonomy, { themes: ['Portrait'], triggers: [] });
});



test('legacy moderator actions remain routable and normalized', () => {
  const approved = composeModerationPolicyResult({
    cachedResult: { outcome: 'review', appliedTriggers: [], suggestedTriggers: [], forbiddenReasons: [] },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: { id: 'legacy-approve', data: { moderatorDecision: { action: 'approve' } } },
  });
  assert.equal(approved.outcome, 'allowed');

  const rejected = composeModerationPolicyResult({
    shouldRouteByPreviousExample: true,
    matchedModerationExample: { id: 'legacy-reject', data: { moderatorDecision: { action: 'reject', reasonCode: 'legacy_reject' } } },
  });
  assert.equal(rejected.outcome, 'forbidden');
  assert.equal(rejected.previousModeratorExample.action, 'rejectForbidden');
});

test('requestUserCorrection preserves an explicitly empty corrected trigger list', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Portrait'],
    normalizedMakerTags: ['adultArtNude'],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'remove-all-triggers',
      data: { moderatorDecision: { action: 'requestUserCorrection', correctedTaxonomy: { themes: ['Portrait'], triggers: [] } } },
    },
  });
  assert.equal(result.outcome, 'needsCorrection');
  assert.deepEqual(result.moderatorCorrectedTaxonomy, { themes: ['Portrait'], triggers: [] });
});


test('medium-confidence explicit decisions stay in review while high-confidence explicit decisions block', () => {
  const mediumRouting = routeGeminiForbiddenReasons({
    forbiddenReasons: ['sexualExplicit'],
    adultDecision: 'explicit',
    sexualExplicitConfidence: 0.6,
    forbiddenThreshold: 0.7,
  });
  assert.equal(mediumRouting.explicitDecisionAddedForbiddenReason, false);
  assert.deepEqual(mediumRouting.records, [
    { trigger: 'gemini', reason: 'sexual_explicit_uncertain', score: 0.6 },
  ]);
  const mediumPolicy = composeModerationPolicyResult({
    forbiddenReasons: mediumRouting.records,
    geminiAdultDecision: 'explicit',
    geminiSexualExplicitConfidence: 0.6,
    forbiddenThreshold: 0.7,
    geminiDiagnostics: { success: true, contractValidated: true },
  });
  assert.equal(mediumPolicy.outcome, 'review');
  assert.equal(mediumPolicy.classification, 'uncertain_possible_explicit');

  const highRouting = routeGeminiForbiddenReasons({
    forbiddenReasons: ['sexualExplicit'],
    adultDecision: 'explicit',
    sexualExplicitConfidence: 0.8,
    forbiddenThreshold: 0.7,
  });
  assert.equal(highRouting.explicitDecisionAddedForbiddenReason, true);
  assert.equal(highRouting.records[0].trigger, 'sexualExplicit');
  const highPolicy = composeModerationPolicyResult({
    forbiddenReasons: highRouting.records,
    geminiAdultDecision: 'explicit',
    geminiSexualExplicitConfidence: 0.8,
    forbiddenThreshold: 0.7,
    geminiDiagnostics: { success: true, contractValidated: true },
  });
  assert.equal(highPolicy.outcome, 'forbidden');
});

test('low-confidence Gemini erotic and kink signals remain suggestions', () => {
  for (const trigger of ['adultEroticSuggestive', 'kinkBdsm']) {
    const low = composeModerationPolicyResult({
      suggestedTriggers: [{ trigger, score: 0.45, source: 'gemini' }],
      geminiAdultDecision: 'none',
      forbiddenThreshold: 0.7,
      geminiDiagnostics: { success: true, contractValidated: true },
    });
    assert.equal(low.outcome, 'allowed');
    assert.equal(low.classification, 'allowed_general');
    assert.equal(low.autoAppliedTriggers.includes('adultEroticSuggestive'), false);

    const high = composeModerationPolicyResult({
      suggestedTriggers: [{ trigger, score: 0.8, source: 'gemini' }],
      geminiAdultDecision: 'none',
      forbiddenThreshold: 0.7,
      geminiDiagnostics: { success: true, contractValidated: true },
    });
    assert.equal(high.classification, 'allowed_adult_erotic_suggestive');
    assert.equal(high.autoAppliedTriggers.includes('adultEroticSuggestive'), true);
  }
});

test('accepted uploader correction is reused as an authoritative approved taxonomy', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Fashion'],
    normalizedMakerTags: ['adultArtNude'],
    cachedResult: {
      outcome: 'review',
      appliedTriggers: [{ trigger: 'adultArtNude', source: 'policyAuto' }],
      suggestedTriggers: [],
      forbiddenReasons: [{ trigger: 'gemini', reason: 'old_review' }],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'accepted-correction-example',
      data: {
        moderatorDecision: {
          action: 'acceptCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: [] },
        },
      },
    },
  });
  assert.equal(result.outcome, 'allowed');
  assert.equal(result.moderatorCorrectionApplied, true);
  assert.deepEqual(result.userSelectedTaxonomy, { themes: ['Portrait'], triggers: [] });
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultArtNude'), false);
});


test('rejected uploader correction supersedes the older correction request and routes to review', () => {
  const result = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'allowed',
      appliedTriggers: [],
      suggestedTriggers: [],
      forbiddenReasons: [],
      reviewCaseId: 'closed-correction-case',
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'rejected-correction-example',
      data: {
        moderatorDecision: {
          action: 'rejectCorrection',
          correctedTaxonomy: { themes: ['Portrait'], triggers: ['substanceDistress'] },
        },
      },
    },
  });
  assert.equal(result.outcome, 'review');
  assert.equal(result.shouldReview, true);
  assert.equal(result.reviewCaseId, null);
  assert.equal(result.forbiddenReasons.some((reason) => reason.trigger === 'uploaderCorrectionRejected'), true);
});

test('moderator taxonomy correction remains authoritative during fresh reevaluation', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Fashion'],
    normalizedMakerTags: [],
    geminiAdultDecision: 'borderline',
    geminiSexualExplicitConfidence: 0.2,
    geminiDiagnostics: {
      success: true,
      contractValidated: true,
      graphicSensitiveSignals: [{ trigger: 'bloodInjury', score: 0.95 }],
    },
    suggestedTriggers: [{ trigger: 'bloodInjury', source: 'gemini', score: 0.95 }],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: correctedExample({ themes: ['Portrait'], triggers: [] }),
  });
  assert.equal(result.outcome, 'allowed');
  assert.equal(result.classification, 'allowed_general');
  assert.deepEqual(result.userSelectedTaxonomy, { themes: ['Portrait'], triggers: [] });
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultArtNude'), false);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'adultGraphicSensitive'), false);
  assert.equal(result.appliedTriggers.some((item) => item.trigger === 'bloodInjury'), true);
});

test('moderator taxonomy correction cannot override fresh strong forbidden evidence', () => {
  const result = composeModerationPolicyResult({
    normalizedThemes: ['Fashion'],
    normalizedMakerTags: [],
    geminiAdultDecision: 'explicit',
    geminiSexualExplicitConfidence: 0.95,
    geminiDiagnostics: { success: true, contractValidated: true },
    forbiddenReasons: [{ trigger: 'sexualExplicit', reason: 'fresh explicit evidence', score: 0.95 }],
    shouldRouteByPreviousExample: true,
    matchedModerationExample: correctedExample({ themes: ['Portrait'], triggers: [] }),
  });
  assert.equal(result.outcome, 'forbidden');
  assert.equal(result.publishBlocked, true);
  assert.equal(result.forbiddenReasons.some((item) => item.trigger === 'sexualExplicit'), true);
});


test('fresh safety-review evidence survives an older moderator approval', () => {
  const previousReason = { trigger: 'geminiSafetyBlocked', reason: 'old_vertex_block' };
  const result = composeModerationPolicyResult({
    forbiddenReasons: [{ trigger: 'gemini', reason: 'other_safety_review', source: 'gemini' }],
    geminiAdultDecision: 'none',
    geminiDiagnostics: { success: true, contractValidated: true },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'old-approval',
      data: {
        moderatorDecision: { action: 'approveAsIs' },
        aiSnapshot: { forbiddenReasons: [previousReason] },
        policyDecision: { forbiddenReasons: [previousReason] },
      },
    },
  });

  assert.equal(result.outcome, 'review');
  assert.equal(result.publishBlocked, true);
  assert.equal(result.forbiddenReasons.some((item) => item.reason === 'other_safety_review'), true);
});

test('an approval still suppresses the exact review evidence it already resolved', () => {
  const repeatedReason = { trigger: 'gemini', reason: 'other_safety_review', source: 'gemini' };
  const result = composeModerationPolicyResult({
    forbiddenReasons: [repeatedReason],
    geminiAdultDecision: 'none',
    geminiDiagnostics: { success: true, contractValidated: true },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'approval-for-same-reason',
      data: {
        moderatorDecision: { action: 'approveAsIs' },
        aiSnapshot: { forbiddenReasons: [repeatedReason] },
        policyDecision: { forbiddenReasons: [repeatedReason] },
      },
    },
  });

  assert.equal(result.outcome, 'allowed');
  assert.equal(result.publishBlocked, false);
  assert.deepEqual(result.forbiddenReasons, []);
});
