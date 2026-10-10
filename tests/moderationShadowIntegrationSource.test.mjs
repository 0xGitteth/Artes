import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const start = source.indexOf('export const moderateImage');
const end = source.indexOf('export const isModerator', start);
const moderation = start >= 0 && end > start ? source.slice(start, end) : '';
const shadowModule = readFileSync(new URL('../functions/moderationShadowProviders.js', import.meta.url), 'utf8');

test('multi-provider shadow is attached to staging upload analysis', () => {
  assert.match(source, /from '\.\/moderationShadowProviders\.js'/);
  assert.match(moderation, /runStagingModerationShadow\(\{[\s\S]*?projectId: moderationRuntimeProjectId,[\s\S]*?image: parsed\.buffer,[\s\S]*?mimeType: parsed\.mimeType/);
});

test('shadow diagnostics are log-only, not passed to policy, response or persistence', () => {
  const begin = moderation.indexOf('const shadowDiagnosticsTask =');
  const policy = moderation.indexOf('let policyResult = composeModerationPolicyResult(');
  assert.ok(begin > 0 && policy > begin);
  const untilPolicy = moderation.slice(begin, policy);
  assert.match(untilPolicy, /logger\.info\('moderation_shadow_observation', shadowDiagnostics\)/);
  assert.doesNotMatch(moderation, /customDetectorEvidence:\s*shadowDiagnostics/);
  assert.doesNotMatch(moderation, /policyResult\s*=\s*shadowDiagnostics/);
  assert.doesNotMatch(moderation, /response\.shadowDiagnostics\s*=/);
  assert.doesNotMatch(moderation, /moderationShadowObservation:/);
});

test('shadow module fails closed outside staging, strips secrets, and rejects policy claims', () => {
  assert.match(shadowModule, /projectId !== ARTES_STAGING_PROJECT_ID/);
  assert.match(shadowModule, /ARTES_SHADOW_ENABLED !== 'true'/);
  assert.match(shadowModule, /FORBIDDEN_POLICY_FIELDS/);
  assert.match(shadowModule, /result = await Promise\.race\(\[request, deadline\]\)/);
});
