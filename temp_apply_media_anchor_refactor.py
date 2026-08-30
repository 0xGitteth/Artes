from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start, end, replacement, label):
    start_index = text.find(start)
    if start_index < 0:
        raise AssertionError(f'{label}: start marker not found')
    end_index = text.find(end, start_index + len(start))
    if end_index < 0:
        raise AssertionError(f'{label}: end marker not found')
    return text[:start_index] + replacement + text[end_index:]


# 1) Canonical media-state helpers: the upload document itself is the durable anchor.
storage_path = Path('functions/moderationPreviewStorage.js')
storage_source = r'''const pickString = (...values) => values
  .map((value) => String(value || '').trim())
  .find(Boolean) || null;

const normalizeStatus = (value) => String(value || '').trim();

const KNOWN_EXPIRABLE_REVIEW_STATUSES = new Set([
  '',
  'approved',
  'rejected',
  'needs_user_correction',
  'freshEvalQueued',
  'closedNoFingerprint',
]);

const KNOWN_EXPIRABLE_PUBLICATION_STATUSES = new Set([
  '',
  'pending',
  'correction_accepted',
  'needs_user_correction',
  'user_disagreed',
  'blocked',
  'discarded',
  'deleted',
  'deleted_pending_cleanup',
  'freshEvalQueued',
  'closedNoFingerprint',
  'expired',
]);

const KNOWN_MEDIA_STATES = new Set(['pending', 'ready', 'cleanup_pending', 'deleted']);

const timestampToMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return (seconds * 1000) + Math.floor(nanoseconds / 1_000_000);
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

export const resolveOwnedModerationPreviewStoragePath = (upload = {}) => {
  const ownerUid = pickString(upload?.userId, upload?.uploaderUid, upload?.ownerUid, upload?.userUid);
  if (!ownerUid || ownerUid.includes('/')) return null;

  const storagePath = pickString(upload?.storagePath, upload?.imageRef);
  if (!storagePath) return null;
  const explicitStoragePath = String(upload?.storagePath || '').trim();
  const explicitImageRef = String(upload?.imageRef || '').trim();
  if (explicitStoragePath && explicitImageRef && explicitStoragePath !== explicitImageRef) return null;

  const parts = storagePath.split('/');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'moderation-previews' || parts[1] !== ownerUid) return null;
  if (!parts[2] || parts[2] === '.' || parts[2] === '..') return null;
  return storagePath;
};

export const resolveModerationPreviewMediaState = (uploadData = {}) => {
  const explicitState = normalizeStatus(uploadData?.mediaState);
  if (explicitState) return KNOWN_MEDIA_STATES.has(explicitState) ? explicitState : 'unknown';
  return resolveOwnedModerationPreviewStoragePath(uploadData) ? 'legacy_ready' : 'none';
};

export const getModerationPendingMediaCleanupDecision = ({
  uploadId,
  uploadData = {},
  nowMs = Date.now(),
} = {}) => {
  const normalizedUploadId = pickString(uploadId);
  if (!normalizedUploadId || normalizedUploadId.includes('/')) {
    return { action: 'defer', reason: 'invalid_upload_id' };
  }

  const mediaState = resolveModerationPreviewMediaState(uploadData);
  if (mediaState === 'ready' || mediaState === 'deleted') {
    return { action: 'clear_schedule', reason: 'media_state_terminal_or_ready' };
  }
  if (mediaState === 'legacy_ready' || mediaState === 'none') {
    return { action: 'skip', reason: 'not_pending_media' };
  }
  if (mediaState === 'unknown') {
    return { action: 'defer', reason: 'unknown_media_state' };
  }
  if (mediaState !== 'pending' && mediaState !== 'cleanup_pending') {
    return { action: 'defer', reason: 'unsupported_media_state' };
  }

  const storagePath = resolveOwnedModerationPreviewStoragePath(uploadData);
  if (!storagePath) return { action: 'defer', reason: 'invalid_owned_preview' };
  const filename = storagePath.split('/')[2] || '';
  if (!filename.startsWith(`${normalizedUploadId}.`)) {
    return { action: 'defer', reason: 'upload_storage_binding_mismatch', storagePath };
  }

  const cleanupAfterMs = timestampToMillis(uploadData?.mediaCleanupAfter);
  if (!Number.isFinite(cleanupAfterMs)) {
    return { action: 'defer', reason: 'missing_cleanup_schedule', storagePath };
  }
  if (cleanupAfterMs > Number(nowMs)) {
    return { action: 'skip', reason: 'not_due', storagePath };
  }

  return {
    action: 'cleanup',
    reason: mediaState === 'pending' ? 'pending_upload_abandoned' : 'cleanup_retry_due',
    storagePath,
  };
};

export const getOperationalModerationPreviewReviewCaseId = (uploadData = {}) => (
  pickString(uploadData?.reviewCaseId)
);

export const isOperationalModerationPreviewReviewCase = ({
  uploadId,
  uploadData = {},
  reviewCaseData = {},
} = {}) => {
  const normalizedUploadId = pickString(uploadId);
  const uploadOwnerUid = pickString(uploadData?.userId, uploadData?.uploaderUid, uploadData?.ownerUid, uploadData?.userUid);
  const reviewOwnerUid = pickString(reviewCaseData?.userId, reviewCaseData?.uploaderUid, reviewCaseData?.ownerUid);
  if (!normalizedUploadId || !uploadOwnerUid || !reviewOwnerUid || uploadOwnerUid !== reviewOwnerUid) return false;
  if (normalizeStatus(reviewCaseData?.caseType) === 'report') return false;

  const referencedUploadIds = new Set([
    pickString(reviewCaseData?.uploadId),
    pickString(reviewCaseData?.linkedUploadId),
    ...(Array.isArray(reviewCaseData?.linkedUploadIds)
      ? reviewCaseData.linkedUploadIds.map((value) => pickString(value))
      : []),
  ].filter(Boolean));
  return referencedUploadIds.has(normalizedUploadId);
};

export const getModerationPreviewRetentionDecision = ({
  uploadData = {},
  productionPostExists = false,
  codexDevPostExists = false,
  reviewCaseStatuses = [],
  draftExists = false,
  draftMatchesUpload = false,
} = {}) => {
  const storagePath = resolveOwnedModerationPreviewStoragePath(uploadData);
  if (!storagePath) {
    return { action: 'clear_retention', reason: 'no_owned_preview' };
  }

  const mediaState = resolveModerationPreviewMediaState(uploadData);
  if (mediaState === 'deleted') {
    return { action: 'clear_retention', reason: 'media_already_deleted' };
  }
  if (mediaState === 'pending' || mediaState === 'cleanup_pending' || mediaState === 'unknown') {
    return { action: 'defer', reason: 'media_not_ready', storagePath };
  }

  if (productionPostExists || codexDevPostExists) {
    return { action: 'preserve', reason: 'published_media_still_referenced', storagePath };
  }

  const publicationStatus = normalizeStatus(uploadData?.publicationStatus || uploadData?.publishStatus);
  const reviewStatus = normalizeStatus(uploadData?.reviewStatus);
  const normalizedReviewCaseStatuses = Array.isArray(reviewCaseStatuses)
    ? reviewCaseStatuses.map(normalizeStatus).filter(Boolean)
    : [];

  if (publicationStatus === 'published') {
    return { action: 'preserve', reason: 'published_state', storagePath };
  }

  // Legacy recovery path. New media cleanup uses mediaState/mediaCleanupAfter.
  if (publicationStatus === 'deleted_pending_cleanup') {
    return { action: 'expire', reason: 'post_deleted_cleanup_pending', storagePath };
  }

  if (reviewStatus === 'inReview' || normalizedReviewCaseStatuses.includes('inReview')) {
    return { action: 'defer', reason: 'active_review', storagePath };
  }

  if (publicationStatus === 'draft') {
    const draftId = pickString(uploadData?.draftId);
    if (!draftId) {
      return { action: 'defer', reason: 'legacy_draft_without_binding', storagePath };
    }
    if (!draftExists) {
      return { action: 'expire', reason: 'draft_missing', storagePath };
    }
    if (!draftMatchesUpload) {
      return { action: 'defer', reason: 'draft_binding_mismatch', storagePath };
    }
    return { action: 'defer', reason: 'draft_still_exists', storagePath };
  }

  if (!KNOWN_EXPIRABLE_REVIEW_STATUSES.has(reviewStatus)
    || !KNOWN_EXPIRABLE_PUBLICATION_STATUSES.has(publicationStatus)) {
    return { action: 'defer', reason: 'unknown_lifecycle_state', storagePath };
  }

  return { action: 'expire', reason: 'retention_elapsed', storagePath };
};

export const getDeletedPublishedPostCleanupDecision = ({
  postId,
  postData = {},
  uploadExists = false,
  uploadData = {},
} = {}) => {
  const normalizedPostId = pickString(postId);
  if (!normalizedPostId) return { ok: false, reason: 'missing_post_id' };
  if (!uploadExists) return { ok: false, reason: 'upload_missing' };

  const uploadOwnerUid = pickString(uploadData?.userId, uploadData?.uploaderUid, uploadData?.ownerUid, uploadData?.userUid);
  const postOwnerUid = pickString(postData?.authorOwnerUid, postData?.authorUid, postData?.authorId);
  if (!uploadOwnerUid || !postOwnerUid || uploadOwnerUid !== postOwnerUid) {
    return { ok: false, reason: 'owner_mismatch' };
  }

  const persistedPostId = pickString(uploadData?.postId);
  const publicationStatus = pickString(uploadData?.publicationStatus, uploadData?.publishStatus);
  const cleanupEligibleStatus = publicationStatus === 'published' || publicationStatus === 'deleted_pending_cleanup';
  if (persistedPostId !== normalizedPostId || !cleanupEligibleStatus) {
    return { ok: false, reason: 'not_matching_published_upload' };
  }
  return { ok: true, postId: normalizedPostId, ownerUid: uploadOwnerUid };
};
'''
write(storage_path, storage_source)

