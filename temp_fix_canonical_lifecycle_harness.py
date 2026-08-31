from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


# Legacy correction fields can be internally contradictory. Preserve fail-closed
# legacy behavior while allowing canonical state to detect the mirrored review
# status as a conflict instead of reinterpreting it as a correction request.
lifecycle_path = Path('functions/moderationLifecycle.js')
lifecycle = lifecycle_path.read_text(encoding='utf-8')
lifecycle = replace_once(
    lifecycle,
    "  if (correctionPending) {\n    if (includeEvidence && hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;\n    return MODERATION_STATES.correctionPending;\n  }\n  if (reviewStatus === 'approved') {",
    "  if (correctionPending && reviewStatus === 'approved') {\n    return includeEvidence ? null : MODERATION_STATES.allowed;\n  }\n  if (correctionPending) {\n    if (includeEvidence && hasForbiddenEvidence(upload)) return MODERATION_STATES.rejected;\n    return MODERATION_STATES.correctionPending;\n  }\n  if (reviewStatus === 'approved') {",
    'legacy approved/correction conflict',
)
lifecycle_path.write_text(lifecycle, encoding='utf-8')

# Retention only needs canonical publication authority plus validation of any
# explicit/legacy review marker. Requiring a fully resolvable moderation state
# for a legacy draft/expired upload would incorrectly prevent safe cleanup.
preview_path = Path('functions/moderationPreviewStorage.js')
preview = preview_path.read_text(encoding='utf-8')
preview = replace_once(
    preview,
    "import { PUBLICATION_STATES, resolveUploadLifecycle } from './moderationLifecycle.js';",
    "import { PUBLICATION_STATES, resolveUploadModerationState, resolveUploadPublicationState } from './moderationLifecycle.js';",
    'preview lifecycle imports',
)
old_block = '''  const lifecycle = resolveUploadLifecycle(uploadData);
  const normalizedReviewCaseStatuses = Array.isArray(reviewCaseStatuses)
    ? reviewCaseStatuses.map(normalizeStatus).filter(Boolean)
    : [];
  if (!lifecycle.valid) {
    return { action: 'defer', reason: 'unknown_lifecycle_state', storagePath };
  }

  if (lifecycle.publicationState === PUBLICATION_STATES.published) {
    return { action: 'preserve', reason: 'published_state', storagePath };
  }

  // Legacy post-deletion retry state maps to canonical discarded. It remains
  // explicitly cleanup-eligible while older documents are phased out.
  const legacyPublicationStatus = normalizeStatus(uploadData?.publicationStatus || uploadData?.publishStatus);
  if (legacyPublicationStatus === 'deleted_pending_cleanup') {
    return { action: 'expire', reason: 'post_deleted_cleanup_pending', storagePath };
  }

  const legacyActiveReview = lifecycle.moderationCanonical !== true
    && normalizeStatus(uploadData?.reviewStatus) === 'inReview';
  if (legacyActiveReview || normalizedReviewCaseStatuses.includes('inReview')) {
    return { action: 'defer', reason: 'active_review', storagePath };
  }

  if (lifecycle.publicationState === PUBLICATION_STATES.draft) {
'''
new_block = '''  const publication = resolveUploadPublicationState(uploadData);
  const reviewStatus = normalizeStatus(uploadData?.reviewStatus);
  const moderation = resolveUploadModerationState(uploadData);
  const normalizedReviewCaseStatuses = Array.isArray(reviewCaseStatuses)
    ? reviewCaseStatuses.map(normalizeStatus).filter(Boolean)
    : [];
  if (!publication.valid) {
    return { action: 'defer', reason: 'unknown_lifecycle_state', storagePath };
  }

  if (publication.state === PUBLICATION_STATES.published) {
    return { action: 'preserve', reason: 'published_state', storagePath };
  }

  // Legacy post-deletion retry state is an explicit terminal cleanup signal and
  // must outrank stale review metadata left on older uploads.
  const legacyPublicationStatus = normalizeStatus(uploadData?.publicationStatus || uploadData?.publishStatus);
  if (legacyPublicationStatus === 'deleted_pending_cleanup') {
    return { action: 'expire', reason: 'post_deleted_cleanup_pending', storagePath };
  }

  // A moderation state is required only when a document actually carries a
  // canonical moderation field or a legacy review marker. This lets old draft
  // and expiry records clean up without turning missing historic evidence into
  // a new retention authority, while malformed review states still fail closed.
  const moderationMustResolve = Boolean(normalizeStatus(uploadData?.moderationState) || reviewStatus);
  if (moderationMustResolve && !moderation.valid) {
    return { action: 'defer', reason: 'unknown_lifecycle_state', storagePath };
  }

  const legacyActiveReview = moderation.canonical !== true && reviewStatus === 'inReview';
  if (legacyActiveReview || normalizedReviewCaseStatuses.includes('inReview')) {
    return { action: 'defer', reason: 'active_review', storagePath };
  }

  if (publication.state === PUBLICATION_STATES.draft) {
'''
preview = replace_once(preview, old_block, new_block, 'retention publication-only authority')
old_cleanup = '''  const persistedPostId = pickString(uploadData?.postId);
  const lifecycle = resolveUploadLifecycle(uploadData);
  const legacyPublicationStatus = pickString(uploadData?.publicationStatus, uploadData?.publishStatus);
  const cleanupEligibleStatus = lifecycle.valid
    && (lifecycle.publicationState === PUBLICATION_STATES.published
      || legacyPublicationStatus === 'deleted_pending_cleanup');
'''
new_cleanup = '''  const persistedPostId = pickString(uploadData?.postId);
  const publication = resolveUploadPublicationState(uploadData);
  const legacyPublicationStatus = pickString(uploadData?.publicationStatus, uploadData?.publishStatus);
  const cleanupEligibleStatus = legacyPublicationStatus === 'deleted_pending_cleanup'
    || (publication.valid && publication.state === PUBLICATION_STATES.published);
'''
preview = replace_once(preview, old_cleanup, new_cleanup, 'deleted post cleanup publication authority')
preview_path.write_text(preview, encoding='utf-8')

