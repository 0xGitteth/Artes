import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { composeModerationPolicyResult } from '../moderationPolicy.js';

const fixturesPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../testing/moderation_goldens_v1/fixtures/policy-boundary-cases.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const byId = Object.fromEntries(fixtures.map((item) => [item.id, item]));

const likelihoodScore = (value) => ({
  UNKNOWN: 0,
  VERY_UNLIKELY: 0.1,
  UNLIKELY: 0.25,
  POSSIBLE: 0.5,
  LIKELY: 0.7,
  VERY_LIKELY: 0.9,
}[value] ?? 0);

const trustedGeminiDiagnostics = { attempted: true, success: true, contractValidated: true };

function run(id, extras = {}) {
  const f = byId[id];
  return composeModerationPolicyResult({
    cachedResult: null,
    appliedTriggers: [],
    suggestedTriggers: (f.ai?.suggestedTriggers || []).map((trigger) => ({ trigger, source: 'gemini', score: 0.7 })),
    forbiddenReasons: f.ai?.explicitSexualAct ? [{ trigger: 'sexualExplicit', reason: 'fixture' }] : [],
    aiSafetySignals: [],
    rawVisionLabels: f.vision?.labels || [],
    normalizedThemes: f.uploaderTaxonomy?.themes || [],
    normalizedMakerTags: f.uploaderTaxonomy?.triggers || [],
    geminiAdultDecision: f.ai?.adultDecision || 'none',
    geminiSexualExplicitConfidence: f.ai?.sexualExplicitConfidence || 0,
    safeSearchAdultScore: likelihoodScore(f.vision?.safeSearch?.adult),
    safeSearchNudityScore: likelihoodScore(f.vision?.safeSearch?.racy),
    geminiDiagnostics: trustedGeminiDiagnostics,
    ...extras,
  });
}

test('ordinary boudoir remains general content', () => {
  const r = run('BOUDOIR_ALLOWED_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_general');
  assert.equal(r.shouldReview, false);
  assert.equal(r.publishBlocked, false);
});

test('SafeSearch racy signal does not turn ordinary boudoir into review when Gemini succeeds', () => {
  const r = run('BOUDOIR_WEAK_SIGNAL_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_general');
  assert.equal(r.shouldReview, false);
});

test('raw Vision labels stay diagnostic only', () => {
  const r = run('BOUDOIR_WRONG_VISION_LABEL_01');
  assert.equal(r.userSelectedTaxonomy.triggers.includes('spidersInsects'), false);
  assert.equal(r.policyAppliedTriggers.some((x) => x.trigger === 'spidersInsects'), false);
  assert.equal(r.suggestedTriggers.some((x) => x.trigger === 'spidersInsects'), false);
  assert.equal(r.aiVisionLabels.includes('Spider'), true);
});

test('male topless alone remains general content', () => {
  const r = run('MALE_TOPLESS_GENERAL_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_general');
});

test('string or lingerie alone remains general content', () => {
  const r = run('STRING_GENERAL_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_general');
});

test('implied nude is automatically adult content instead of review', () => {
  const r = run('IMPLIED_NUDE_ADULT_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_art_nude');
  assert.equal(r.shouldReview, false);
  assert.deepEqual(r.autoAppliedTriggers, ['adultArtNude']);
  assert.equal(r.appliedTriggers.some((x) => x.trigger === 'adultArtNude'), true);
});

test('bare buttocks are automatically adult content instead of review', () => {
  const r = run('BARE_BUTTOCKS_ADULT_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_art_nude');
  assert.equal(r.shouldReview, false);
});

test('art nude without an explicit act is adult content, not review', () => {
  const r = run('ART_NUDE_BORDERLINE_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_art_nude');
  assert.equal(r.shouldReview, false);
  assert.equal(r.publishBlocked, false);
});

test('clear erotic or suggestive context can be adult without being explicit', () => {
  const r = run('EROTIC_CLOTHED_ADULT_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_erotic_suggestive');
  assert.equal(r.shouldReview, false);
  assert.deepEqual(r.autoAppliedTriggers, ['adultEroticSuggestive']);
  assert.equal(r.appliedTriggers.some((x) => x.trigger === 'adultEroticSuggestive'), true);
});