# 2) Server flow: upload stub before Storage, one media cleanup authority.
index_path = Path('functions/index.js')
index = read(index_path)
index = replace_once(
    index,
    "import { getDeletedPublishedPostCleanupDecision, getModerationPreviewCleanupTaskDecision, getModerationPreviewRetentionDecision, getOperationalModerationPreviewReviewCaseId, isOperationalModerationPreviewReviewCase, resolveOwnedModerationPreviewStoragePath } from './moderationPreviewStorage.js';",
    "import { getDeletedPublishedPostCleanupDecision, getModerationPendingMediaCleanupDecision, getModerationPreviewRetentionDecision, getOperationalModerationPreviewReviewCaseId, isOperationalModerationPreviewReviewCase, resolveOwnedModerationPreviewStoragePath } from './moderationPreviewStorage.js';",
    'preview helper import',
)
index = replace_once(
    index,
    "const moderationPreviewOrphanCleanupDelayMs = 24 * 60 * 60 * 1000;\nconst buildModerationPreviewOrphanCleanupExpiry = (nowMs = Date.now()) => Timestamp.fromMillis(\n  Number(nowMs) + moderationPreviewOrphanCleanupDelayMs\n);",
    "const moderationPreviewPendingCleanupDelayMs = 24 * 60 * 60 * 1000;\nconst moderationPreviewCleanupRetryMs = 6 * 60 * 60 * 1000;\nconst buildModerationPreviewPendingCleanupExpiry = (nowMs = Date.now()) => Timestamp.fromMillis(\n  Number(nowMs) + moderationPreviewPendingCleanupDelayMs\n);",
    'preview cleanup constants',
)

preview_helpers = r'''const buildModerationPreviewStoragePath = ({ mimeType, userId, uploadId }) => {
  const normalizedUserId = String(userId || '').trim();
  const normalizedUploadId = String(uploadId || '').trim();
  if (!normalizedUserId || normalizedUserId.includes('/') || !normalizedUploadId || normalizedUploadId.includes('/')) {
    throw new Error('Moderation preview requires a valid owner and upload id');
  }
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `moderation-previews/${normalizedUserId}/${normalizedUploadId}.${extension}`;
};

const persistModerationPreview = async ({ buffer, mimeType, userId, uploadId, storagePath: expectedStoragePath = null }) => {
  if (!buffer || !mimeType) return null;
  const storagePath = buildModerationPreviewStoragePath({ mimeType, userId, uploadId });
  if (expectedStoragePath && String(expectedStoragePath).trim() !== storagePath) {
    throw new Error('Moderation preview storage binding changed');
  }

  const bucket = admin.storage().bucket();
  const token = crypto.randomUUID();
  await bucket.file(storagePath).save(buffer, {
    contentType: mimeType,
    resumable: false,
    metadata: {
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
  return {
    storagePath,
    imageUrl,
    imageRef: storagePath,
  };
};

const markModerationPreviewCleanupPending = async ({ uploadRef, reason, nowMs = Date.now() } = {}) => {
  if (!uploadRef) return false;
  try {
    let marked = false;
    await db.runTransaction(async (transaction) => {
      const uploadSnap = await transaction.get(uploadRef);
      if (!uploadSnap.exists) return;
      const uploadData = uploadSnap.data() || {};
      const mediaState = String(uploadData?.mediaState || '').trim();
      if (mediaState !== 'pending' && mediaState !== 'cleanup_pending') return;
      if (!resolveOwnedModerationPreviewStoragePath(uploadData)) return;
      transaction.set(uploadRef, {
        mediaState: 'cleanup_pending',
        mediaCleanupAfter: Timestamp.fromMillis(Number(nowMs)),
        mediaCleanupReason: String(reason || 'upload_not_finalized'),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      marked = true;
    });
    return marked;
  } catch (error) {
    logger.warn('Moderation preview cleanup retry could not be scheduled immediately.', {
      uploadId: uploadRef.id,
      reason: String(reason || ''),
      error: error?.message || String(error),
    });
    return false;
  }
};

'''
index = replace_between(
    index,
    "const getModerationPreviewCleanupTaskRef = (uploadId) => db\n",
    "const ensureJsonBody = (req) => {",
    preview_helpers,
    'preview storage helpers',
)

