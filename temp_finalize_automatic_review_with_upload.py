from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text, start_marker, end_marker, replacement, label, start_at=0):
    start = text.find(start_marker, start_at)
    if start < 0:
        raise AssertionError(f'{label}: start marker not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise AssertionError(f'{label}: end marker not found')
    return text[:start] + replacement + text[end:]


index_path = Path('functions/index.js')
index = index_path.read_text(encoding='utf-8')

old_import = "import { findBestReusableAcrossPages, findFirstUploadReviewCaseAcrossPages, findReusableAcrossPages, isUploadReviewCaseData, resolveCachedReviewCaseIdForUploader, reviewCaseMatchesFingerprint, reviewCaseReferencesUpload, selectNearReusableUpload, shouldCreateProductionReviewCase } from './uploadReuseIsolation.js';"
new_import = "import { findBestReusableAcrossPages, findFirstUploadReviewCaseAcrossPages, findReusableAcrossPages, isUploadReviewCaseData, resolveCachedReviewCaseIdForUploader, reviewCaseMatchesCurrentUploadEvidence, reviewCaseMatchesFingerprint, reviewCaseReferencesUpload, selectNearReusableUpload, shouldCreateProductionReviewCase } from './uploadReuseIsolation.js';"
index = replace_once(index, old_import, new_import, 'upload reuse import')

transactional_lookup = r'''
const findOpenReviewCaseInTransaction = async ({
  transaction,
  userId,
  fingerprints,
  matchedUploadId = null,
} = {}) => {
  if (!transaction || !userId) return null;
  const doc = await findFirstUploadReviewCaseAcrossPages({
    fetchPage: async (cursor) => {
      let query = db
        .collection('reviewCases')
        .where('userId', '==', userId)
        .where('status', '==', 'inReview')
        .limit(20);
      if (cursor) query = query.startAfter(cursor);
      return (await transaction.get(query)).docs;
    },
  });
  if (!doc) return null;
  const data = doc.data() || {};
  const matchesCurrentUpload = await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData: data,
    fingerprints,
    matchedUploadId,
    expectedOwnerUid: userId,
    distanceBetween: hammingDistance,
    threshold: dhashThreshold,
    loadUpload: async (linkedUploadId) => {
      const normalizedUploadId = String(linkedUploadId || '').trim();
      if (!normalizedUploadId || normalizedUploadId.includes('/')) return null;
      const linkedUploadSnap = await transaction.get(db.collection('uploads').doc(normalizedUploadId));
      return linkedUploadSnap.exists ? (linkedUploadSnap.data() || {}) : null;
    },
  });
  return {
    id: doc.id,
    ref: doc.ref,
    data,
    matchesCurrentUpload,
  };
};
'''
lookup_marker = "\nconst findExactUpload = async"
if index.count(lookup_marker) != 1:
    raise AssertionError('transactional open-review lookup insertion marker is not unique')
index = index.replace(lookup_marker, f"\n{transactional_lookup}\nconst findExactUpload = async", 1)

review_block_start = "  let reviewCaseId = policyResult.reviewCaseId;\n"
review_block_end = "  const previousModeratorExample = policyResult.previousModeratorExample;\n"
new_review_block = r'''  let reviewCaseId = null;
  let uploadId = null;
  let canRequestReview = false;
  let openReviewCase = null;
  let inCooldown = false;
  let reviewCreated = false;
  let hasReviewRights = true;
  let reviewCapacityAvailable = true;
  const policyRequiresReview = policyResult.shouldReview || policyResult.outcome === 'review';
  const routedFinalModeratorRejection = policyResult.previousModeratorExample?.routingApplied === true
    && ['rejectForbidden', 'reject'].includes(String(policyResult.previousModeratorExample?.action || ''));
  const shouldFinalizeAutomaticReview = Boolean(
    userId
    && !routedFinalModeratorRejection
    && shouldCreateProductionReviewCase({
      isCodexActor,
      forbiddenReasons: finalForbiddenReasons,
      shouldReview: policyRequiresReview,
    })
  );
  const automaticReviewRef = shouldFinalizeAutomaticReview
    ? db.collection('reviewCases').doc()
    : null;
  const automaticReviewUserModerationRef = shouldFinalizeAutomaticReview
    ? db.collection('userModeration').doc(userId)
    : null;
  const matchedUploadOwnerUid = String(
    matchedUpload?.data?.uploaderUid
    || matchedUpload?.data?.userId
    || matchedUpload?.data?.ownerUid
    || matchedUpload?.data?.userUid
    || ''
  ).trim();
  const ownedMatchedUploadId = matchedUpload?.id
    && matchedUploadOwnerUid === String(userId || '').trim()
    ? matchedUpload.id
    : null;

'''
index = replace_between(index, review_block_start, review_block_end, new_review_block, 'pre-finalization automatic review block')

payload_start = index.find("      const uploadPayload = {")
if payload_start < 0:
    raise AssertionError('upload payload start not found')
payload_end = index.find("      let finalizationOutcome = 'pending';", payload_start)
if payload_end < 0:
    raise AssertionError('old finalization marker not found')
payload = index[payload_start:payload_end]
payload = replace_once(
    payload,
    "        moderationState: resolveModerationStateForResult({\n          outcome,\n          shouldReview: effectiveShouldReview,\n          publishBlocked,\n          reviewCaseId,\n          requiresUploaderAcceptance: routedUserCorrection,\n        }),\n",
    "",
    'defer moderation state until finalization',
)
payload = replace_once(payload, "        reviewCaseId: reviewCaseId || null,\n", "", 'defer review case id until finalization')
index = index[:payload_start] + payload + index[payload_end:]

finalization_start = "      let finalizationOutcome = 'pending';\n"
debug_marker = "    if (process.env.NODE_ENV === 'development') {\n"
new_finalization = r'''      let automaticReviewUploaderSnapshot = null;
      if (shouldFinalizeAutomaticReview) {
        try {
          automaticReviewUploaderSnapshot = await getUploaderSnapshotFromPublicProfile(userId, { uid: userId });
        } catch (error) {
          logger.warn('Automatic review uploader snapshot could not be refreshed.', {
            userId,
            error: error?.message || String(error),
          });
        }
      }
      const automaticReviewReason = finalForbiddenReasons.length > 0
        ? 'forbiddenOutcomeAutoReview'
        : 'policyReviewAuto';
      const automaticReviewAiSummary = shouldFinalizeAutomaticReview
        ? buildAiSummary({
            classification,
            shouldReview: effectiveShouldReview,
            forbiddenReasons: finalForbiddenReasons,
            appliedTriggers: finalAppliedTriggers,
            suggestedTriggers: finalSuggestedTriggers,
            moderationSignals: response.moderationSignals,
            userSelectedTaxonomy: response.userSelectedTaxonomy,
            aiSuggestedTaxonomy: response.aiSuggestedTaxonomy,
            aiSafetySignals: response.aiSafetySignals,
            aiVisionLabels: response.aiVisionLabels,
            policyAppliedTriggers: response.policyAppliedTriggers,
            geminiDiagnostics: response.geminiDiagnostics || null,
          })
        : null;

      const finalizationResult = await db.runTransaction(async (transaction) => {
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
          return { outcome: 'suppressed' };
        }
        if (freshModerationScope.generation !== requestModerationGeneration) {
          transaction.set(uploadRef, {
            mediaState: 'cleanup_pending',
            mediaCleanupAfter: Timestamp.fromMillis(Date.now()),
            mediaCleanupReason: 'moderation_generation_superseded',
            moderationState: MODERATION_STATES.superseded,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          return { outcome: 'superseded' };
        }

        let transactionReviewCaseId = null;
        let transactionReviewCreated = false;
        let transactionOpenReviewCase = null;
        let transactionHasReviewRights = true;
        let transactionReviewCapacityAvailable = true;
        let transactionInCooldown = false;

        if (shouldFinalizeAutomaticReview) {
          const freshUserModerationSnap = await transaction.get(automaticReviewUserModerationRef);
          const freshUserModerationData = freshUserModerationSnap.exists
            ? (freshUserModerationSnap.data() || {})
            : {};
          transactionOpenReviewCase = await findOpenReviewCaseInTransaction({
            transaction,
            userId,
            fingerprints,
            matchedUploadId: ownedMatchedUploadId,
          });
          const effectiveOpenReviewCount = transactionOpenReviewCase
            ? Math.max(1, Number(freshUserModerationData.openReviewCount) || 0)
            : freshUserModerationData.openReviewCount;
          const freshReviewAccess = getReviewAccessDecision({
            reviewRightsLevel: freshUserModerationData.reviewRightsLevel,
            openReviewCount: effectiveOpenReviewCount,
            cooldownUntil: resolveTimestamp(freshUserModerationData.cooldownUntil),
          });
          transactionHasReviewRights = freshReviewAccess.hasReviewRights;
          transactionReviewCapacityAvailable = freshReviewAccess.reviewCapacityAvailable
            && !transactionOpenReviewCase;
          transactionInCooldown = freshReviewAccess.inCooldown;

          if (transactionOpenReviewCase && Number(freshUserModerationData.openReviewCount || 0) < 1) {
            transaction.set(automaticReviewUserModerationRef, {
              ...(freshUserModerationSnap.exists ? {} : {
                reviewRightsLevel: 1,
                cooldownUntil: null,
                falseAppealCount: 0,
              }),
              openReviewCount: 1,
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }

          if (transactionOpenReviewCase?.matchesCurrentUpload) {
            transactionReviewCaseId = transactionOpenReviewCase.id;
            transaction.set(transactionOpenReviewCase.ref, {
              linkedUploadIds: FieldValue.arrayUnion(uploadRef.id),
              fingerprints: FieldValue.arrayUnion(fingerprints),
              reviewReason: automaticReviewReason,
              ...(automaticReviewUploaderSnapshot ? { uploaderSnapshot: automaticReviewUploaderSnapshot } : {}),
              aiSummary: automaticReviewAiSummary,
              previousModeratorExample: previousModeratorExample || null,
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          } else if (!transactionOpenReviewCase && freshReviewAccess.allowed) {
            transactionReviewCaseId = automaticReviewRef.id;
            transactionReviewCreated = true;
            transactionReviewCapacityAvailable = false;
            transaction.create(automaticReviewRef, {
              caseType: 'upload',
              userId,
              status: 'inReview',
              decision: null,
              uploadId: uploadRef.id,
              linkedUploadIds: [uploadRef.id],
              fingerprints: [fingerprints],
              reviewReason: automaticReviewReason,
              ...(automaticReviewUploaderSnapshot ? { uploaderSnapshot: automaticReviewUploaderSnapshot } : {}),
              aiSummary: automaticReviewAiSummary,
              previousModeratorExample: previousModeratorExample || null,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
            transaction.set(automaticReviewUserModerationRef, {
              ...(freshUserModerationSnap.exists ? {} : {
                reviewRightsLevel: 1,
                cooldownUntil: null,
                falseAppealCount: 0,
              }),
              openReviewCount: 1,
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }

        transaction.set(uploadRef, {
          ...uploadPayload,
          moderationState: resolveModerationStateForResult({
            outcome,
            shouldReview: effectiveShouldReview,
            publishBlocked,
            reviewCaseId: transactionReviewCaseId,
            requiresUploaderAcceptance: routedUserCorrection,
          }),
          reviewCaseId: transactionReviewCaseId || null,
          ...(transactionReviewCaseId ? { reviewStatus: 'inReview' } : {}),
          mediaState: 'ready',
          mediaCleanupAfter: FieldValue.delete(),
          mediaCleanupReason: FieldValue.delete(),
          mediaCleanupClaimId: FieldValue.delete(),
          mediaCleanupClaimedAt: FieldValue.delete(),
        }, { merge: true });
        return {
          outcome: 'ready',
          reviewCaseId: transactionReviewCaseId,
          reviewCreated: transactionReviewCreated,
          openReviewCaseId: transactionOpenReviewCase?.id || null,
          hasReviewRights: transactionHasReviewRights,
          reviewCapacityAvailable: transactionReviewCapacityAvailable,
          inCooldown: transactionInCooldown,
        };
      });

      const finalizationOutcome = finalizationResult?.outcome || 'pending';
      if (finalizationOutcome === 'ready') {
        uploadId = uploadRef.id;
        reviewCaseId = finalizationResult.reviewCaseId || null;
        reviewCreated = finalizationResult.reviewCreated === true;
        openReviewCase = finalizationResult.openReviewCaseId
          ? { id: finalizationResult.openReviewCaseId }
          : null;
        hasReviewRights = finalizationResult.hasReviewRights !== false;
        reviewCapacityAvailable = finalizationResult.reviewCapacityAvailable !== false;
        inCooldown = finalizationResult.inCooldown === true;
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

'''
finalization_pos = index.find(finalization_start, payload_start)
if finalization_pos < 0:
    raise AssertionError('finalization start not found after upload payload')
debug_pos = index.find(debug_marker, finalization_pos)
if debug_pos < 0:
    raise AssertionError('development debug marker not found after finalization')
index = index[:finalization_pos] + new_finalization + index[debug_pos:]

old_persistence_catch = r'''  } catch (error) {
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
new_persistence_catch = r'''  } catch (error) {
    if (uploadStubCreated && !uploadId) {
      await markModerationPreviewCleanupPending({
        uploadRef,
        reason: error?.code || 'upload_finalization_failed',
      });
    }
    if (error?.code === 'fresh_evaluation_superseded_during_request') throw error;
    logger.error('Upload opslaan mislukt.', error);
    const durablePersistenceError = new Error('Moderation result could not be durably persisted');
    durablePersistenceError.status = Number(error?.status) >= 400 && Number(error?.status) < 600
      ? Number(error.status)
      : 500;
    durablePersistenceError.code = error?.code || 'moderation_upload_persistence_failed';
    throw durablePersistenceError;
  }