test('explicit sexual activity is forbidden', () => {
  const r = run('EXPLICIT_FORBIDDEN_01');
  assert.equal(r.outcome, 'forbidden');
  assert.equal(r.classification, 'disallowed_sexual_explicit');
  assert.equal(r.publishBlocked, true);
  assert.equal(r.forbiddenReasons.some((x) => x.trigger === 'sexualExplicit'), true);
});

test('creative theme mismatch does not force a safety correction', () => {
  const r = run('WRONG_HARMLESS_TAXONOMY_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.needsCorrection, false);
  assert.deepEqual(r.requiredThemes, []);
});

test('AI detected nudity wins over a harmless creative theme without forcing review', () => {
  const r = run('WRONG_SENSITIVE_TAXONOMY_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_art_nude');
  assert.equal(r.shouldReview, false);
  assert.deepEqual(r.requiredThemes, []);
});

test('AI suggested erotic label remains separate from uploader taxonomy', () => {
  const r = run('AI_LABEL_RENDERING_01');
  assert.deepEqual(r.userSelectedTaxonomy.triggers, []);
  assert.equal(r.aiSuggestedTaxonomy.triggers.some((x) => x.trigger === 'adultEroticSuggestive'), true);
  assert.equal(r.classification, 'allowed_adult_erotic_suggestive');
});

test('successful contract-validated Gemini none is trusted over ordinary mixed SafeSearch signals', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
    safeSearchAdultScore: 0.7,
    safeSearchNudityScore: 0.7,
  });
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_general');
  assert.equal(r.shouldReview, false);
});

test('legacy success without contract validation does not suppress strong SafeSearch', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: 'none',
    geminiDiagnostics: { success: true },
    safeSearchAdultScore: 0.9,
    safeSearchNudityScore: 0.7,
  });
  assert.equal(r.outcome, 'review');
  assert.equal(r.shouldReview, true);
});

test('extreme SafeSearch disagreement still routes to review', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
    safeSearchAdultScore: 0.9,
    safeSearchNudityScore: 0.9,
  });
  assert.equal(r.outcome, 'review');
  assert.equal(r.shouldReview, true);
  assert.equal(r.publishBlocked, true);
});

test('strong mixed SafeSearch without reliable Gemini routes to review', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: null,
    geminiDiagnostics: { success: false, fallbackUsed: true },
    safeSearchAdultScore: 0.8,
    safeSearchNudityScore: 0.8,
  });
  assert.equal(r.outcome, 'review');
  assert.equal(r.shouldReview, true);
});

test('Gemini fallback does not force review on a strong adult score alone', () => {
  const r = composeModerationPolicyResult({
    suggestedTriggers: [{ trigger: 'gemini_uncertain_fallback', source: 'geminiFallback', score: 0.8 }],
    geminiAdultDecision: null,
    geminiDiagnostics: { success: false, fallbackUsed: true },
    safeSearchAdultScore: 0.8,
    safeSearchNudityScore: 0.25,
  });
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.shouldReview, false);
});

test('Vertex safety blocks always route to review even when SafeSearch is weak', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: null,
    geminiDiagnostics: {
      success: false,
      fallbackUsed: true,
      fallbackReason: 'safety_blocked',
      safetyBlocked: true,
      safetyBlockReason: 'candidate_safety',
    },
    safeSearchAdultScore: 0.8,
    safeSearchNudityScore: 0.1,
  });
  assert.equal(r.outcome, 'review');
  assert.equal(r.shouldReview, true);
  assert.equal(r.publishBlocked, true);
});

test('semantic Gemini contract contradictions always route to review', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: null,
    geminiDiagnostics: {
      success: false,
      fallbackUsed: true,
      fallbackReason: 'semantic_contradiction',
      contractIssue: 'semantic_contradiction',
    },
    safeSearchAdultScore: 0.1,
    safeSearchNudityScore: 0.1,
  });
  assert.equal(r.outcome, 'review');
  assert.equal(r.shouldReview, true);
  assert.equal(r.publishBlocked, true);
});

