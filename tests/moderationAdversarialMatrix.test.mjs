import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import {
  isModerationGenerationCurrent,
  collectModerationFingerprintEntries,
  collectModerationScopeKeys,
  planModerationScopeGenerationIncrement,
} from '../functions/moderationGeneration.js';
import {
  isModerationExampleGenerationRouteable,
  isNearDuplicateReuseOwnedByUploader,
  isReusableModerationCache,
} from '../functions/moderationReuseRouting.js';
import {
  getModerationPendingMediaCleanupDecision,
  getOperationalModerationPreviewReviewCaseId,
} from '../functions/moderationPreviewStorage.js';
import { resolveCorrectionReviewReopenPlan } from '../functions/correctionReviewOwnership.js';
import { rehydratePersistedPublicationTimestamp } from '../functions/persistedPublication.js';
import { validateModerationPublicationAuthorProfile } from '../functions/moderationPublicationAuthor.js';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');

const reusableDiagnostics = {
  promptVersion: 'gemini_moderation_v2',
  success: true,
  contractValidated: true,
  fallbackUsed: false,
  safetyBlocked: false,
};

const reusableCache = (generation, userId = 'uploader-a') => ({
  moderationGeneration: generation,
  userId,
  mediaState: 'ready',
  geminiDiagnostics: reusableDiagnostics,
});

test('adversarial cache matrix is fenced by one generation for exact and same-uploader near reuse', () => {
  const beforeQueue = reusableCache(0, 'uploader-a');
  assert.equal(isReusableModerationCache(beforeQueue, 'gemini_moderation_v2', 0), true);
  assert.equal(isReusableModerationCache(beforeQueue, 'gemini_moderation_v2', 1), false);

  const exactStart = indexSource.indexOf('const findExactUpload = async');
  const exactEnd = indexSource.indexOf('const findNearDuplicateUpload = async', exactStart);
  const exactSource = indexSource.slice(exactStart, exactEnd);
  assert.match(exactSource, /where\('fingerprints\.sha256', '==', sha256\)/);
  assert.doesNotMatch(exactSource, /isNearDuplicateReuseOwnedByUploader/,
    'exact SHA reuse is intentionally global and therefore covers cross-uploader exact reuse');

  assert.equal(isNearDuplicateReuseOwnedByUploader({ uploadData: beforeQueue, userId: 'uploader-a' }), true);
  assert.equal(isNearDuplicateReuseOwnedByUploader({ uploadData: beforeQueue, userId: 'uploader-b' }), false);
  assert.equal(
    isNearDuplicateReuseOwnedByUploader({ uploadData: beforeQueue, userId: 'uploader-a' })
      && isReusableModerationCache(beforeQueue, 'gemini_moderation_v2', 0),
    true,
  );
  assert.equal(
    isNearDuplicateReuseOwnedByUploader({ uploadData: beforeQueue, userId: 'uploader-a' })
      && isReusableModerationCache(beforeQueue, 'gemini_moderation_v2', 1),
    false,
  );
});

test('old evidence, in-flight requests and repeated requeues obey the same monotone generation barrier', () => {
  assert.equal(isModerationExampleGenerationRouteable({ moderationGeneration: 0 }, 0), true);
  assert.equal(isModerationExampleGenerationRouteable({ moderationGeneration: 0 }, 1), false,
    'old moderator example cannot win after queue');
  assert.equal(isModerationExampleGenerationRouteable({ moderationGeneration: 1 }, 1), true,
    'new moderator evidence at the fresh generation can route');

  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: 0, currentGeneration: 1 }), false,
    'a request started before a queue cannot finalize after that queue');

  const firstQueue = planModerationScopeGenerationIncrement({
    scopeKeys: ['abcd'],
    currentGenerations: { abcd: 0 },
  });
  const secondQueue = planModerationScopeGenerationIncrement({
    scopeKeys: ['abcd'],
    currentGenerations: firstQueue,
  });
  assert.deepEqual(firstQueue, { abcd: 1 });
  assert.deepEqual(secondQueue, { abcd: 2 });
  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: 0, currentGeneration: secondQueue.abcd }), false);

  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: 2, currentGeneration: 2 }), true);
  assert.equal(isModerationGenerationCurrent({ evidenceGeneration: 2, currentGeneration: 2 }), true,
    'two concurrent evaluations at the same generation can both remain valid; no lease is required');
  assert.doesNotMatch(indexSource, /reserveFreshEvaluationOverride|reservationExpiresAtMs|freshEvaluationReservationMs/);
});

