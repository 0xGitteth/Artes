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
    "    const initialReviewCaseUploadIds = resolveReviewCaseUploadIds(initialReviewCaseData);\n",
    "    const initialCaseOwnerId = pickString(\n"
    "      initialReviewCaseData?.userId,\n"
    "      initialReviewCaseData?.uploaderUid,\n"
    "      initialReviewCaseData?.ownerUid,\n"
    "      initialReviewCaseData?.uploaderSnapshot?.uid,\n"
    "    );\n"
    "    const initialReviewCaseUploadIds = resolveReviewCaseUploadIds(initialReviewCaseData);\n",
    'capture initial review-case owner',
)

index = replace_once(
    index,
    "      const freshReviewCaseUploadIds = resolveReviewCaseUploadIds(freshReviewCaseData);\n"
    "      if (uploadIdFromBody && freshReviewCaseUploadIds.length > 0 && !freshReviewCaseUploadIds.includes(uploadIdFromBody)) {\n",
    "      const freshCaseOwnerId = pickString(\n"
    "        freshReviewCaseData?.userId,\n"
    "        freshReviewCaseData?.uploaderUid,\n"
    "        freshReviewCaseData?.ownerUid,\n"
    "        freshReviewCaseData?.uploaderSnapshot?.uid,\n"
    "      );\n"
    "      const freshReviewCaseUploadIds = resolveReviewCaseUploadIds(freshReviewCaseData);\n"
    "      const initialUploadSetKey = [...new Set(initialReviewCaseUploadIds)].sort().join('\\n');\n"
    "      const freshUploadSetKey = [...new Set(freshReviewCaseUploadIds)].sort().join('\\n');\n"
    "      if (initialUploadSetKey !== freshUploadSetKey) {\n"
    "        const error = new Error('Review case uploads changed while queuing fresh evaluation');\n"
    "        error.status = 409;\n"
    "        error.code = 'review_case_upload_changed';\n"
    "        throw error;\n"
    "      }\n"
    "      if (initialCaseOwnerId !== freshCaseOwnerId) {\n"
    "        const error = new Error('Review case owner changed while queuing fresh evaluation');\n"
    "        error.status = 409;\n"
    "        error.code = 'review_case_owner_changed';\n"
    "        throw error;\n"
    "      }\n"
    "      if (uploadIdFromBody && freshReviewCaseUploadIds.length > 0 && !freshReviewCaseUploadIds.includes(uploadIdFromBody)) {\n",
    'recheck review-case identity inside transaction',
)

index = replace_once(
    index,
    "      const freshCaseUserId = pickString(\n"
    "        freshReviewCaseData?.userId,\n"
    "        freshReviewCaseData?.uploaderUid,\n"
    "        freshReviewCaseData?.ownerUid,\n"
    "        freshReviewCaseData?.uploaderSnapshot?.uid,\n"
    "        ...linkedUploads.map((item) => ownerForUpload(item.data)),\n"
    "      );\n",
    "      const freshCaseUserId = pickString(\n"
    "        freshCaseOwnerId,\n"
    "        ...linkedUploads.map((item) => ownerForUpload(item.data)),\n"
    "      );\n",
    'reuse canonical fresh case owner',
)

index_path.write_text(index, encoding='utf-8')


test_path = Path('tests/moderationLifecycleSource.test.mjs')
test_source = test_path.read_text(encoding='utf-8')
test_source = replace_once(
    test_source,
    "  assert.match(queueSource, /reviewCaseUploadIds = resolveReviewCaseUploadIds/);\n",
    "  assert.match(queueSource, /initialReviewCaseUploadIds = resolveReviewCaseUploadIds/);\n"
    "  assert.match(queueSource, /initialUploadSetKey !== freshUploadSetKey/);\n"
    "  assert.match(queueSource, /initialCaseOwnerId !== freshCaseOwnerId/);\n",
    'queue snapshot assertions',
)
test_source = replace_once(
    test_source,
    "  assert.match(queueSource, /transaction\\.set\\(queueModerationExampleRef, queueExamplePayload/);\n",
    "  assert.match(queueSource, /transaction\\.set\\(queueModerationExampleRef,\\s*\\{/);\n"
    "  assert.match(queueSource, /\\.\\.\\.queueExamplePayload/);\n"
    "  assert.match(queueSource, /moderationScopeGenerations: nextGenerations/);\n",
    'atomic example assertion',
)
test_path.write_text(test_source, encoding='utf-8')


