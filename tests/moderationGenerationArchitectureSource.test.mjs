import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const reuseSource = fs.readFileSync(new URL('../functions/moderationReuseRouting.js', import.meta.url), 'utf8');

test('live moderation no longer uses consumable fresh-evaluation reservations', () => {
  for (const legacySymbol of [
    'freshEvaluationReservationMs',
    'reserveFreshEvaluationOverride',
    'consumeFreshEvaluationOverride',
    'releaseFreshEvaluationOverrideReservation',
    'reservationRequestId',
    'reservationExpiresAtMs',
  ]) {
    assert.doesNotMatch(indexSource, new RegExp(legacySymbol), legacySymbol);
  }
  assert.doesNotMatch(indexSource, /freshEvaluationOverrides/, 'runtime must not use legacy per-user overrides as authority');
});

test('moderation request reads one global generation and persists that provenance', () => {
  assert.match(indexSource, /readModerationScopeGeneration\(\{\s*db,\s*fingerprints/s);
  assert.match(indexSource, /requestModerationGeneration/);
  assert.match(indexSource, /moderationGeneration:\s*requestModerationGeneration/);
  assert.match(indexSource, /fresh_evaluation_superseded_during_request/);
});

test('cache and moderator examples are fenced by the same generation', () => {
  assert.match(reuseSource, /isModerationGenerationCurrent/);
  assert.match(reuseSource, /exampleData\?\.moderationGeneration/);
  assert.match(indexSource, /findExactModerationExample\(fingerprints\.sha256,\s*requestModerationGeneration\)/);
  assert.match(indexSource, /currentGeneration:\s*requestModerationGeneration/);
});

test('moderator requeue increments global scope generations without fuzzy boundary replacement', () => {
  assert.match(indexSource, /planModerationScopeGenerationIncrement/);
  assert.match(indexSource, /moderationFreshScopes|MODERATION_FRESH_SCOPES_COLLECTION|getModerationFreshScopeRef/);
  assert.match(indexSource, /collectModerationFingerprintEntries/);
  assert.match(indexSource, /collectModerationScopeKeys/);
  assert.doesNotMatch(indexSource, /matchesFingerprintEntry/);
});

test('publication transaction rejects a stale moderation generation', () => {
  assert.match(indexSource, /moderation_generation_stale/);
  assert.match(indexSource, /latestUpload\?\.moderationGeneration/);
});
