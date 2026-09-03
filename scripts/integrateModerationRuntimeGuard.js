import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const indexUrl = new URL('../functions/index.js', import.meta.url);
const indexPath = fileURLToPath(indexUrl);
let source = readFileSync(indexUrl, 'utf8');

const fail = (message) => {
  throw new Error(`Moderation runtime guard integration aborted: ${message}`);
};

const replaceExactlyOnce = (needle, replacement, label) => {
  const first = source.indexOf(needle);
  if (first === -1) fail(`${label} anchor not found`);
  if (source.indexOf(needle, first + needle.length) !== -1) fail(`${label} anchor is not unique`);
  source = `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
};

const integrationMarker = "import { MODERATION_RUNTIME_MODES, assertRuntimeProviderInvocationAllowed, buildManualReviewFallback, resolveModerationRuntimeMode } from './moderationRuntimeProvider.js';";
if (source.includes(integrationMarker)) {
  process.stdout.write(JSON.stringify({ changed: false, reason: 'already_integrated', file: 'functions/index.js' }, null, 2) + '\n');
  process.exit(0);
}

replaceExactlyOnce(
  "import { composeModerationPolicyResult } from './moderationPolicy.js';",
  "import { composeModerationPolicyResult } from './moderationPolicy.js';\nimport { MODERATION_RUNTIME_MODES, assertRuntimeProviderInvocationAllowed, buildManualReviewFallback, resolveModerationRuntimeMode } from './moderationRuntimeProvider.js';",
  'runtime import',
);

replaceExactlyOnce(
  `  const parsed = parseImageDataUrl(image);\n  if (parsed.error) {\n    res.status(400).json({ error: parsed.error });\n    return;\n  }`,
  `  const parsed = parseImageDataUrl(image);\n  if (parsed.error) {\n    res.status(400).json({ error: parsed.error });\n    return;\n  }\n\n  const moderationRuntimeProjectId = process.env.GOOGLE_CLOUD_PROJECT\n    || process.env.GCLOUD_PROJECT\n    || process.env.GCP_PROJECT\n    || '';\n  const moderationRuntime = resolveModerationRuntimeMode({\n    projectId: moderationRuntimeProjectId,\n    requestedMode: process.env.MODERATION_RUNTIME_MODE || null,\n    // Fail closed until the custom detector is actually invoked by this handler.\n    // Merely setting an environment variable must never activate an unwired provider.\n    customProviderConfigured: false,\n  });\n  const moderationManualFallback = moderationRuntime.mode === MODERATION_RUNTIME_MODES.manualOnly\n    ? buildManualReviewFallback({ reason: moderationRuntime.reason })\n    : null;`,
  'moderateImage runtime context',
);

replaceExactlyOnce(
  `  if (!cachedResult) {\n    try {\n      geminiAttempted = true;\n      const geminiClassifierResult = await runGeminiClassifierV2(parsed);`,
  `  if (!cachedResult && moderationRuntime.mode !== MODERATION_RUNTIME_MODES.legacyGemini) {\n    geminiDiagnostics = buildGeminiDiagnostics({\n      ...geminiDiagnostics,\n      attempted: false,\n      success: false,\n      fallbackUsed: true,\n      fallbackReason: \`runtime_\${moderationRuntime.reason}\`,\n    });\n  }\n\n  if (!cachedResult && moderationRuntime.mode === MODERATION_RUNTIME_MODES.legacyGemini) {\n    assertRuntimeProviderInvocationAllowed({\n      projectId: moderationRuntimeProjectId,\n      providerGenerative: true,\n      mode: moderationRuntime.mode,\n    });\n    try {\n      geminiAttempted = true;\n      const geminiClassifierResult = await runGeminiClassifierV2(parsed);`,
  'Gemini invocation gate',
);

replaceExactlyOnce(
  `  const policyRequiresReview = policyResult.shouldReview || policyResult.outcome === 'review';`,
  `  const policyRequiresReview = Boolean(moderationManualFallback?.forceReview)\n    || policyResult.shouldReview\n    || policyResult.outcome === 'review';`,
  'manual review fallback',
);

replaceExactlyOnce(
  `    moderationSignals: policyResult.moderationSignals,\n    geminiDiagnostics,`,
  `    moderationSignals: policyResult.moderationSignals,\n    moderationRuntime: {\n      mode: moderationRuntime.mode,\n      reason: moderationRuntime.reason,\n      generativeAllowed: moderationRuntime.generativeAllowed,\n      manualReviewFallback: Boolean(moderationManualFallback),\n    },\n    geminiDiagnostics,`,
  'response runtime diagnostics',
);

replaceExactlyOnce(
  `        moderationSignals: response.moderationSignals || null,\n        appliedTriggers: finalAppliedTriggers,`,
  `        moderationSignals: response.moderationSignals || null,\n        moderationRuntime: response.moderationRuntime || null,\n        appliedTriggers: finalAppliedTriggers,`,
  'persisted runtime diagnostics',
);

writeFileSync(indexPath, source, 'utf8');
process.stdout.write(JSON.stringify({
  changed: true,
  file: 'functions/index.js',
  stagingBehavior: 'manual_review_only_until_custom_detector_is_wired',
  productionBehavior: 'legacy_gemini_default_preserved',
}, null, 2) + '\n');
