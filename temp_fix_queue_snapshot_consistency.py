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

print('queue snapshot consistency and semantic source assertions applied')