# The media-anchor refactor deliberately moves upload creation before Storage.
# Keep the Codex isolation regression semantic: both the durable-anchor create
# and the post-Storage finalization must serialize the historical-registry read
# with their authoritative mutation. A late denial schedules upload-owned
# cleanup instead of directly deleting Storage from the request path.
codex_test_path = Path('tests/codexDevIsolation.test.mjs')
codex_source = codex_test_path.read_text(encoding='utf-8')
codex_source = replace_once(
    codex_source,
    "  assert.match(moderate, /runTransaction[^]*!isCodexActor && await isKnownCodexDevActorUid[^]*transaction\\.create\\(uploadRef/);\n",
    "  const mediaAnchor = moderate.slice(\n"
    "    moderate.indexOf(\"const uploadRef = db.collection('uploads').doc();\"),\n"
    "    moderate.indexOf('if (reviewCaseId && uploadId)'),\n"
    "  );\n"
    "  const anchorTransaction = mediaAnchor.indexOf('await db.runTransaction');\n"
    "  const anchorRegistryGuard = mediaAnchor.indexOf('await isKnownCodexDevActorUid({ db, uid: userId, transaction })', anchorTransaction);\n"
    "  const anchorCreate = mediaAnchor.indexOf('transaction.create(uploadRef', anchorTransaction);\n"
    "  assert.ok(anchorTransaction !== -1 && anchorTransaction < anchorRegistryGuard && anchorRegistryGuard < anchorCreate,\n"
    "    'durable upload anchor serializes the historical-registry read before creation');\n"
    "  const finalizationTransaction = mediaAnchor.indexOf('await db.runTransaction', anchorCreate);\n"
    "  const finalizationRegistryGuard = mediaAnchor.indexOf('await isKnownCodexDevActorUid({ db, uid: userId, transaction })', finalizationTransaction);\n"
    "  const suppressionCleanup = mediaAnchor.indexOf(\"mediaCleanupReason: 'historical_registry_suppressed'\", finalizationRegistryGuard);\n"
    "  const readyMutation = mediaAnchor.indexOf(\"mediaState: 'ready'\", suppressionCleanup);\n"
    "  assert.ok(finalizationTransaction < finalizationRegistryGuard && finalizationRegistryGuard < suppressionCleanup && suppressionCleanup < readyMutation,\n"
    "    'post-Storage finalization rechecks the registry before either cleanup scheduling or ready state');\n",
    'Codex media-anchor transaction assertion',
)
codex_source = replace_once(
    codex_source,
    "  const suppression = moderate.indexOf('uploadSuppressedByHistoricalRegistry = true');\n"
    "  const previewDelete = moderate.indexOf(\"file(persistedPreview.storagePath).delete({ ignoreNotFound: true })\");\n"
    "  assert.ok(suppression < previewDelete, 'only authoritative historical suppression triggers preview cleanup');\n"
    "  assert.match(moderate, /previewCreatedByRequest && persistedPreview\\?\\.storagePath/);\n",
    "  const mediaAnchorStart = moderate.indexOf(\"const uploadRef = db.collection('uploads').doc();\");\n"
    "  const mediaAnchorEnd = moderate.indexOf('if (reviewCaseId && uploadId)', mediaAnchorStart);\n"
    "  const mediaAnchor = moderate.slice(mediaAnchorStart, mediaAnchorEnd);\n"
    "  const finalizationStart = mediaAnchor.indexOf('await db.runTransaction', mediaAnchor.indexOf('transaction.create(uploadRef'));\n"
    "  const finalRegistryGuard = mediaAnchor.indexOf('await isKnownCodexDevActorUid({ db, uid: userId, transaction })', finalizationStart);\n"
    "  const cleanupPending = mediaAnchor.indexOf(\"mediaState: 'cleanup_pending'\", finalRegistryGuard);\n"
    "  const historicalCleanupReason = mediaAnchor.indexOf(\"mediaCleanupReason: 'historical_registry_suppressed'\", cleanupPending);\n"
    "  const readyState = mediaAnchor.indexOf(\"mediaState: 'ready'\", historicalCleanupReason);\n"
    "  assert.ok(mediaAnchorStart !== -1 && finalizationStart !== -1 && finalRegistryGuard < cleanupPending\n"
    "    && cleanupPending < historicalCleanupReason && historicalCleanupReason < readyState,\n"
    "    'late historical denial is serialized before ready state and hands cleanup to the upload anchor');\n"
    "  assert.match(mediaAnchor, /finalizationOutcome === 'suppressed'[\\s\\S]*uploadSuppressedByHistoricalRegistry = true[\\s\\S]*persistedPreview = null/);\n"
    "  assert.doesNotMatch(mediaAnchor, /file\\(persistedPreview\\.storagePath\\)\\.delete/,\n"
    "    'request path must not bypass upload-owned cleanup authority with a direct Storage delete');\n",
    'Codex late suppression media cleanup assertion',
)
codex_test_path.write_text(codex_source, encoding='utf-8')

print('queue snapshot consistency and semantic source assertions applied')