# The scheduled retention query likewise needs only publication authority to
# decide whether to look up a bound draft. Full publish eligibility is checked
# elsewhere and remains stricter.
index_path = Path('functions/index.js')
index = index_path.read_text(encoding='utf-8')
index = replace_once(
    index,
    "import { MODERATION_STATES, PUBLICATION_STATES, resolveModerationStateForResult, resolveUploadLifecycle } from './moderationLifecycle.js';",
    "import { MODERATION_STATES, PUBLICATION_STATES, resolveModerationStateForResult, resolveUploadPublicationState } from './moderationLifecycle.js';",
    'index lifecycle imports',
)
index = replace_once(
    index,
    "    const lifecycle = resolveUploadLifecycle(uploadData);\n    const publicationStatus = lifecycle.valid ? lifecycle.publicationState : null;",
    "    const publicationLifecycle = resolveUploadPublicationState(uploadData);\n    const publicationStatus = publicationLifecycle.valid ? publicationLifecycle.state : null;",
    'retention publication state resolution',
)
index_path.write_text(index, encoding='utf-8')

# Source invariant follows the refined split: publication controls retention,
# review-case state controls active-review protection.
source_test_path = Path('tests/moderationCanonicalLifecycleSource.test.mjs')
source_test = source_test_path.read_text(encoding='utf-8')
source_test = replace_once(
    source_test,
    "  assert.match(retentionSource, /resolveUploadLifecycle\\(uploadData\\)/);\n  assert.match(retentionSource, /lifecycle\\.publicationState === PUBLICATION_STATES\\.published/);\n  assert.match(retentionSource, /normalizedReviewCaseStatuses\\.includes\\('inReview'\\)/);\n  assert.match(retentionSource, /lifecycle\\.moderationCanonical !== true/);",
    "  assert.match(retentionSource, /resolveUploadPublicationState\\(uploadData\\)/);\n  assert.match(retentionSource, /resolveUploadModerationState\\(uploadData\\)/);\n  assert.match(retentionSource, /publication\\.state === PUBLICATION_STATES\\.published/);\n  assert.match(retentionSource, /normalizedReviewCaseStatuses\\.includes\\('inReview'\\)/);\n  assert.match(retentionSource, /moderationMustResolve/);",
    'retention source invariant',
)
source_test_path.write_text(source_test, encoding='utf-8')

print('canonical lifecycle compatibility hardening applied')