moderate_upload_block = r'''  const uploadRef = db.collection('uploads').doc();
  let persistedPreview = null;
  let previewField = null;
  let uploadStubCreated = false;
  let uploadSuppressedByHistoricalRegistry = false;
  let plannedPreviewStoragePath = null;
  try {
    plannedPreviewStoragePath = buildModerationPreviewStoragePath({
      mimeType: parsed.mimeType,
      userId,
      uploadId: uploadRef.id,
    });
    const pendingCleanupAfter = buildModerationPreviewPendingCleanupExpiry();

    // The upload is the durable media anchor. Storage is never touched until
    // this server-owned stub has committed behind the current generation fence.
    await db.runTransaction(async (transaction) => {
      uploadStubCreated = false;
      uploadSuppressedByHistoricalRegistry = false;
      const newlyDenied = !isCodexActor
        && await isKnownCodexDevActorUid({ db, uid: userId, transaction });
      const freshModerationScope = await readModerationScopeGeneration({ db, fingerprints, transaction });
      if (newlyDenied) {
        uploadSuppressedByHistoricalRegistry = true;
        return;
      }
      if (freshModerationScope.generation !== requestModerationGeneration) {
        const error = new Error('Fresh evaluation superseded this moderation request');
        error.status = 409;
        error.code = 'fresh_evaluation_superseded_during_request';
        throw error;
      }
      transaction.create(uploadRef, {
        userId: userId || null,
        uploaderUid: userId || null,
        moderationGeneration: requestModerationGeneration,
        moderationScopeKey: requestModerationScope.scopeKey,
        fingerprints,
        mediaState: 'pending',
        storagePath: plannedPreviewStoragePath,
        imageRef: plannedPreviewStoragePath,
        mediaCleanupAfter: pendingCleanupAfter,
        mediaCleanupReason: 'upload_not_finalized',
        ...(isCodexActor ? { testActor: CODEX_DEV_ACTOR } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      uploadStubCreated = true;
    });

    if (uploadStubCreated) {
      try {
        persistedPreview = await persistModerationPreview({
          buffer: parsed.buffer,
          mimeType: parsed.mimeType,
          userId,
          uploadId: uploadRef.id,
          storagePath: plannedPreviewStoragePath,
        });
      } catch (error) {
        await markModerationPreviewCleanupPending({
          uploadRef,
          reason: 'storage_write_failed',
        });
        throw error;
      }

      if (persistedPreview?.imageUrl) {
        persistedPreview.previewUrl = persistedPreview.imageUrl;
        previewField = 'imageUrl';
      }

      const routedUserCorrection = outcome === 'needsCorrection'
        && previousModeratorExample?.routingApplied === true
        && previousModeratorExample?.action === 'requestUserCorrection'
        && response.moderatorCorrectedTaxonomy
        && typeof response.moderatorCorrectedTaxonomy === 'object';
      const routedUserCorrectionTaxonomy = routedUserCorrection ? response.moderatorCorrectedTaxonomy : null;
      const routedUserCorrectionReviewCaseId = routedUserCorrection
        ? (matchedModerationExample?.data?.reviewCaseId || null)
        : null;
      const routedUserCorrectionReviewCaseOwnerUid = routedUserCorrection
        ? (matchedModerationExample?.data?.uploaderUid || matchedModerationExample?.data?.userId || null)
        : null;

      const uploadPayload = {
        userId: userId || null,
        uploaderUid: userId || null,
        moderationGeneration: requestModerationGeneration,
        moderationScopeKey: requestModerationScope.scopeKey,
        ...(isCodexActor ? { testActor: CODEX_DEV_ACTOR } : {}),
        outcome,
        classification,
        shouldReview: effectiveShouldReview,
        publishBlocked,
        moderationSignals: response.moderationSignals || null,
        appliedTriggers: finalAppliedTriggers,
        suggestedTriggers: finalSuggestedTriggers,
        forbiddenReasons: finalForbiddenReasons,
        userSelectedTaxonomy: response.userSelectedTaxonomy,
        aiSuggestedTaxonomy: response.aiSuggestedTaxonomy,
        aiSafetySignals: response.aiSafetySignals,
        aiVisionLabels: response.aiVisionLabels,
        policyAppliedTriggers: response.policyAppliedTriggers,
        geminiDiagnostics: response.geminiDiagnostics || null,
        reviewCaseId: reviewCaseId || null,
        previousModeratorExample,
        ...(routedUserCorrection ? {
          correctedTaxonomy: routedUserCorrectionTaxonomy,
          moderatorDecision: {
            action: 'requestUserCorrection',
            reasonCode: matchedModerationExample?.data?.moderatorDecision?.reasonCode || null,
            correctedTaxonomy: routedUserCorrectionTaxonomy,
            requiresUploaderAcceptance: true,
            finalPolicyOutcome: 'allowed',
          },
          requiresUploaderAcceptance: true,
          publicationStatus: 'needs_user_correction',
          reviewStatus: 'needs_user_correction',
          correctionReviewCaseId: routedUserCorrectionReviewCaseId,
          correctionReviewCaseOwnerUid: routedUserCorrectionReviewCaseOwnerUid,
        } : {}),
        fingerprints,
        matchedUploadId: matchedUpload?.id || null,
        ...(persistedPreview?.imageUrl ? { imageUrl: persistedPreview.imageUrl } : {}),
        ...(persistedPreview?.previewUrl ? { previewUrl: persistedPreview.previewUrl } : {}),
        ...(persistedPreview?.imageRef ? { imageRef: persistedPreview.imageRef } : {}),
        ...(persistedPreview?.storagePath ? {
          storagePath: persistedPreview.storagePath,
          previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(),
        } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      let finalizationOutcome = 'pending';
      await db.runTransaction(async (transaction) => {
        const uploadSnap = await transaction.get(uploadRef);
        if (!uploadSnap.exists) {
          const error = new Error('Moderation media anchor disappeared before finalization');
          error.status = 409;
          error.code = 'moderation_media_anchor_missing';
          throw error;
        }
        const freshModerationScope = await readModerationScopeGeneration({ db, fingerprints, transaction });
        const newlyDenied = !isCodexActor
          && await isKnownCodexDevActorUid({ db, uid: userId, transaction });
        const stubData = uploadSnap.data() || {};
        const stubOwnerUid = String(stubData?.userId || stubData?.uploaderUid || '').trim();
        const stubStoragePath = resolveOwnedModerationPreviewStoragePath(stubData);
        const stubMediaState = String(stubData?.mediaState || '').trim();
        if (stubOwnerUid !== String(userId || '').trim()
          || stubStoragePath !== plannedPreviewStoragePath
          || stubMediaState !== 'pending') {
          const error = new Error('Moderation media anchor changed before finalization');
          error.status = 409;
          error.code = 'moderation_media_anchor_changed';
          throw error;
        }

        if (newlyDenied) {
          transaction.set(uploadRef, {
            mediaState: 'cleanup_pending',
            mediaCleanupAfter: Timestamp.fromMillis(Date.now()),
            mediaCleanupReason: 'historical_registry_suppressed',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          finalizationOutcome = 'suppressed';
          return;
        }
        if (freshModerationScope.generation !== requestModerationGeneration) {
          transaction.set(uploadRef, {
            mediaState: 'cleanup_pending',
            mediaCleanupAfter: Timestamp.fromMillis(Date.now()),
            mediaCleanupReason: 'moderation_generation_superseded',
            moderationState: 'superseded',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          finalizationOutcome = 'superseded';
          return;
        }

        transaction.set(uploadRef, {
          ...uploadPayload,
          mediaState: 'ready',
          mediaCleanupAfter: FieldValue.delete(),
          mediaCleanupReason: FieldValue.delete(),
          mediaCleanupClaimId: FieldValue.delete(),
          mediaCleanupClaimedAt: FieldValue.delete(),
        }, { merge: true });
        finalizationOutcome = 'ready';
      });

      if (finalizationOutcome === 'ready') {
        uploadId = uploadRef.id;
      } else if (finalizationOutcome === 'suppressed') {
        uploadSuppressedByHistoricalRegistry = true;
        persistedPreview = null;
        previewField = null;
      } else if (finalizationOutcome === 'superseded') {
        const error = new Error('Fresh evaluation superseded this moderation request');
        error.status = 409;
        error.code = 'fresh_evaluation_superseded_during_request';
        throw error;
      } else {
        const error = new Error('Moderation upload did not reach a durable ready state');
        error.status = 500;
        error.code = 'moderation_upload_not_finalized';
        throw error;
      }
    }

    if (process.env.NODE_ENV === 'development') {
      logger.debug('Moderation preview linked to upload', {
        uploadId,
        reviewCaseId: reviewCaseId || null,
        previewField,
        mediaState: uploadId ? 'ready' : (uploadSuppressedByHistoricalRegistry ? 'cleanup_pending' : null),
      });
    }
  } catch (error) {
    if (uploadStubCreated && !uploadId) {
      await markModerationPreviewCleanupPending({
        uploadRef,
        reason: error?.code || 'upload_finalization_failed',
      });
    }
    if (error?.code === 'fresh_evaluation_superseded_during_request') throw error;
    logger.error('Upload opslaan mislukt.', error);
  }

'''
index = replace_between(
    index,
    "  const uploadRef = db.collection('uploads').doc();\n",
    "  if (reviewCaseId && uploadId) {",
    moderate_upload_block,
    'moderate image upload persistence block',
)