test('publication racing a queue rechecks generation inside the authoritative publication transaction', () => {
  const actionStart = indexSource.indexOf('export const userModerationAction');
  const actionEnd = indexSource.indexOf('export const moderatorDecide', actionStart);
  const actionSource = indexSource.slice(actionStart, actionEnd);
  const mutationStart = actionSource.indexOf('runUserModerationActionMutation({');
  const generationRead = actionSource.indexOf('readModerationScopeGeneration({', mutationStart);
  const generationGuard = actionSource.indexOf('isModerationGenerationCurrent({', generationRead);
  const staleError = actionSource.indexOf("error.code = 'moderation_generation_stale'", generationGuard);
  assert.ok(mutationStart >= 0 && mutationStart < generationRead && generationRead < generationGuard && generationGuard < staleError);
  assert.match(actionSource.slice(generationRead, staleError), /transaction,/,
    'publication reads the generation through the same Firestore transaction that performs the mutation');
});

test('fingerprint recovery covers deleted selections, linked uploads, multiple prefixes and conservative prefix collisions', () => {
  const recovered = collectModerationFingerprintEntries(
    {
      fingerprints: [
        { dhash: 'abcd000000000001', dhashPrefix: 'abcd' },
        { dhash: '1234000000000002', dhashPrefix: '1234' },
      ],
    },
    null,
    { fingerprints: { dhash: 'beef000000000003', dhashPrefix: 'beef' } },
  );
  assert.deepEqual(collectModerationScopeKeys(recovered), ['1234', 'abcd', 'beef']);

  const collisionScopes = collectModerationScopeKeys([
    { dhash: 'abcd000000000000', dhashPrefix: 'abcd' },
    { dhash: 'abcdffffffffffff', dhashPrefix: 'abcd' },
  ]);
  assert.deepEqual(collisionScopes, ['abcd']);
  assert.deepEqual(planModerationScopeGenerationIncrement({
    scopeKeys: collisionScopes,
    currentGenerations: { abcd: 4 },
  }), { abcd: 5 }, 'same-prefix collision deliberately causes conservative extra reevaluation');

  assert.deepEqual(collectModerationScopeKeys(collectModerationFingerprintEntries({ uploadId: 'deleted-without-evidence' })), []);
  assert.deepEqual(planModerationScopeGenerationIncrement({ scopeKeys: [], currentGenerations: {} }), {});
  assert.match(indexSource, /const nextStatus = hasScopes \? 'freshEvalQueued' : 'closedNoFingerprint'/);
  assert.match(indexSource, /queueFreshEvaluationMode: hasScopes \? 'moderationGeneration' : 'closeOnlyNoFingerprint'/);
});

