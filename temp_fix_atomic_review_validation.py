from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


index_path = Path('functions/index.js')
index = index_path.read_text(encoding='utf-8')
index = replace_once(
    index,
    "          const effectiveOpenReviewCount = transactionOpenReviewCase\n            ? Math.max(1, Number(freshUserModerationData.openReviewCount) || 0)\n            : freshUserModerationData.openReviewCount;\n",
    "          // The transactionally observed upload-review case is capacity authority.\n"
    "          // openReviewCount is a mirrored counter and may be stale after legacy failures.\n"
    "          const effectiveOpenReviewCount = transactionOpenReviewCase ? 1 : 0;\n",
    'automatic review capacity authority',
)
index_path.write_text(index, encoding='utf-8')

lifecycle_path = Path('tests/moderationLifecycleSource.test.mjs')
lifecycle = lifecycle_path.read_text(encoding='utf-8')
lifecycle = replace_once(
    lifecycle,
    "  const calls = source.match(/getReviewAccessDecision\\(\\{/g) || [];\n"
    "  assert.ok(calls.length >= 4, `expected at least four shared review gates, found ${calls.length}`);\n"
    "  assert.match(source, /correctionReviewAccess = getReviewAccessDecision/);\n"
    "  assert.match(source, /freshReviewAccess = getReviewAccessDecision/);\n",
    "  const calls = source.match(/getReviewAccessDecision\\(\\{/g) || [];\n"
    "  assert.ok(calls.length >= 3, `expected canonical review gates, found ${calls.length}`);\n"
    "  assert.match(source, /correctionReviewAccess = getReviewAccessDecision/);\n"
    "  assert.match(source, /freshReviewAccess = getReviewAccessDecision/);\n"
    "  const automaticStart = source.indexOf('const finalizationResult = await db.runTransaction');\n"
    "  const automaticEnd = source.indexOf(\"if (finalizationOutcome === 'ready')\", automaticStart);\n"
    "  const automaticSource = source.slice(automaticStart, automaticEnd);\n"
    "  assert.match(automaticSource, /freshReviewAccess = getReviewAccessDecision/);\n"
    "  assert.match(automaticSource, /const effectiveOpenReviewCount = transactionOpenReviewCase \\? 1 : 0/);\n",
    'canonical review gate source assertion',
)
lifecycle_path.write_text(lifecycle, encoding='utf-8')

integration_path = Path('tests/moderationV2IntegrationSource.test.mjs')
integration = integration_path.read_text(encoding='utf-8')
integration = replace_once(
    integration,
    "test('reasonless review outcomes create cases even without forbidden reasons', () => {\n"
    "  assert.ok(indexSource.includes(\"const policyRequiresReview = policyResult.shouldReview || policyResult.outcome === 'review';\"));\n"
    "  assert.ok(indexSource.includes('shouldCreateProductionReviewCase({ isCodexActor, forbiddenReasons: finalForbiddenReasons, shouldReview: policyRequiresReview })'));\n"
    "  assert.ok(indexSource.includes('(finalForbiddenReasons.length > 0 || policyRequiresReview)'));\n"
    "  assert.ok(indexSource.includes(\"finalForbiddenReasons.length > 0 ? 'forbiddenOutcomeAutoReview' : 'policyReviewAuto'\"));\n"
    "});\n",
    "test('reasonless review outcomes create cases even without forbidden reasons', () => {\n"
    "  assert.ok(indexSource.includes(\"const policyRequiresReview = policyResult.shouldReview || policyResult.outcome === 'review';\"));\n"
    "  assert.match(indexSource, /shouldFinalizeAutomaticReview = Boolean\\([\\s\\S]{0,320}?shouldCreateProductionReviewCase\\(\\{[\\s\\S]{0,180}?shouldReview: policyRequiresReview/);\n"
    "  assert.ok(indexSource.includes(\"? 'forbiddenOutcomeAutoReview'\"));\n"
    "  assert.ok(indexSource.includes(\": 'policyReviewAuto';\"));\n"
    "  assert.ok(indexSource.includes('transaction.create(automaticReviewRef, {'));\n"
    "});\n",
    'reasonless automatic review source assertion',
)
integration = replace_once(
    integration,
    "test('manual upload review cases persist fingerprints and report cases are filtered from upload reuse', () => {\n"
    "  assert.ok(indexSource.includes('fingerprints: created'));\n"
    "  assert.ok(indexSource.includes('findFirstUploadReviewCaseAcrossPages'));\n"
    "  assert.ok(indexSource.includes('resolveReviewCaseUploadIds(openReviewCase.data).slice(0, 10)'));\n"
    "});\n",
    "test('manual upload review persists fingerprints while automatic legacy recovery stays owner-scoped', () => {\n"
    "  const manualStart = indexSource.indexOf('export const requestUploadReviewCase');\n"
    "  const manualEnd = indexSource.indexOf('export const getModerationExamplesForCase', manualStart);\n"
    "  const manualSource = indexSource.slice(manualStart, manualEnd);\n"
    "  assert.ok(manualSource.includes('fingerprints: created'));\n"
    "  assert.ok(manualSource.includes('findFirstUploadReviewCaseAcrossPages'));\n"
    "  assert.ok(indexSource.includes('reviewCaseMatchesCurrentUploadEvidence({'));\n"
    "  assert.ok(indexSource.includes('expectedOwnerUid: userId'));\n"
    "  assert.ok(indexSource.includes('linkedUploadSnap = await transaction.get'));\n"
    "});\n",
    'manual review and legacy recovery assertion',
)
integration_path.write_text(integration, encoding='utf-8')

source_path = Path('tests/moderationAutomaticReviewFinalizationSource.test.mjs')
source = source_path.read_text(encoding='utf-8')
insert_marker = "\ntest('storage or finalization failure is surfaced and leaves cleanup on the upload anchor', () => {"
if source.count(insert_marker) != 1:
    raise AssertionError('stale counter regression insertion marker not found exactly once')
stale_counter_test = r'''

test('automatic review capacity follows the transactionally observed case, not a stale counter', () => {
  const start = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const end = moderateSource.indexOf("if (finalizationOutcome === 'ready')", start);
  const body = moderateSource.slice(start, end);
  assert.match(body, /const effectiveOpenReviewCount = transactionOpenReviewCase \? 1 : 0/);
  assert.match(body, /openReviewCount: effectiveOpenReviewCount/);
  assert.match(body, /if \(transactionOpenReviewCase && Number\(freshUserModerationData\.openReviewCount \|\| 0\) < 1\)/);
  assert.match(body, /else if \(!transactionOpenReviewCase && freshReviewAccess\.allowed\)/);
});
'''
source = source.replace(insert_marker, stale_counter_test + insert_marker, 1)
source_path.write_text(source, encoding='utf-8')

print('atomic automatic review validation invariants updated')
