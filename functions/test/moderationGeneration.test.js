import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectModerationFingerprintEntries,
  collectModerationScopeKeys,
  getModerationGenerationDecision,
  isModerationGenerationCurrent,
  normalizeModerationFingerprintEntry,
  normalizeModerationGeneration,
  normalizeModerationScopeKey,
  planModerationScopeGenerationIncrement,
  resolveModerationScopeKey,
} from '../moderationGeneration.js';

const sha = (char) => char.repeat(64);

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
  assert.equal(resolveModerationScopeKey({ sha256: sha('a') }), null);
});

test('normalizes server fingerprint evidence without inventing identity', () => {
  assert.deepEqual(normalizeModerationFingerprintEntry({
    sha256: sha('A'),
    dhash: 'ABCD1234567890EF',
    dhashPrefix: 'ABCD',
  }), {
    sha256: sha('a'),
    dhash: 'abcd1234567890ef',
    dhashPrefix: 'abcd',
  });
  assert.deepEqual(normalizeModerationFingerprintEntry({ dhashPrefix: '1234' }), {
    dhashPrefix: '1234',
  }, 'a valid server-owned prefix is enough to invalidate the conservative scope');
  assert.equal(normalizeModerationFingerprintEntry({ dhash: 'abcd1234567890ef', dhashPrefix: 'ffff' }), null);
  assert.equal(normalizeModerationFingerprintEntry({ sha256: 'not-a-sha', dhashPrefix: 'abcd' }), null);
  assert.equal(normalizeModerationFingerprintEntry([{ dhashPrefix: 'abcd' }]), null);
});

test('recovers fingerprint arrays, legacy containers, and remaining linked-upload evidence through one path', () => {
  const entries = collectModerationFingerprintEntries(
    {
      fingerprints: [
        { sha256: sha('a'), dhash: 'abcd000000000001', dhashPrefix: 'abcd' },
        { sha256: sha('b'), dhash: '1234000000000002', dhashPrefix: '1234' },
      ],
    },
    { fingerprint: { sha256: sha('a'), dhash: 'abcd000000000001', dhashPrefix: 'abcd' } },
    { metadata: { fingerprints: { dhash: 'beef000000000003', dhashPrefix: 'beef' } } },
  );

  assert.equal(entries.length, 3);
  assert.deepEqual(collectModerationScopeKeys(entries), ['1234', 'abcd', 'beef']);
});

test('fingerprint recovery ignores malformed and unrelated nested objects', () => {
  const entries = collectModerationFingerprintEntries(
    { fingerprints: [{ dhashPrefix: 'bad' }, null, 'abcd'] },
    { arbitrary: { dhashPrefix: 'cafe' } },
    { fingerprint: { dhashPrefix: 'CAFE' } },
  );
  assert.deepEqual(entries, [{ dhashPrefix: 'cafe' }]);
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
    { dhashPrefix: 'abcd', dhash: 'abcd000000000000' },
    { dhash: 'abcdffffffffffff' },
    { dhashPrefix: '1234', dhash: '1234000000000000' },
    { dhashPrefix: 'bad', dhash: '' },
  ]), ['1234', 'abcd']);
});

test('every explicit requeue increments every represented scope exactly once', () => {
  const first = planModerationScopeGenerationIncrement({
    scopeKeys: ['abcd', '1234', 'ABCD'],
    currentGenerations: { abcd: 0, 1234: 4 },
  });
  assert.deepEqual(first, { 1234: 5, abcd: 1 });

  const second = planModerationScopeGenerationIncrement({
    scopeKeys: Object.keys(first),
    currentGenerations: first,
  });
  assert.deepEqual(second, { 1234: 6, abcd: 2 });
});