'''
index = replace_once(index, old_persistence_catch, new_persistence_catch, 'durable persistence failure propagation')

link_block_start = "  if (reviewCaseId && uploadId) {\n"
link_block_end = "  response.uploadId = uploadId;\n"
link_start = index.find(link_block_start, index.find('export const moderateImage'))
if link_start < 0:
    raise AssertionError('post-finalization review linking block not found')
link_end = index.find(link_block_end, link_start)
if link_end < 0:
    raise AssertionError('response upload marker not found after review linking block')
response_refresh = r'''  canRequestReview = Boolean(uploadId)
    && !isCodexActor
    && !routedFinalModeratorRejection
    && (finalForbiddenReasons.length > 0 || policyRequiresReview)
    && hasReviewRights
    && reviewCapacityAvailable
    && !inCooldown
    && !openReviewCase
    && !reviewCreated;
  response.canRequestReview = canRequestReview;
  response.reviewCaseId = reviewCaseId;

'''
index = index[:link_start] + response_refresh + index[link_end:]

index_path.write_text(index, encoding='utf-8')

reuse_path = Path('functions/uploadReuseIsolation.js')
reuse = reuse_path.read_text(encoding='utf-8')
helper_marker = "\nexport const selectExactReusableUpload ="
if reuse.count(helper_marker) != 1:
    raise AssertionError('review evidence helper insertion marker is not unique')
review_evidence_helper = r'''
export const reviewCaseMatchesCurrentUploadEvidence = async ({
  reviewCaseData = {},
  fingerprints = {},
  matchedUploadId = null,
  expectedOwnerUid = null,
  distanceBetween = null,
  threshold = 0,
  loadUpload = null,
} = {}) => {
  const expectedOwner = String(expectedOwnerUid || '').trim();
  const reviewCaseOwner = String(reviewCaseData?.userId || '').trim();
  if (expectedOwner && reviewCaseOwner !== expectedOwner) return false;
  if (reviewCaseMatchesFingerprint({ reviewCaseData, fingerprints, distanceBetween, threshold })) return true;
  if (matchedUploadId && reviewCaseReferencesUpload({ reviewCaseData, uploadId: matchedUploadId })) return true;
  if (typeof loadUpload !== 'function') return false;

  const linkedUploadIds = [...new Set([
    reviewCaseData?.uploadId,
    ...(Array.isArray(reviewCaseData?.linkedUploadIds) ? reviewCaseData.linkedUploadIds : []),
  ].map((value) => String(value || '').trim()).filter((value) => value && !value.includes('/')))].slice(0, 10);

  for (const linkedUploadId of linkedUploadIds) {
    const linkedUpload = await loadUpload(linkedUploadId);
    if (!linkedUpload || typeof linkedUpload !== 'object') continue;
    const linkedOwner = String(
      linkedUpload?.uploaderUid
      || linkedUpload?.userId
      || linkedUpload?.ownerUid
      || linkedUpload?.userUid
      || ''
    ).trim();
    if (expectedOwner && linkedOwner !== expectedOwner) continue;
    if (reviewCaseMatchesFingerprint({
      reviewCaseData: { fingerprints: [linkedUpload?.fingerprints] },
      fingerprints,
      distanceBetween,
      threshold,
    })) return true;
  }
  return false;
};
'''
reuse = reuse.replace(helper_marker, f"\n{review_evidence_helper}\nexport const selectExactReusableUpload =", 1)
reuse_path.write_text(reuse, encoding='utf-8')

reuse_test_path = Path('functions/test/uploadReuseIsolation.test.js')
reuse_test = reuse_test_path.read_text(encoding='utf-8')
old_test_import = "import { findBestReusableAcrossPages, findFirstUploadReviewCaseAcrossPages, findReusableAcrossPages, isUploadReviewCaseData, resolveCachedReviewCaseIdForUploader, reviewCaseMatchesFingerprint, reviewCaseReferencesUpload, shouldCreateProductionReviewCase } from '../uploadReuseIsolation.js';"
new_test_import = "import { findBestReusableAcrossPages, findFirstUploadReviewCaseAcrossPages, findReusableAcrossPages, isUploadReviewCaseData, resolveCachedReviewCaseIdForUploader, reviewCaseMatchesCurrentUploadEvidence, reviewCaseMatchesFingerprint, reviewCaseReferencesUpload, shouldCreateProductionReviewCase } from '../uploadReuseIsolation.js';"
reuse_test = replace_once(reuse_test, old_test_import, new_test_import, 'upload reuse test import')
insert_test_marker = "\ntest('exact cache pagination skips unusable candidates and continues to a valid cache', async () => {"
if reuse_test.count(insert_test_marker) != 1:
    raise AssertionError('upload reuse test insertion marker is not unique')
new_reuse_tests = r'''

