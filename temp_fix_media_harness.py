from pathlib import Path

path = Path('temp_apply_media_anchor_refactor.py')
source = path.read_text(encoding='utf-8')

old = r'''index = replace_once(
    index,
    "    imageUrl: FieldValue.delete(),\n    previewUrl: FieldValue.delete(),\n    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),",
    "    imageUrl: FieldValue.delete(),\n    previewUrl: FieldValue.delete(),\n    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    mediaState: 'deleted',\n    mediaCleanupAfter: FieldValue.delete(),\n    mediaCleanupReason: FieldValue.delete(),\n    mediaCleanupClaimId: FieldValue.delete(),\n    mediaCleanupClaimedAt: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),",
    'deleted published post final media state',
)
'''
new = r'''deleted_post_start = index.index('const finalizeDeletedPublishedPostMedia = async')
deleted_post_end = index.index('export const onModerationUploadDeleted', deleted_post_start)
deleted_post_body = index[deleted_post_start:deleted_post_end]
deleted_post_body = replace_once(
    deleted_post_body,
    "    imageUrl: FieldValue.delete(),\n    previewUrl: FieldValue.delete(),\n    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),",
    "    imageUrl: FieldValue.delete(),\n    previewUrl: FieldValue.delete(),\n    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    mediaState: 'deleted',\n    mediaCleanupAfter: FieldValue.delete(),\n    mediaCleanupReason: FieldValue.delete(),\n    mediaCleanupClaimId: FieldValue.delete(),\n    mediaCleanupClaimedAt: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),",
    'deleted published post final media state',
)
index = index[:deleted_post_start] + deleted_post_body + index[deleted_post_end:]
'''
if source.count(old) != 1:
    raise AssertionError(f'expected one ambiguous cleanup replacement in harness, found {source.count(old)}')
source = source.replace(old, new, 1)

marker = "# Add focused publication/cache readiness regressions without rewriting unrelated tests.\n"
if source.count(marker) != 1:
    raise AssertionError('test compatibility insertion marker missing')
compat = r'''# Align older source-level retention assertions with the canonical media authority.
self_review_path = Path('tests/moderationPreviewRetentionSelfReviewSource.test.mjs')
self_review = read(self_review_path)
self_review = replace_once(
    self_review,
    "  assert.ok(body.includes('previewRetentionExpiresAt: Timestamp.fromMillis(Date.now())'));",
    "  assert.ok(body.includes(\"mediaState: 'cleanup_pending'\"));\n  assert.ok(body.includes('mediaCleanupAfter: Timestamp.fromMillis(Date.now())'));",
    'deleted-post retry source assertion',
)
write(self_review_path, self_review)

retention_source_path = Path('tests/moderationPreviewRetentionSource.test.mjs')
retention_source = read(retention_source_path)
retention_source = replace_once(
    retention_source,
    "  assert.ok(indexSource.includes('getModerationPreviewReviewCaseIds(uploadData)'));",
    "  assert.ok(indexSource.includes('getOperationalModerationPreviewReviewCaseId(uploadData)'));\n  assert.ok(indexSource.includes('isOperationalModerationPreviewReviewCase({'));",
    'operational review retention assertion',
)
retention_source = replace_once(
    retention_source,
    "  assert.ok(indexSource.includes('previewRetentionExpiresAt: Timestamp.fromMillis(Date.now())'));",
    "  assert.ok(indexSource.includes('mediaCleanupAfter: Timestamp.fromMillis(Date.now())'));",
    'media cleanup retry source assertion',
)
write(retention_source_path, retention_source)

'''
source = source.replace(marker, compat + marker, 1)
path.write_text(source, encoding='utf-8')
print('temporary media harness hardened')