# Retention claims hand media cleanup to the media-state authority instead of
# keeping an overlapping retention retry mechanism.
index = replace_once(
    index,
    "      previewRetentionDeferredAt: FieldValue.delete(),\n      previewRetentionDeferredReason: FieldValue.delete(),\n    }, { merge: true });\n    result = {\n      ...decision,\n      claimId,\n      uploadData,\n    };",
    "      previewRetentionDeferredAt: FieldValue.delete(),\n      previewRetentionDeferredReason: FieldValue.delete(),\n      previewRetentionExpiresAt: FieldValue.delete(),\n      mediaState: 'cleanup_pending',\n      mediaCleanupAfter: Timestamp.fromMillis(Number(nowMs) + moderationPreviewCleanupRetryMs),\n      mediaCleanupReason: 'retention_elapsed',\n    }, { merge: true });\n    result = {\n      ...decision,\n      claimId,\n      uploadData,\n    };",
    'retention to media cleanup handoff',
)
index = replace_once(
    index,
    "      ...(cleaned ? {\n        imageUrl: FieldValue.delete(),\n        previewUrl: FieldValue.delete(),\n        imageRef: FieldValue.delete(),\n        storagePath: FieldValue.delete(),\n        previewCleanedAt: FieldValue.serverTimestamp(),\n        previewExpiredAt: FieldValue.serverTimestamp(),\n      } : {}),\n      previewRetentionExpiresAt: FieldValue.delete(),\n      previewExpiryClaimId: FieldValue.delete(),",
    "      ...(cleaned ? {\n        imageUrl: FieldValue.delete(),\n        previewUrl: FieldValue.delete(),\n        imageRef: FieldValue.delete(),\n        storagePath: FieldValue.delete(),\n        mediaState: 'deleted',\n        mediaCleanupAfter: FieldValue.delete(),\n        mediaCleanupReason: FieldValue.delete(),\n        mediaCleanupClaimId: FieldValue.delete(),\n        mediaCleanupClaimedAt: FieldValue.delete(),\n        previewCleanedAt: FieldValue.serverTimestamp(),\n        previewExpiredAt: FieldValue.serverTimestamp(),\n      } : {}),\n      previewRetentionExpiresAt: FieldValue.delete(),\n      previewExpiryClaimId: FieldValue.delete(),",
    'expired preview final state',
)
index = replace_once(
    index,
    "      postId: uploadRef.id,\n      previewRetentionExpiresAt: FieldValue.delete(),\n      previewExpiryClaimId: FieldValue.delete(),",
    "      postId: uploadRef.id,\n      mediaState: 'ready',\n      mediaCleanupAfter: FieldValue.delete(),\n      mediaCleanupReason: FieldValue.delete(),\n      mediaCleanupClaimId: FieldValue.delete(),\n      mediaCleanupClaimedAt: FieldValue.delete(),\n      previewRetentionExpiresAt: FieldValue.delete(),\n      previewExpiryClaimId: FieldValue.delete(),",
    'published race recovery media state',
)
index = replace_once(
    index,
    "  if (cleanup.deleted) {\n    await finalizeExpiredModerationPreviewClaim({ uploadRef, claimId: claim.claimId, cleaned: true });",
    "  if (cleanup.deleted || cleanup.reason === 'no_owned_preview') {\n    await finalizeExpiredModerationPreviewClaim({ uploadRef, claimId: claim.claimId, cleaned: true });",
    'expired cleanup no-preview finalization',
)

