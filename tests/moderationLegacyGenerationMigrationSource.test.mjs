import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../functions/scripts/migrateLegacyFreshEvaluationOverrides.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const packageSource = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');

test('legacy fresh-evaluation migration is an explicit non-destructive deployment gate', () => {
  assert.match(script, /freshEvaluationOverrides/);
  assert.match(script, /LEGACY_FRESH_EVALUATION_MIN_GENERATION/);
  assert.match(script, /readModerationScopeGeneration/);
  assert.match(script, /getModerationFreshScopeRef/);
  assert.match(script, /--apply/);
  assert.match(script, /--verify/);
  assert.match(script, /intentionally not cleared/);
  assert.doesNotMatch(script, /freshEvaluationOverrides:\s*\[\]/);
  assert.doesNotMatch(script, /FieldValue\.delete\(\).*freshEvaluationOverrides/);
});

test('runtime remains independent of legacy per-user override authority', () => {
  assert.doesNotMatch(runtime, /freshEvaluationOverrides/);
  assert.match(packageSource, /moderation:migrate-legacy-overrides/);
  assert.match(packageSource, /moderation:verify-legacy-overrides/);
});
