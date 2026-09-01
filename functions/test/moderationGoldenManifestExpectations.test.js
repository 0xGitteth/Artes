import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getManifestGoldenExpectationFailure,
  validateGoldenExpansionManifest,
} from '../moderationGoldenManifestExpectations.js';

const result = (parsed, diagnostics = {}) => ({
  parsed,
  diagnostics: {
    safetyBlocked: false,
    ...diagnostics,
  },
});

const baseParsed = (overrides = {}) => ({
  adultDecision: 'none',
  sexualExplicitConfidence: 0.1,
  forbiddenReasons: [],
  triggers: [],
  ...overrides,
});

test('accepts general content with no durable adult context', () => {
  const item = {
    id: 'GENERAL',
    expected: { adultDecision: 'none', forbiddenReasons: [], adultTriggers: [] },
  };
  assert.equal(getManifestGoldenExpectationFailure({ item, result: result(baseParsed()) }), null);
});

test('rejects durable adult context for a general fixture', () => {
  const item = {
    id: 'GENERAL',
    expected: { adultDecision: 'none', forbiddenReasons: [], adultTriggers: [] },
  };
  const parsed = baseParsed({
    triggers: [{ trigger: 'adultEroticSuggestive', confidence: 0.8, severity: 'suggest', graphic: false }],
  });
  assert.match(getManifestGoldenExpectationFailure({ item, result: result(parsed) }), /unexpected durable adult trigger/);
});

test('requires durable adult context for erotic and kink fixtures', () => {
  const item = {
    id: 'BDSM',
    expected: {
      adultDecision: 'none',
      forbiddenReasons: [],
      requiredTriggers: ['adultEroticSuggestive', 'kinkBdsm'],
    },
  };
  const parsed = baseParsed({
    triggers: [
      { trigger: 'adultEroticSuggestive', confidence: 0.9, severity: 'suggest', graphic: false },
      { trigger: 'kinkBdsm', confidence: 0.85, severity: 'suggest', graphic: false },
    ],
  });
  assert.equal(getManifestGoldenExpectationFailure({ item, result: result(parsed) }), null);
});

test('distinguishes non-explicit nudity from explicit sexual acts', () => {
  const borderline = {
    id: 'NUDE',
    expected: {
      adultDecision: 'borderline',
      forbiddenReasonsAbsent: ['sexualExplicit'],
      sexualExplicitConfidenceMaxExclusive: 0.5,
    },
  };
  assert.equal(getManifestGoldenExpectationFailure({
    item: borderline,
    result: result(baseParsed({ adultDecision: 'borderline', sexualExplicitConfidence: 0.2 })),
  }), null);

  const explicit = {
    id: 'EXPLICIT',
    expected: {
      adultDecision: 'explicit',
      requiredForbiddenReasons: ['sexualExplicit'],
      sexualExplicitConfidenceMin: 0.5,
    },
  };
  assert.equal(getManifestGoldenExpectationFailure({
    item: explicit,
    result: result(baseParsed({
      adultDecision: 'explicit',
      sexualExplicitConfidence: 0.91,
      forbiddenReasons: ['sexualExplicit'],
    })),
  }), null);
});

test('validates graphic=false on required sensitive triggers', () => {
  const item = {
    id: 'WOUND',
    expected: {
      adultDecision: 'none',
      forbiddenReasons: [],
      requiredTriggers: ['bloodInjury'],
      requiredGraphic: false,
    },
  };
  const parsed = baseParsed({
    triggers: [{ trigger: 'bloodInjury', confidence: 0.9, severity: 'suggest', graphic: false }],
  });
  assert.equal(getManifestGoldenExpectationFailure({ item, result: result(parsed) }), null);
});

test('allows configured provider safety blocks but rejects unconfigured ones', () => {
  const allowed = { id: 'BLOCK_OK', expected: { allowProviderSafetyBlock: true } };
  const blockedResult = result(null, { safetyBlocked: true, safetyBlockReason: 'candidate_prohibited_content' });
  assert.equal(getManifestGoldenExpectationFailure({ item: allowed, result: blockedResult }), null);

  const rejected = { id: 'BLOCK_BAD', expected: {} };
  assert.match(getManifestGoldenExpectationFailure({ item: rejected, result: blockedResult }), /provider safety block was not an allowed outcome/);
});

test('manifest validator catches duplicate ids and missing files for ready fixtures', () => {
  const failures = validateGoldenExpansionManifest({
    cases: [
      { id: 'A', tier: 'release_gate', status: 'ready', expected: {} },
      { id: 'A', tier: 'release_gate', status: 'needs_image', expected: {} },
    ],
  });
  assert.ok(failures.some((entry) => entry.includes('.file is required')));
  assert.ok(failures.some((entry) => entry.includes('duplicates A')));
});