pending_media_helpers = r'''const claimPendingModerationPreviewMedia = async ({ uploadRef, nowMs = Date.now() } = {}) => {
  let result = { action: 'skip', reason: 'not_due' };
  await db.runTransaction(async (transaction) => {
    const uploadSnap = await transaction.get(uploadRef);
    if (!uploadSnap.exists) {
      result = { action: 'skip', reason: 'upload_missing' };
      return;
    }
    const uploadData = uploadSnap.data() || {};
    const decision = getModerationPendingMediaCleanupDecision({
      uploadId: uploadRef.id,
      uploadData,
      nowMs,
    });

    if (decision.action === 'clear_schedule') {
      transaction.set(uploadRef, {
        mediaCleanupAfter: FieldValue.delete(),
        mediaCleanupReason: FieldValue.delete(),
        mediaCleanupClaimId: FieldValue.delete(),
        mediaCleanupClaimedAt: FieldValue.delete(),
      }, { merge: true });
      result = decision;
      return;
    }
    if (decision.action !== 'cleanup') {
      result = decision;
      return;
    }

    const [productionPostSnap, codexDevPostSnap] = await Promise.all([
      transaction.get(db.collection('posts').doc(uploadRef.id)),
      transaction.get(db.collection('codexDevPosts').doc(uploadRef.id)),
    ]);
    if (productionPostSnap.exists || codexDevPostSnap.exists) {
      transaction.set(uploadRef, {
        mediaState: 'ready',
        mediaCleanupAfter: FieldValue.delete(),
        mediaCleanupReason: FieldValue.delete(),
        mediaCleanupClaimId: FieldValue.delete(),
        mediaCleanupClaimedAt: FieldValue.delete(),
        mediaCleanupRecoveredAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      result = { action: 'preserve', reason: 'published_media_still_referenced', storagePath: decision.storagePath };
      return;
    }

    const claimId = crypto.randomUUID();
    transaction.set(uploadRef, {
      mediaState: 'cleanup_pending',
      mediaCleanupClaimId: claimId,
      mediaCleanupClaimedAt: FieldValue.serverTimestamp(),
      mediaCleanupAfter: Timestamp.fromMillis(Number(nowMs) + moderationPreviewCleanupRetryMs),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    result = {
      action: 'cleanup',
      reason: decision.reason,
      storagePath: decision.storagePath,
      claimId,
      uploadData,
    };
  });
  return result;
};

const finalizePendingModerationPreviewMediaClaim = async ({
  uploadRef,
  claimId,
  cleaned = false,
  preserved = false,
  nowMs = Date.now(),
} = {}) => {
  await db.runTransaction(async (transaction) => {
    const uploadSnap = await transaction.get(uploadRef);
    if (!uploadSnap.exists) return;
    const uploadData = uploadSnap.data() || {};
    if (String(uploadData?.mediaCleanupClaimId || '').trim() !== String(claimId || '').trim()) return;

    if (preserved) {
      transaction.set(uploadRef, {
        mediaState: 'ready',
        mediaCleanupAfter: FieldValue.delete(),
        mediaCleanupReason: FieldValue.delete(),
        mediaCleanupClaimId: FieldValue.delete(),
        mediaCleanupClaimedAt: FieldValue.delete(),
        mediaCleanupRecoveredAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    if (cleaned) {
      const publicationStatus = String(uploadData?.publicationStatus || uploadData?.publishStatus || '').trim();
      transaction.set(uploadRef, {
        ...(publicationStatus === 'deleted_pending_cleanup' ? {
          publicationStatus: 'deleted',
          publishStatus: 'deleted',
        } : {}),
        mediaState: 'deleted',
        imageUrl: FieldValue.delete(),
        previewUrl: FieldValue.delete(),
        imageRef: FieldValue.delete(),
        storagePath: FieldValue.delete(),
        mediaCleanupAfter: FieldValue.delete(),
        mediaCleanupReason: FieldValue.delete(),
        mediaCleanupClaimId: FieldValue.delete(),
        mediaCleanupClaimedAt: FieldValue.delete(),
        previewRetentionExpiresAt: FieldValue.delete(),
        previewExpiryClaimId: FieldValue.delete(),
        previewCleanedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return;
    }

    transaction.set(uploadRef, {
      mediaState: 'cleanup_pending',
      mediaCleanupAfter: Timestamp.fromMillis(Number(nowMs) + moderationPreviewCleanupRetryMs),
      mediaCleanupClaimId: FieldValue.delete(),
      mediaCleanupClaimedAt: FieldValue.delete(),
      mediaCleanupRetryScheduledAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
};

const processPendingModerationPreviewMedia = async ({ uploadRef, nowMs = Date.now() } = {}) => {
  const claim = await claimPendingModerationPreviewMedia({ uploadRef, nowMs });
  if (claim.action !== 'cleanup') return claim;

  try {
    const cleanup = await cleanupModerationPreviewForUpload({
      uploadId: uploadRef.id,
      uploadData: claim.uploadData,
    });
    if (cleanup.deleted || cleanup.reason === 'no_owned_preview') {
      await finalizePendingModerationPreviewMediaClaim({
        uploadRef,
        claimId: claim.claimId,
        cleaned: true,
        nowMs,
      });
      return { action: 'cleaned', reason: claim.reason, storagePath: cleanup.storagePath || claim.storagePath };
    }
    if (cleanup.reason === 'published_media_still_referenced') {
      await finalizePendingModerationPreviewMediaClaim({
        uploadRef,
        claimId: claim.claimId,
        preserved: true,
        nowMs,
      });
      return { action: 'preserve', reason: cleanup.reason, storagePath: cleanup.storagePath };
    }
    await finalizePendingModerationPreviewMediaClaim({
      uploadRef,
      claimId: claim.claimId,
      cleaned: false,
      nowMs,
    });
    return { action: 'defer', reason: cleanup.reason || 'cleanup_not_completed' };
  } catch (error) {
    await finalizePendingModerationPreviewMediaClaim({
      uploadRef,
      claimId: claim.claimId,
      cleaned: false,
      nowMs,
    });
    throw error;
  }
};

'''
index = replace_once(
    index,
    "export const cleanupExpiredModerationPreviews = onSchedule({",
    pending_media_helpers + "export const cleanupExpiredModerationPreviews = onSchedule({",
    'pending media cleanup helpers',
)

old_orphan_start = "  const orphanSnapshot = await db.collection('moderationPreviewCleanupTasks')\n"
old_orphan_end = "  logger.info('Moderation preview retention cleanup completed.', summary);"
new_pending_scan = r'''  const pendingMediaSnapshot = await db.collection('uploads')
    .where('mediaCleanupAfter', '<=', now)
    .orderBy('mediaCleanupAfter', 'asc')
    .limit(moderationPreviewGcBatchSize)
    .get();
  summary.pendingMediaScanned = pendingMediaSnapshot.size;
  summary.pendingMediaCleaned = 0;
  summary.pendingMediaPreserved = 0;
  summary.pendingMediaDeferred = 0;
  summary.pendingMediaSkipped = 0;
  summary.pendingMediaFailed = 0;

  for (const docSnap of pendingMediaSnapshot.docs) {
    try {
      const result = await processPendingModerationPreviewMedia({
        uploadRef: docSnap.ref,
        nowMs: now.toMillis(),
      });
      if (result.action === 'cleaned') summary.pendingMediaCleaned += 1;
      else if (result.action === 'preserve') summary.pendingMediaPreserved += 1;
      else if (result.action === 'defer') summary.pendingMediaDeferred += 1;
      else summary.pendingMediaSkipped += 1;
    } catch (error) {
      summary.pendingMediaFailed += 1;
      logger.error('Pending moderation preview cleanup failed.', {
        uploadId: docSnap.id,
        error: error?.message || String(error),
      });
    }
  }

'''
index = replace_between(index, old_orphan_start, old_orphan_end, new_pending_scan, 'remove parallel cleanup-task scan')

