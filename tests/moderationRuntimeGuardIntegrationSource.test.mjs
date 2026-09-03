import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

const moderateStart = source.indexOf('export const moderateImage');
const moderateEnd = source.indexOf('export const isModerator', moderateStart);
const moderateImageSource = moderateStart >= 0 && moderateEnd > moderateStart
  ? source.slice(moderateStart, moderateEnd)
  : '';

test('moderateImage imports and resolves provider-neutral runtime guard', () => {
  assert.match(source, /from '\.\/moderationRuntimeProvider\.js'/);
  assert.match(moderateImageSource, /resolveModerationRuntimeMode\(\{/);
  assert.match(moderateImageSource, /customProviderConfigured: false/);
  assert.match(moderateImageSource, /buildManualReviewFallback\(\{ reason: moderationRuntime\.reason \}\)/);
});

test('moderateImage cannot invoke Gemini outside legacy production runtime mode', () => {
  assert.match(
    moderateImageSource,
    /if \(!cachedResult && moderationRuntime\.mode === MODERATION_RUNTIME_MODES\.legacyGemini\) \{[\s\S]*?assertRuntimeProviderInvocationAllowed\(\{[\s\S]*?providerGenerative: true,[\s\S]*?runGeminiClassifierV2\(parsed\)/,
  );
  assert.match(
    moderateImageSource,
    /if \(!cachedResult && moderationRuntime\.mode !== MODERATION_RUNTIME_MODES\.legacyGemini\) \{[\s\S]*?fallbackReason: `runtime_\$\{moderationRuntime\.reason\}`/,
  );
});

test('manual-only staging runtime forces review without inventing a detector result', () => {
  assert.match(
    moderateImageSource,
    /const policyRequiresReview = Boolean\(moderationManualFallback\?\.forceReview\)[\s\S]*?policyResult\.shouldReview/,
  );
  assert.match(moderateImageSource, /manualReviewFallback: Boolean\(moderationManualFallback\)/);
  assert.match(moderateImageSource, /moderationRuntime: response\.moderationRuntime \|\| null/);
});

test('runtime guard integration leaves production default selection in provider module', () => {
  const runtimeSource = readFileSync(new URL('../functions/moderationRuntimeProvider.js', import.meta.url), 'utf8');
  assert.match(runtimeSource, /project === ARTES_PRODUCTION_PROJECT_ID/);
  assert.match(runtimeSource, /requested \|\| MODERATION_RUNTIME_MODES\.legacyGemini/);
  assert.match(runtimeSource, /preserve_existing_production_behavior/);
});