test('current-upload review evidence requires the expected review-case owner', async () => {
  const fingerprints = { sha256: 'sha-a', dhash: '0000', dhashPrefix: '0000' };
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData: { userId: 'uploader-a', fingerprints: [fingerprints] },
    fingerprints,
    expectedOwnerUid: 'uploader-a',
  }), true);
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData: { userId: 'uploader-b', fingerprints: [fingerprints] },
    fingerprints,
    expectedOwnerUid: 'uploader-a',
  }), false);
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData: { fingerprints: [fingerprints] },
    fingerprints,
    expectedOwnerUid: 'uploader-a',
  }), false);
});

test('legacy linked-upload fallback only trusts same-owner fingerprint evidence', async () => {
  const current = { sha256: 'sha-current', dhash: '0002', dhashPrefix: '0000' };
  const linked = { fingerprints: { sha256: 'other', dhash: '0001', dhashPrefix: '0000' } };
  const reviewCaseData = { userId: 'uploader-a', linkedUploadIds: ['linked-a'] };
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData,
    fingerprints: current,
    expectedOwnerUid: 'uploader-a',
    distanceBetween: () => 1,
    threshold: 8,
    loadUpload: async () => ({ ...linked, userId: 'uploader-a' }),
  }), true);
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData,
    fingerprints: current,
    expectedOwnerUid: 'uploader-a',
    distanceBetween: () => 1,
    threshold: 8,
    loadUpload: async () => ({ ...linked, userId: 'uploader-b' }),
  }), false);
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData,
    fingerprints: current,
    expectedOwnerUid: 'uploader-a',
    distanceBetween: () => 1,
    threshold: 8,
    loadUpload: async () => linked,
  }), false);
});