# Published-post and discard cleanup also converge on mediaState.
index = replace_once(
    index,
    "        previewCleanupRetryScheduledAt: FieldValue.serverTimestamp(),\n        previewRetentionExpiresAt: Timestamp.fromMillis(Date.now()),",
    "        previewCleanupRetryScheduledAt: FieldValue.serverTimestamp(),\n        mediaState: 'cleanup_pending',\n        mediaCleanupAfter: Timestamp.fromMillis(Date.now()),\n        mediaCleanupReason: 'deleted_post_cleanup_failed',\n        previewRetentionExpiresAt: FieldValue.delete(),",
    'deleted post cleanup retry state',
)
index = replace_once(
    index,
    "    imageUrl: FieldValue.delete(),\n    previewUrl: FieldValue.delete(),\n    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),",
    "    imageUrl: FieldValue.delete(),\n    previewUrl: FieldValue.delete(),\n    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    mediaState: 'deleted',\n    mediaCleanupAfter: FieldValue.delete(),\n    mediaCleanupReason: FieldValue.delete(),\n    mediaCleanupClaimId: FieldValue.delete(),\n    mediaCleanupClaimedAt: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),",
    'deleted published post final media state',
)
index = replace_once(
    index,
    "    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),\n    previewRetentionExpiresAt: FieldValue.delete(),\n    previewExpiryClaimId: FieldValue.delete(),\n  }, { merge: true });\n});\n\nexport const onProductionPostDeleted",
    "    imageRef: FieldValue.delete(),\n    storagePath: FieldValue.delete(),\n    mediaState: 'deleted',\n    mediaCleanupAfter: FieldValue.delete(),\n    mediaCleanupReason: FieldValue.delete(),\n    mediaCleanupClaimId: FieldValue.delete(),\n    mediaCleanupClaimedAt: FieldValue.delete(),\n    previewCleanedAt: FieldValue.serverTimestamp(),\n    previewRetentionExpiresAt: FieldValue.delete(),\n    previewExpiryClaimId: FieldValue.delete(),\n  }, { merge: true });\n});\n\nexport const onProductionPostDeleted",
    'discard final media state',
)
write(index_path, index)

# 3) New explicit mediaState must fail closed for reuse and publication; legacy docs remain compatible.
reuse_path = Path('functions/moderationReuseRouting.js')
reuse = read(reuse_path)
reuse = replace_once(
    reuse,
    "  const expected = String(expectedPromptVersion || '').trim();\n  if (!expected) return false;",
    "  const expected = String(expectedPromptVersion || '').trim();\n  if (!expected) return false;\n  const mediaState = String(uploadData?.mediaState || '').trim();\n  if (mediaState && mediaState !== 'ready') return false;",
    'cache reuse media readiness fence',
)
write(reuse_path, reuse)

policy_path = Path('functions/userModerationActionPolicy.js')
policy = read(policy_path)
policy = replace_once(
    policy,
    "export function canPublishUpload(upload = {}) {\n  if (upload?.requiresUploaderAcceptance === true) return false;",
    "export function canPublishUpload(upload = {}) {\n  const mediaState = String(upload?.mediaState || '').trim();\n  if (mediaState && mediaState !== 'ready') return false;\n  if (upload?.requiresUploaderAcceptance === true) return false;",
    'publication media readiness fence',
)
write(policy_path, policy)

# 4) Remove the branch-only cleanup-task collection. Unknown collections are already denied by default.
rules_path = Path('firestore.rules')
rules = read(rules_path)
rules = replace_once(
    rules,
    "    match /moderationPreviewCleanupTasks/{taskId} {\n      allow read, write: if false;\n    }\n",
    "",
    'remove cleanup-task Firestore rule',
)
write(rules_path, rules)

# 5) Tests for the media anchor/state machine.
preview_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDeletedPublishedPostCleanupDecision,
  getModerationPendingMediaCleanupDecision,
  getModerationPreviewRetentionDecision,
  getOperationalModerationPreviewReviewCaseId,
  isOperationalModerationPreviewReviewCase,
  resolveModerationPreviewMediaState,
  resolveOwnedModerationPreviewStoragePath,
} from '../moderationPreviewStorage.js';

const basePreviewUpload = {
  userId: 'user-1',
  storagePath: 'moderation-previews/user-1/abc.jpg',
  imageRef: 'moderation-previews/user-1/abc.jpg',
};

test('owned moderation preview path resolves for canonical server upload state', () => {
  assert.equal(resolveOwnedModerationPreviewStoragePath(basePreviewUpload), 'moderation-previews/user-1/abc.jpg');
  assert.equal(resolveModerationPreviewMediaState(basePreviewUpload), 'legacy_ready');
  assert.equal(resolveModerationPreviewMediaState({ ...basePreviewUpload, mediaState: 'ready' }), 'ready');
});

test('preview cleanup path fails closed for cross-owner, traversal, disagreement and unrelated storage', () => {
  for (const upload of [
    { userId: 'user-1', storagePath: 'moderation-previews/user-2/abc.jpg' },
    { userId: 'user-1', storagePath: 'moderation-previews/user-1/../abc.jpg' },
    { userId: 'user-1', storagePath: 'public-posts/user-1/abc.jpg' },
    { userId: 'user-1', storagePath: 'moderation-previews/user-1/abc.jpg', imageRef: 'moderation-previews/user-1/other.jpg' },
    { userId: 'user/1', storagePath: 'moderation-previews/user/1/abc.jpg' },
    { storagePath: 'moderation-previews/user-1/abc.jpg' },
  ]) {
    assert.equal(resolveOwnedModerationPreviewStoragePath(upload), null);
  }
});

test('pending media cleanup is bound to the upload document, deterministic path and due time', () => {
  const uploadData = {
    userId: 'user-1',
    mediaState: 'pending',
    storagePath: 'moderation-previews/user-1/upload-1.jpg',
    imageRef: 'moderation-previews/user-1/upload-1.jpg',
    mediaCleanupAfter: { seconds: 100 },
  };
  assert.deepEqual(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1',
    uploadData,
    nowMs: 100_000,
  }), {
    action: 'cleanup',
    reason: 'pending_upload_abandoned',
    storagePath: uploadData.storagePath,
  });
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData, nowMs: 99_999,
  }).reason, 'not_due');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-2', uploadData, nowMs: 100_000,
  }).reason, 'upload_storage_binding_mismatch');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...uploadData, mediaCleanupAfter: null }, nowMs: 100_000,
  }).reason, 'missing_cleanup_schedule');
});