test('durable media ordering surfaces Storage/finalization failures and scheduled cleanup handles abandoned anchors', () => {
  const moderateStart = indexSource.indexOf('export const moderateImage');
  const moderateEnd = indexSource.indexOf('export const isModerator', moderateStart);
  const moderateSource = indexSource.slice(moderateStart, moderateEnd);
  const anchor = moderateSource.indexOf("const uploadRef = db.collection('uploads').doc()");
  const storage = moderateSource.indexOf('persistModerationPreview({', anchor);
  const finalization = moderateSource.indexOf('const finalizationResult = await db.runTransaction', storage);
  assert.ok(anchor >= 0 && anchor < storage && storage < finalization);
  assert.match(moderateSource, /reason: 'storage_write_failed'/);
  assert.match(moderateSource, /reason: error\?\.code \|\| 'upload_finalization_failed'/);

  assert.deepEqual(getModerationPendingMediaCleanupDecision({
    uploadId: 'upload-a',
    nowMs: 10_000,
    uploadData: {
      userId: 'u1',
      storagePath: 'moderation-previews/u1/upload-a.jpg',
      imageRef: 'moderation-previews/u1/upload-a.jpg',
      mediaState: 'pending',
      mediaCleanupAfter: 9_000,
    },
  }), {
    action: 'cleanup',
    reason: 'pending_upload_abandoned',
    storagePath: 'moderation-previews/u1/upload-a.jpg',
  });
  assert.match(indexSource, /export const cleanupPendingModerationMedia = onSchedule\(\{/);
});

test('correction provenance stays separate from operational preview-retention authority', () => {
  const routed = resolveCorrectionReviewReopenPlan({
    upload: {
      correctionReviewCaseId: 'source-case',
      correctionReviewCaseOwnerUid: 'source-user',
    },
    userId: 'routed-user',
    newReviewCaseId: 'fresh-case',
  });
  assert.equal(routed.sourceReviewCaseId, 'source-case');
  assert.equal(routed.targetReviewCaseId, 'fresh-case');
  assert.equal(routed.createNewReviewCase, true);
  assert.equal(getOperationalModerationPreviewReviewCaseId({
    correctionReviewCaseId: 'source-case',
    correctionReviewCaseOwnerUid: 'source-user',
  }), null, 'correction provenance alone cannot retain unrelated preview media as an operational case');
});

test('JSON consent timestamps and managed-profile publication stay on the persisted server trust path', () => {
  const transported = {
    type: 'firestore/timestamp/1.0',
    seconds: 1_700_000_000,
    nanoseconds: 123,
  };
  assert.equal(rehydratePersistedPublicationTimestamp(transported) instanceof Timestamp, true);

  const author = validateModerationPublicationAuthorProfile({
    userId: 'owner-a',
    requestedProfileId: 'company-a',
    profileExists: true,
    profileData: {
      ownerUid: 'owner-a',
      type: 'company',
      status: 'active',
      displayName: 'Company A',
    },
  });
  assert.equal(author.ok, true);
  assert.equal(author.author.profileId, 'company-a');
  assert.equal(author.author.ownerUid, 'owner-a');
  assert.equal(author.author.isPersonal, false);

  const actionStart = indexSource.indexOf('export const userModerationAction');
  const actionEnd = indexSource.indexOf('export const moderatorDecide', actionStart);
  const actionSource = indexSource.slice(actionStart, actionEnd);
  assert.match(actionSource, /requestedAuthorProfileId/);
  assert.match(actionSource, /resolveAuthorProfileForUid\(userId, requestedAuthorProfileId\)/);
  assert.match(actionSource, /publicationAuthorProfileRef/);
});

test('draft, resume and correction publication converge on the persisted userModerationAction route', () => {
  const actionStart = indexSource.indexOf('export const userModerationAction');
  const actionEnd = indexSource.indexOf('export const moderatorDecide', actionStart);
  const actionSource = indexSource.slice(actionStart, actionEnd);
  assert.match(actionSource, /action === 'saveDraft'/);
  assert.match(actionSource, /action === 'acceptCorrection'/);
  assert.match(actionSource, /action === 'rejectCorrection'/);
  assert.match(actionSource, /action === 'publishNow' \|\| action === 'repairPublished'/);

  assert.match(clientSource, /resolvePersistedModerationPublicationUploadId/);
  assert.match(clientSource, /action:\s*'repairPublished'/);
  assert.match(clientSource, /codexDevPublication \? null : resolvePersistedModerationPublicationUploadId/);
  const directPublish = clientSource.indexOf('await publishPost(');
  const persistedRoute = clientSource.indexOf("action: 'repairPublished'");
  assert.ok(persistedRoute >= 0 && directPublish > persistedRoute,
    'ordinary production publication attempts the persisted server route before the isolated Codex-only direct fallback');
});