test('owned matched-upload references can recover a fingerprintless open review case', async () => {
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData: { userId: 'uploader-a', uploadId: 'upload-a' },
    fingerprints: { sha256: 'new' },
    matchedUploadId: 'upload-a',
    expectedOwnerUid: 'uploader-a',
  }), true);
  assert.equal(await reviewCaseMatchesCurrentUploadEvidence({
    reviewCaseData: { userId: 'uploader-a', uploadId: 'upload-a' },
    fingerprints: { sha256: 'new' },
    matchedUploadId: null,
    expectedOwnerUid: 'uploader-a',
  }), false);
});
'''
reuse_test = reuse_test.replace(insert_test_marker, new_reuse_tests + insert_test_marker, 1)
reuse_test_path.write_text(reuse_test, encoding='utf-8')

integration_path = Path('tests/moderationV2IntegrationSource.test.mjs')
integration = integration_path.read_text(encoding='utf-8')
auto_test_start = "test('automatic review creation rechecks review rights, capacity and cooldown transactionally', () => {\n"
auto_test_end = "\ntest('manual upload review creation enforces quota state in the same transaction', () => {"
new_auto_test = r'''test('automatic review creation is finalized atomically with the durable upload', () => {
  const start = indexSource.indexOf('const finalizationResult = await db.runTransaction');
  assert.notEqual(start, -1);
  const end = indexSource.indexOf("if (finalizationOutcome === 'ready')", start);
  const finalizationSource = indexSource.slice(start, end);
  assert.ok(finalizationSource.includes('freshUserModerationSnap = await transaction.get(automaticReviewUserModerationRef)'));
  assert.ok(finalizationSource.includes('findOpenReviewCaseInTransaction({'));
  assert.ok(finalizationSource.includes('const freshReviewAccess = getReviewAccessDecision({'));
  assert.ok(finalizationSource.includes('transaction.create(automaticReviewRef, {'));
  assert.ok(finalizationSource.includes('openReviewCount: 1'));
  assert.ok(finalizationSource.includes('transaction.set(uploadRef, {'));
  assert.ok(finalizationSource.includes('reviewCaseId: transactionReviewCaseId || null'));
});
'''
integration = replace_between(integration, auto_test_start, auto_test_end, new_auto_test, 'automatic review integration source test')
integration_path.write_text(integration, encoding='utf-8')

source_test = r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

const moderateStart = indexSource.indexOf('export const moderateImage');
const moderateEnd = indexSource.indexOf('export const isModerator', moderateStart);
const moderateSource = indexSource.slice(moderateStart, moderateEnd);

test('automatic review cases are never persisted before durable upload finalization', () => {
  const uploadRefIndex = moderateSource.indexOf("const uploadRef = db.collection('uploads').doc()");
  const storageIndex = moderateSource.indexOf('persistModerationPreview({');
  const finalizationIndex = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const reviewCreateIndex = moderateSource.indexOf('transaction.create(automaticReviewRef, {');
  assert.ok(uploadRefIndex >= 0 && uploadRefIndex < storageIndex);
  assert.ok(storageIndex < finalizationIndex);
  assert.ok(finalizationIndex < reviewCreateIndex);
  assert.doesNotMatch(moderateSource.slice(0, finalizationIndex), /transaction\.create\([^\n]*review/i);
});

test('automatic review linkage, quota and ready media commit in the same transaction', () => {
  const start = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const end = moderateSource.indexOf("if (finalizationOutcome === 'ready')", start);
  const body = moderateSource.slice(start, end);
  assert.match(body, /transaction\.create\(automaticReviewRef, \{/);
  assert.match(body, /linkedUploadIds: \[uploadRef\.id\]/);
  assert.match(body, /openReviewCount: 1/);
  assert.match(body, /transaction\.set\(uploadRef, \{/);
  assert.match(body, /mediaState: 'ready'/);
  assert.match(body, /reviewCaseId: transactionReviewCaseId \|\| null/);
});

test('finalization rereads generation, upload anchor, review access and open-case identity before review writes', () => {
  const start = moderateSource.indexOf('const finalizationResult = await db.runTransaction');
  const end = moderateSource.indexOf("if (finalizationOutcome === 'ready')", start);
  const body = moderateSource.slice(start, end);
  const reviewCreate = body.indexOf('transaction.create(automaticReviewRef, {');
  for (const requiredRead of [
    'const uploadSnap = await transaction.get(uploadRef)',
    'readModerationScopeGeneration({ db, fingerprints, transaction })',
    'freshUserModerationSnap = await transaction.get(automaticReviewUserModerationRef)',
    'findOpenReviewCaseInTransaction({',
  ]) {
    const readIndex = body.indexOf(requiredRead);
    assert.ok(readIndex >= 0 && readIndex < reviewCreate, `missing pre-write read: ${requiredRead}`);
  }
  assert.match(body, /freshModerationScope\.generation !== requestModerationGeneration/);
  assert.match(body, /stubMediaState !== 'pending'/);
});

test('fresh open review lookup is transactional, paginated and upload-case-only', () => {
  const start = indexSource.indexOf('const findOpenReviewCaseInTransaction = async');
  const end = indexSource.indexOf('const findExactUpload = async', start);
  const body = indexSource.slice(start, end);
  assert.match(body, /findFirstUploadReviewCaseAcrossPages/);
  assert.match(body, /await transaction\.get\(query\)/);
  assert.match(body, /reviewCaseMatchesCurrentUploadEvidence/);
  assert.match(body, /expectedOwnerUid: userId/);
  assert.match(body, /linkedUploadSnap = await transaction\.get/);
});

test('storage or finalization failure is surfaced and leaves cleanup on the upload anchor', () => {
  assert.match(moderateSource, /reason: 'storage_write_failed'/);
  assert.match(moderateSource, /reason: error\?\.code \|\| 'upload_finalization_failed'/);
  assert.match(moderateSource, /const durablePersistenceError = new Error/);
  assert.match(moderateSource, /throw durablePersistenceError/);
});

test('there is no post-finalization best-effort review-case linking path', () => {
  assert.doesNotMatch(moderateSource, /if \(reviewCaseId && uploadId\)/);
  assert.doesNotMatch(moderateSource, /Review case koppelen mislukt/);
  assert.match(moderateSource, /response\.reviewCaseId = reviewCaseId/);
  assert.match(moderateSource, /response\.canRequestReview = canRequestReview/);
});
'''
Path('tests/moderationAutomaticReviewFinalizationSource.test.mjs').write_text(source_test, encoding='utf-8')

print('atomic automatic review finalization refactor applied')