test('ready/deleted media clears stray pending cleanup schedules while legacy media is not claimed', () => {
  const canonical = {
    userId: 'user-1',
    storagePath: 'moderation-previews/user-1/upload-1.jpg',
    imageRef: 'moderation-previews/user-1/upload-1.jpg',
    mediaCleanupAfter: { seconds: 1 },
  };
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...canonical, mediaState: 'ready' }, nowMs: 2_000,
  }).action, 'clear_schedule');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...canonical, mediaState: 'deleted' }, nowMs: 2_000,
  }).action, 'clear_schedule');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: canonical, nowMs: 2_000,
  }).action, 'skip');
  assert.equal(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-1', uploadData: { ...canonical, mediaState: 'future_state' }, nowMs: 2_000,
  }).reason, 'unknown_media_state');
});

test('retention expires abandoned initial, approved, rejected and fresh-evaluation ready attempts', () => {
  const cases = [
    { ...basePreviewUpload, mediaState: 'ready', outcome: 'allowed' },
    { ...basePreviewUpload, mediaState: 'ready', outcome: 'forbidden', publishBlocked: true },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'approved', publicationStatus: 'pending' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'approved', publicationStatus: 'correction_accepted' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'rejected', publicationStatus: 'blocked' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'needs_user_correction', publicationStatus: 'needs_user_correction' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'needs_user_correction', publicationStatus: 'user_disagreed' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'freshEvalQueued', publicationStatus: 'freshEvalQueued' },
    { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'closedNoFingerprint', publicationStatus: 'closedNoFingerprint' },
    { ...basePreviewUpload, reviewStatus: 'approved', publicationStatus: 'deleted_pending_cleanup' },
    { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'expired' },
  ];
  for (const uploadData of cases) {
    assert.equal(getModerationPreviewRetentionDecision({ uploadData }).action, 'expire');
  }
});

test('retention does not race media that is pending cleanup', () => {
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'cleanup_pending', publicationStatus: 'expired' },
  }).reason, 'media_not_ready');
});

test('post-deletion cleanup state overrides stale review metadata for legacy uploads', () => {
  assert.deepEqual(getModerationPreviewRetentionDecision({
    uploadData: {
      ...basePreviewUpload,
      reviewStatus: 'inReview',
      publicationStatus: 'deleted_pending_cleanup',
    },
    reviewCaseStatuses: ['inReview'],
  }), {
    action: 'expire',
    reason: 'post_deleted_cleanup_pending',
    storagePath: basePreviewUpload.storagePath,
  });
});

test('retention defers active review even when the upload state itself looks terminal', () => {
  assert.deepEqual(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'inReview', publicationStatus: 'user_disagreed' },
  }), {
    action: 'defer',
    reason: 'active_review',
    storagePath: basePreviewUpload.storagePath,
  });
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'needs_user_correction', publicationStatus: 'user_disagreed' },
    reviewCaseStatuses: ['inReview'],
  }).action, 'defer');
});

test('draft retention is bound to the exact persisted draft', () => {
  const uploadData = { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'draft', draftId: 'draft-1' };
  assert.equal(getModerationPreviewRetentionDecision({ uploadData, draftExists: true, draftMatchesUpload: true }).reason, 'draft_still_exists');
  assert.equal(getModerationPreviewRetentionDecision({ uploadData, draftExists: false, draftMatchesUpload: false }).reason, 'draft_missing');
  assert.equal(getModerationPreviewRetentionDecision({ uploadData, draftExists: true, draftMatchesUpload: false }).reason, 'draft_binding_mismatch');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'draft' },
  }).reason, 'legacy_draft_without_binding');
});

test('retention never expires published media or unknown future lifecycle states', () => {
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', publicationStatus: 'published' },
  }).action, 'preserve');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'approved', publicationStatus: 'pending' },
    productionPostExists: true,
  }).action, 'preserve');
  assert.equal(getModerationPreviewRetentionDecision({
    uploadData: { ...basePreviewUpload, mediaState: 'ready', reviewStatus: 'future_review_state', publicationStatus: 'pending' },
  }).reason, 'unknown_lifecycle_state');
});

test('retention clears stale scheduling metadata when no owned preview remains', () => {
  assert.deepEqual(getModerationPreviewRetentionDecision({ uploadData: { userId: 'user-1', outcome: 'allowed' } }), {
    action: 'clear_retention',
    reason: 'no_owned_preview',
  });
});

test('post-delete cleanup requires the exact published upload and same owner', () => {
  const base = {
    postId: 'upload-1',
    postData: { authorOwnerUid: 'user-1' },
    uploadExists: true,
    uploadData: { userId: 'user-1', postId: 'upload-1', publicationStatus: 'published' },
  };
  assert.deepEqual(getDeletedPublishedPostCleanupDecision(base), { ok: true, postId: 'upload-1', ownerUid: 'user-1' });
  assert.deepEqual(getDeletedPublishedPostCleanupDecision({
    ...base,
    uploadData: { ...base.uploadData, publicationStatus: 'deleted_pending_cleanup' },
  }), { ok: true, postId: 'upload-1', ownerUid: 'user-1' });
  const cases = [
    [{ ...base, postId: '' }, 'missing_post_id'],
    [{ ...base, uploadExists: false }, 'upload_missing'],
    [{ ...base, postData: { authorOwnerUid: 'user-2' } }, 'owner_mismatch'],
    [{ ...base, uploadData: { ...base.uploadData, postId: 'other' } }, 'not_matching_published_upload'],
    [{ ...base, uploadData: { ...base.uploadData, publicationStatus: 'discarded' } }, 'not_matching_published_upload'],
  ];
  for (const [input, reason] of cases) assert.deepEqual(getDeletedPublishedPostCleanupDecision(input), { ok: false, reason });
});