test('auto-applied adult label survives cached moderation reuse', () => {
  const firstPass = composeModerationPolicyResult({
    geminiAdultDecision: 'borderline',
    geminiDiagnostics: trustedGeminiDiagnostics,
  });
  assert.equal(firstPass.classification, 'allowed_adult_art_nude');
  assert.equal(firstPass.appliedTriggers.some((x) => x.trigger === 'adultArtNude'), true);

  const cachedPass = composeModerationPolicyResult({
    cachedResult: {
      outcome: firstPass.outcome,
      appliedTriggers: firstPass.appliedTriggers,
      suggestedTriggers: firstPass.suggestedTriggers,
      forbiddenReasons: firstPass.forbiddenReasons,
    },
    geminiAdultDecision: null,
    geminiDiagnostics: null,
  });
  assert.equal(cachedPass.classification, 'allowed_adult_art_nude');
  assert.equal(cachedPass.appliedTriggers.some((x) => x.trigger === 'adultArtNude'), true);
});

test('cached review outcome remains review on exact or near-duplicate reuse without a final approval', () => {
  const firstPass = composeModerationPolicyResult({
    geminiAdultDecision: null,
    geminiDiagnostics: { success: false, fallbackUsed: true },
    safeSearchAdultScore: 0.8,
    safeSearchNudityScore: 0.8,
  });
  assert.equal(firstPass.outcome, 'review');

  const cachedPass = composeModerationPolicyResult({
    cachedResult: {
      outcome: firstPass.outcome,
      appliedTriggers: firstPass.appliedTriggers,
      suggestedTriggers: firstPass.suggestedTriggers,
      forbiddenReasons: firstPass.forbiddenReasons,
    },
  });
  assert.equal(cachedPass.outcome, 'review');
  assert.equal(cachedPass.shouldReview, true);
  assert.equal(cachedPass.publishBlocked, true);
});

test('final moderator approval clears an old cached review outcome', () => {
  const r = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'review',
      appliedTriggers: [{ trigger: 'adultEroticSuggestive', source: 'policyAuto', score: 1 }],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'previous-approved',
      data: { moderatorDecision: { action: 'approveAsIs' } },
    },
  });
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_erotic_suggestive');
  assert.equal(r.shouldReview, false);
  assert.equal(r.publishBlocked, false);
});

test('approved taxonomy correction is applied before cached reuse is allowed', () => {
  const r = composeModerationPolicyResult({
    cachedResult: {
      outcome: 'review',
      appliedTriggers: [],
      suggestedTriggers: [],
      forbiddenReasons: [],
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'previous-corrected',
      data: {
        moderatorDecision: {
          action: 'approveWithTaxonomyCorrection',
          correctedTaxonomy: { themes: [], triggers: ['adultArtNude'] },
        },
      },
    },
  });
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.classification, 'allowed_adult_art_nude');
  assert.equal(r.shouldReview, false);
  assert.equal(r.appliedTriggers.some((x) => x.trigger === 'adultArtNude' && x.source === 'moderatorCorrection'), true);
  assert.deepEqual(r.moderatorCorrectedTaxonomy.triggers, ['adultArtNude']);
});

test('final moderator rejection preserves a forbidden outcome and reason', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'previous-rejected',
      data: {
        moderatorDecision: {
          action: 'rejectForbidden',
          reasonCode: 'explicit_content',
        },
      },
    },
  });
  assert.equal(r.outcome, 'forbidden');
  assert.equal(r.classification, 'disallowed_moderator_rejected');
  assert.equal(r.shouldReview, false);
  assert.equal(r.publishBlocked, true);
  assert.equal(r.forbiddenReasons.some((x) => x.trigger === 'moderatorRejected' && x.reason === 'explicit_content'), true);
});

