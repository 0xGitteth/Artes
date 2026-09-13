import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLegacyFreshEvaluationMigrationGate,
  planLegacyFreshEvaluationGenerationMigration,
  resolveLegacyFreshEvaluationOverrideScopeKeys,
} from '../legacyFreshEvaluationMigration.js';

test('legacy override scope recovery accepts direct and nested fingerprint evidence', () => {
  assert.deepEqual(resolveLegacyFreshEvaluationOverrideScopeKeys({
    override: { fingerprints: { dhash: 'abcd000000000001' } },
  }), ['abcd']);
  assert.deepEqual(resolveLegacyFreshEvaluationOverrideScopeKeys({
    override: { uploadId: 'missing' },
    upload: { fingerprints: { dhashPrefix: 'beef' } },
  }), ['beef']);
});

test('legacy override scope recovery can survive deleted selected uploads through review evidence', () => {
  assert.deepEqual(resolveLegacyFreshEvaluationOverrideScopeKeys({
    override: { uploadId: 'deleted' },
    reviewCase: {
      fingerprints: [
        { dhash: 'cafe000000000001' },
        { dhashPrefix: 'f00d' },
      ],
    },
    linkedUploads: [{ fingerprints: { dhash: 'face000000000001' } }],
  }), ['cafe', 'f00d', 'face']);
});

test('migration only raises represented scopes below generation one', () => {
  assert.deepEqual(planLegacyFreshEvaluationGenerationMigration({
    scopeKeys: ['abcd', 'beef', 'abcd'],
    currentGenerations: { abcd: 0, beef: 3 },
  }), {
    scopeKeys: ['abcd', 'beef'],
    writes: [{ scopeKey: 'abcd', currentGeneration: 0, targetGeneration: 1 }],
    verified: [{ scopeKey: 'beef', generation: 3 }],
  });
});

test('deployment gate fails exactly while a represented scope is still generation zero', () => {
  assert.deepEqual(getLegacyFreshEvaluationMigrationGate({
    scopeKeys: ['abcd', 'beef'],
    currentGenerations: { abcd: 1, beef: 0 },
  }), {
    satisfied: false,
    missingScopeKeys: ['beef'],
    verifiedScopeKeys: ['abcd'],
  });
  assert.equal(getLegacyFreshEvaluationMigrationGate({
    scopeKeys: ['abcd', 'beef'],
    currentGenerations: { abcd: 1, beef: 4 },
  }).satisfied, true);
});