test('only a direct owned review case can hold preview retention', () => {
  const uploadData = { ...basePreviewUpload, reviewCaseId: 'case-direct', correctionReviewCaseId: 'case-provenance-only' };
  assert.equal(getOperationalModerationPreviewReviewCaseId(uploadData), 'case-direct');
  assert.equal(getOperationalModerationPreviewReviewCaseId({ ...basePreviewUpload, correctionReviewCaseId: 'case-provenance-only' }), null);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1', uploadData: { ...basePreviewUpload, userId: 'user-1' }, reviewCaseData: { userId: 'user-1', caseType: 'upload', linkedUploadIds: ['upload-1'] },
  }), true);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1', uploadData: { ...basePreviewUpload, userId: 'user-1' }, reviewCaseData: { userId: 'user-2', caseType: 'upload', linkedUploadIds: ['upload-1'] },
  }), false);
  assert.equal(isOperationalModerationPreviewReviewCase({
    uploadId: 'upload-1', uploadData: { ...basePreviewUpload, userId: 'user-1' }, reviewCaseData: { userId: 'user-1', caseType: 'report', linkedUploadIds: ['upload-1'] },
  }), false);
});
'''
write('functions/test/moderationPreviewStorage.test.js', preview_test)

source_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const persistedSource = readFileSync(new URL('../functions/persistedPublication.js', import.meta.url), 'utf8');
const firestoreRulesSource = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('upload document is the durable preview anchor before Storage is touched', () => {
  const start = indexSource.indexOf("const uploadRef = db.collection('uploads').doc();");
  const end = indexSource.indexOf('if (reviewCaseId && uploadId)', start);
  const source = indexSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.indexOf("mediaState: 'pending'") < source.indexOf('persistedPreview = await persistModerationPreview({'));
  assert.ok(source.indexOf('transaction.create(uploadRef, {') < source.indexOf('persistedPreview = await persistModerationPreview({'));
  assert.ok(source.includes("mediaState: 'ready'"));
  assert.ok(source.includes('mediaCleanupAfter: FieldValue.delete()'));
  assert.ok(source.includes("mediaCleanupReason: 'moderation_generation_superseded'"));
});

test('preview cleanup has one upload-owned authority rather than a parallel cleanup-task collection', () => {
  assert.equal(indexSource.includes('moderationPreviewCleanupTasks'), false);
  assert.equal(firestoreRulesSource.includes('moderationPreviewCleanupTasks'), false);
  assert.ok(indexSource.includes(".where('mediaCleanupAfter', '<=', now)"));
  assert.ok(indexSource.includes('processPendingModerationPreviewMedia({'));
  assert.ok(indexSource.includes('mediaCleanupClaimId'));
});

test('preview retention ignores correction provenance and validates operational case ownership/reference', () => {
  const start = indexSource.indexOf('const claimExpiredModerationPreview = async');
  const end = indexSource.indexOf('const finalizeExpiredModerationPreviewClaim', start);
  const source = indexSource.slice(start, end);
  assert.ok(source.includes('getOperationalModerationPreviewReviewCaseId(uploadData)'));
  assert.ok(source.includes('isOperationalModerationPreviewReviewCase({'));
  assert.equal(source.includes('correctionReviewCaseId'), false);
});

test('persisted publication has one timestamp rehydration boundary for consent and correction data', () => {
  assert.ok(persistedSource.includes("import { Timestamp } from 'firebase-admin/firestore';"));
  assert.ok(persistedSource.includes('rehydratePersistedPublicationTimestamp'));
  assert.ok(persistedSource.includes("code: 'consent_timestamp_invalid'"));
  assert.ok(persistedSource.includes('PUBLIC_CONSENT_AUDIT_TIMESTAMP_FIELDS'));
  assert.ok(persistedSource.includes('PUBLIC_UPLOAD_CONSENT_TIMESTAMP_FIELDS'));
  assert.ok(persistedSource.includes('PUBLIC_CREDIT_TIMESTAMP_FIELDS'));
  assert.ok(persistedSource.includes('PUBLIC_CORRECTION_TIMESTAMP_FIELDS'));
});
'''
write('tests/moderationPr378P2Source.test.mjs', source_test)

preview_source_path = Path('tests/moderationPreviewStorageSource.test.mjs')
preview_source = read(preview_source_path)
preview_source = replace_once(
    preview_source,
    "  assert.ok(indexSource.includes('Unpersisted moderation preview cleanup failed.'));\n  assert.ok(indexSource.includes(\"document: 'uploads/{uploadId}'\"));",
    "  assert.ok(indexSource.includes(\"mediaState: 'pending'\"));\n  assert.ok(indexSource.includes(\"mediaState: 'cleanup_pending'\"));\n  assert.ok(indexSource.includes(\"mediaState: 'ready'\"));\n  assert.ok(indexSource.includes(\"document: 'uploads/{uploadId}'\"));",
    'preview lifecycle source expectation',
)
write(preview_source_path, preview_source)

# Add focused publication/cache readiness regressions without rewriting unrelated tests.
reuse_test_path = Path('functions/test/moderationReuseRouting.test.js')
reuse_test = read(reuse_test_path)
reuse_test = replace_once(
    reuse_test,
    "test('cache reuse is fenced by the current moderation generation', () => {",
    "test('explicit pending or cleanup media is never reusable as moderation evidence', () => {\n  for (const mediaState of ['pending', 'cleanup_pending', 'deleted']) {\n    assert.equal(isReusableModerationCache({ mediaState, geminiDiagnostics: reusableDiagnostics }, 'gemini_moderation_v2'), false);\n  }\n  assert.equal(isReusableModerationCache({ mediaState: 'ready', geminiDiagnostics: reusableDiagnostics }, 'gemini_moderation_v2'), true);\n  assert.equal(isReusableModerationCache({ geminiDiagnostics: reusableDiagnostics }, 'gemini_moderation_v2'), true, 'legacy cache without mediaState remains compatible');\n});\n\ntest('cache reuse is fenced by the current moderation generation', () => {",
    'reuse media-state regression',
)
write(reuse_test_path, reuse_test)

policy_test_path = Path('functions/test/userModerationActionPolicy.test.js')
policy_test = read(policy_test_path)
policy_test = replace_once(
    policy_test,
    "test('publishNow is denied when requiresUploaderAcceptance is true', () => {",
    "test('explicit moderation media must be ready before publication', () => {\n  for (const mediaState of ['pending', 'cleanup_pending', 'deleted']) {\n    assert.equal(canPublishUpload({ ...safeAllowedState, mediaState }), false);\n  }\n  assert.equal(canPublishUpload({ ...safeAllowedState, mediaState: 'ready' }), true);\n  assert.equal(canPublishUpload(safeAllowedState), true, 'legacy uploads without mediaState remain compatible');\n});\n\ntest('publishNow is denied when requiresUploaderAcceptance is true', () => {",
    'publication media-state regression',
)
write(policy_test_path, policy_test)

# Architecture doc belongs to #380 now, not the already-merged policy-only branch.
doc_path = Path('docs/moderation-state-machine.md')
doc = read(doc_path)
doc = replace_once(
    doc,
    'Status: canonical implementation contract for the moderation-policy-v2 branch.',
    'Status: canonical implementation contract for the moderation architecture simplification PR.',
    'architecture doc status',
)
write(doc_path, doc)

# Hard postconditions: no branch-only cleanup task mechanism and no storage-first regression.
for path in ['functions/index.js', 'functions/moderationPreviewStorage.js', 'firestore.rules', 'tests/moderationPr378P2Source.test.mjs']:
    if 'moderationPreviewCleanupTasks' in read(path):
        raise AssertionError(f'parallel cleanup task state remains in {path}')

index = read('functions/index.js')
moderate_start = index.index("const uploadRef = db.collection('uploads').doc();")
moderate_end = index.index('if (reviewCaseId && uploadId)', moderate_start)
moderate = index[moderate_start:moderate_end]
if moderate.index('transaction.create(uploadRef, {') > moderate.index('persistedPreview = await persistModerationPreview({'):
    raise AssertionError('Storage is touched before durable upload anchor')
if "mediaState: 'ready'" not in moderate:
    raise AssertionError('successful upload does not finalize mediaState=ready')

print('media anchor refactor applied')
