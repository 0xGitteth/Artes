import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { composeModerationPolicyResult } from '../moderationPolicy.js';

const fixturesPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../testing/moderation_goldens_v1/fixtures/policy-boundary-cases.json');
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
const byId = Object.fromEntries(fixtures.map((item) => [item.id, item]));

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
    safeSearchAdultScore: ['VERY_LIKELY', 'LIKELY', 'POSSIBLE'].includes(f.vision?.safeSearch?.adult) ? 0.8 : 0.2,
    safeSearchNudityScore: ['VERY_LIKELY', 'LIKELY', 'POSSIBLE'].includes(f.vision?.safeSearch?.racy) ? 0.8 : 0.2,
    ...extras,
  });
}

test('BOUDOIR_ALLOWED_01', () => {
  const r = run('BOUDOIR_ALLOWED_01');
  assert.equal(r.outcome, 'allowed');
  assert.equal(r.shouldReview, false);
  assert.equal(r.needsCorrection, false);
  assert.deepEqual(r.forbiddenReasons, []);
  assert.deepEqual(r.requiredThemes, []);
  assert.equal(r.publishBlocked, false);
});

test('BOUDOIR_WEAK_SIGNAL_01 SafeSearch-only is not forbidden', () => {
  const r = run('BOUDOIR_WEAK_SIGNAL_01');
  assert.notEqual(r.outcome, 'forbidden');
  assert.deepEqual(r.forbiddenReasons, []);
});

test('BOUDOIR_WRONG_VISION_LABEL_01 vision labels are diagnostic only', () => {
  const r = run('BOUDOIR_WRONG_VISION_LABEL_01');
  assert.equal(r.userSelectedTaxonomy.triggers.includes('spidersInsects'), false);
  assert.equal(r.policyAppliedTriggers.some((x) => x.trigger === 'spidersInsects'), false);
  assert.equal(r.suggestedTriggers.some((x) => x.trigger === 'spidersInsects'), false);
  assert.equal(r.aiVisionLabels.includes('Spider'), true);
});

test('ART_NUDE_BORDERLINE_01 goes review without explicit act', () => {
  const r = run('ART_NUDE_BORDERLINE_01', { suggestedTriggers: [{ trigger: 'gemini_uncertain_fallback', source: 'geminiFallback' }] });
  assert.equal(r.outcome, 'review');
  assert.equal(r.shouldReview, true);
  assert.equal(r.publishBlocked, true);
});

test('EXPLICIT_FORBIDDEN_01 forbidden even with safe taxonomy', () => {
  const r = run('EXPLICIT_FORBIDDEN_01');
  assert.equal(r.outcome, 'forbidden');
  assert.equal(r.publishBlocked, true);
  assert.equal(r.forbiddenReasons.some((x) => x.trigger === 'sexualExplicit'), true);
});

test('WRONG_HARMLESS_TAXONOMY_01 needs correction not forbidden', () => {
  const r = run('WRONG_HARMLESS_TAXONOMY_01', { normalizedThemes: [], appliedTriggers: [{ trigger: 'adultArtNude', source: 'gemini' }] });
  assert.equal(r.outcome, 'needsCorrection');
  assert.equal(r.needsCorrection, true);
  assert.equal(r.publishBlocked, false);
});

test('WRONG_SENSITIVE_TAXONOMY_01 blocks publish bypass', () => {
  const r = run('WRONG_SENSITIVE_TAXONOMY_01');
  assert.equal(r.shouldReview, true);
  assert.equal(r.publishBlocked, true);
  assert.notEqual(r.outcome, 'allowed');
});

test('AI_LABEL_RENDERING_01 uploader and ai labels separated', () => {
  const r = run('AI_LABEL_RENDERING_01');
  assert.deepEqual(r.userSelectedTaxonomy.triggers, []);
  assert.equal(r.aiSuggestedTaxonomy.triggers.some((x) => x.trigger === 'adultEroticSuggestive'), true);
});

test('Needles/injections raw vision labels are diagnostic only', () => {
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
