import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectModerationScopeKeys,
  getModerationGenerationDecision,
  isModerationGenerationCurrent,
  normalizeModerationGeneration,
  normalizeModerationScopeKey,
  resolveModerationScopeKey,
} from '../moderationGeneration.js';

test('normalizes moderation generations conservatively', () => {
  assert.equal(normalizeModerationGeneration(undefined), 0);
  assert.equal(normalizeModerationGeneration(-1), 0);
  assert.equal(normalizeModerationGeneration('3'), 3);
  assert.equal(normalizeModerationGeneration(4.9), 4);
  assert.equal(normalizeModerationGeneration('nope'), 0);
});

test('uses one stable four-hex dHash prefix scope', () => {
  assert.equal(normalizeModerationScopeKey('A1b2'), 'a1b2');
  assert.equal(normalizeModerationScopeKey('a1b'), null);
  assert.equal(normalizeModerationScopeKey('zzzz'), null);
  assert.equal(resolveModerationScopeKey({ dhashPrefix: 'ABCD', dhash: 'ffff0000' }), 'abcd');
  assert.equal(resolveModerationScopeKey({ dhash: '12Abcdef' }), '12ab');
  assert.equal(resolveModerationScopeKey({ sha256: 'a'.repeat(64) }), null);
});

test('legacy evidence is generation zero and becomes stale after first requeue', () => {
  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: undefined, currentGeneration: 0 }), true);
  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: undefined, currentGeneration: 1 }), false);
  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: 2, currentGeneration: 2 }), true);
  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: 3, currentGeneration: 2 }), true);
});

test('generation decision exposes only monotone stale distance', () => {
  assert.deepEqual(getModerationGenerationDecision({ evidenceGeneration: 2, currentGeneration: 5 }), {
    allowed: false,
    evidenceGeneration: 2,
    currentGeneration: 5,
    staleBy: 3,
  });
  assert.deepEqual(getModerationGenerationDecision({ evidenceGeneration: 5, currentGeneration: 5 }), {
    allowed: true,
    evidenceGeneration: 5,
    currentGeneration: 5,
    staleBy: 0,
  });
});

test('collects unique scope keys without treating near matching as identity', () => {
  assert.deepEqual(collectModerationScopeKeys([
    { dhashPrefix: 'abcd', dhash: 'abcd0000' },
    { dhash: 'abcdffff' },
    { dhashPrefix: '1234', dhash: '12340000' },
    { dhashPrefix: 'bad', dhash: '' },
  ]), ['1234', 'abcd']);
});