test('requestUserCorrection returns a blocked correction only when previous-example routing is active', () => {
  const r = composeModerationPolicyResult({
    geminiAdultDecision: 'none',
    geminiDiagnostics: trustedGeminiDiagnostics,
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'previous-correction',
      data: { moderatorDecision: { action: 'requestUserCorrection' } },
    },
  });
  assert.equal(r.outcome, 'needsCorrection');
  assert.equal(r.shouldReview, false);
  assert.equal(r.needsCorrection, true);
  assert.equal(r.publishBlocked, true);
});

test('fresh-evaluation routing bypass ignores prior correction and rejection decisions', () => {
  for (const action of ['requestUserCorrection', 'rejectForbidden']) {
    const r = composeModerationPolicyResult({
      geminiAdultDecision: 'none',
      geminiDiagnostics: trustedGeminiDiagnostics,
      shouldRouteByPreviousExample: false,
      matchedModerationExample: {
        id: `previous-${action}`,
        data: {
          moderatorDecision: {
            action,
            reasonCode: 'old_decision',
            correctedTaxonomy: { themes: ['Art Nude'], triggers: ['adultArtNude'] },
          },
        },
      },
    });
    assert.equal(r.outcome, 'allowed');
    assert.equal(r.classification, 'allowed_general');
    assert.equal(r.shouldReview, false);
    assert.equal(r.publishBlocked, false);
    assert.equal(r.forbiddenReasons.some((x) => x.trigger === 'moderatorRejected'), false);
    assert.deepEqual(r.moderatorCorrectedTaxonomy, { themes: [], triggers: [] });
  }
});

test('Needles and injections raw Vision labels are diagnostic only', () => {
  const r = composeModerationPolicyResult({
    rawVisionLabels: ['Needle'],
    appliedTriggers: [{ trigger: 'needlesInjections', source: 'labelDetection' }],
    suggestedTriggers: [{ trigger: 'needlesInjections', source: 'visionLabel' }],
    forbiddenReasons: [{ trigger: 'needlesInjections', source: 'visionLabel' }],
    normalizedThemes: ['Portrait'],
    normalizedMakerTags: [],
  });
  assert.equal(r.policyAppliedTriggers.length, 0);
  assert.equal(r.suggestedTriggers.length, 0);
  assert.equal(r.forbiddenReasons.length, 0);
});

test('final moderator approval resolves repeated review-only fresh evaluation signals', () => {
  const r = composeModerationPolicyResult({
    cachedResult: null,
    geminiAdultDecision: null,
    geminiDiagnostics: {
      success: false,
      fallbackUsed: true,
      fallbackReason: 'safety_blocked',
      safetyBlocked: true,
      safetyBlockReason: 'candidate_safety',
    },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'previous-approved-fresh-review',
      data: {
        moderatorDecision: { action: 'approveAsIs' },
        aiSnapshot: {
          forbiddenReasons: [{ trigger: 'geminiSafetyBlocked', reason: 'candidate_safety' }],
        },
        policyDecision: {
          forbiddenReasons: [{ trigger: 'geminiSafetyBlocked', reason: 'candidate_safety' }],
        },
      },
    },
  });
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.shouldReview, false);
  assert.equal(r.publishBlocked, false);
  assert.deepEqual(r.forbiddenReasons, []);
  assert.equal(r.previousModeratorExample?.routingApplied, true);
});

test('final moderator approval does not override a fresh strong forbidden reason', () => {
  const r = composeModerationPolicyResult({
    cachedResult: null,
    forbiddenReasons: [{ trigger: 'sexualExplicit', reason: 'fresh explicit evidence', score: 0.95 }],
    geminiAdultDecision: 'explicit',
    geminiSexualExplicitConfidence: 0.95,
    geminiDiagnostics: { success: true, contractValidated: true },
    shouldRouteByPreviousExample: true,
    matchedModerationExample: {
      id: 'previous-approved-now-forbidden',
      data: { moderatorDecision: { action: 'approveAsIs' } },
    },
  });
  assert.equal(r.outcome, 'forbidden');
  assert.equal(r.shouldReview, false);
  assert.equal(r.publishBlocked, true);
  assert.equal(r.forbiddenReasons.some((reason) => reason.trigger === 'sexualExplicit'), true);
});
