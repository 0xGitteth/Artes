from pathlib import Path
import re

path = Path('functions/index.js')
source = path.read_text()
original = source


def replace_once(old, new, label):
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, found {count}')
    source = source.replace(old, new, 1)


def sub_once(pattern, replacement, label, flags=0):
    global source
    source, count = re.subn(pattern, replacement, source, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, found {count}')


old_reuse_import = "import { buildReusableCacheGeminiDiagnostics, canRouteNearDuplicateModerationExampleAction, compareModerationExampleCandidates, hasMatchingReusableModerationTaxonomy, isFinalModerationExampleAction, isNearDuplicateReuseOwnedByUploader, isReusableModerationCache, isUploadModerationExampleData } from './moderationReuseRouting.js';"
new_reuse_import = """import {
  buildReusableCacheGeminiDiagnostics,
  canRouteNearDuplicateModerationExampleAction,
  compareModerationExampleCandidates,
  hasMatchingReusableModerationTaxonomy,
  isFinalModerationExampleAction,
  isModerationExampleGenerationRouteable,
  isNearDuplicateReuseOwnedByUploader,
  isReusableModerationCache,
  isUploadModerationExampleData,
} from './moderationReuseRouting.js';
import {
  collectModerationFingerprintEntries,
  collectModerationScopeKeys,
  isModerationGenerationCurrent,
  normalizeModerationGeneration,
  planModerationScopeGenerationIncrement,
  resolveModerationScopeKey,
} from './moderationGeneration.js';
import {
  getModerationFreshScopeRef,
  readModerationScopeGeneration,
} from './moderationGenerationStore.js';"""
replace_once(old_reuse_import, new_reuse_import, 'generation imports')

replace_once(
    "const freshEvaluationReservationMs = Number.parseInt(process.env.FRESH_EVAL_RESERVATION_MS || '120000', 10);\n",
    '',
    'remove reservation constant',
)

replace_once(
    "const findExactUpload = async (sha256, { isCodexActor = false, themes = [], makerTags = [] } = {}) => (",
    "const findExactUpload = async (sha256, { isCodexActor = false, themes = [], makerTags = [], currentGeneration = 0 } = {}) => (",
    'exact upload signature',
)
replace_once(
    "const findExactModerationExample = async (sha256) => {",
    "const findExactModerationExample = async (sha256, currentGeneration = 0) => {",
    'exact example signature',
)
replace_once(
    "      if (!isUploadModerationExampleData(candidate.data)) return;\n      if (!best || compareModerationExampleCandidates(candidate, best) < 0) best = candidate;",
    "      if (!isUploadModerationExampleData(candidate.data)) return;\n      if (!isModerationExampleGenerationRouteable(candidate.data, currentGeneration)) return;\n      if (!best || compareModerationExampleCandidates(candidate, best) < 0) best = candidate;",
    'example generation filter',
)
replace_once(
    "const findNearDuplicateUpload = async ({ dhash, dhashPrefix }, { isCodexActor = false, themes = [], makerTags = [], userId = null } = {}) => {",
    "const findNearDuplicateUpload = async ({ dhash, dhashPrefix }, { isCodexActor = false, themes = [], makerTags = [], userId = null, currentGeneration = 0 } = {}) => {",
    'near upload signature',
)

# Both upload-cache paths now share the same generation fence.
count = source.count("isReusableModerationCache(uploadData, GEMINI_MODERATION_PROMPT_VERSION)")
if count != 2:
    raise SystemExit(f'cache generation fence: expected 2 matches, found {count}')
source = source.replace(
    "isReusableModerationCache(uploadData, GEMINI_MODERATION_PROMPT_VERSION)",
    "isReusableModerationCache(uploadData, GEMINI_MODERATION_PROMPT_VERSION, currentGeneration)",
)

sub_once(
    r"\nconst matchesFingerprintEntry = \(fingerprints, candidate\) => \{.*?\nconst extractLabelScore =",
    "\nconst extractLabelScore =",
    'remove legacy override state machine',
    flags=re.S,
)

sub_once(
    r"  let overrideReservation = null;\n  try \{\n    overrideReservation = await reserveFreshEvaluationOverride\(\{\n      userModerationRef: userModeration\?\.ref,\n      fingerprints,\n    \}\);\n  \} catch \(error\) \{\n    logger\.error\('Fresh evaluation override reserve mislukt\.', error\);\n  \}\n  const skipUploadReuse = Boolean\(overrideReservation\);",
    """  let requestModerationScope = null;
  try {
    requestModerationScope = await readModerationScopeGeneration({ db, fingerprints });
  } catch (error) {
    logger.error('Moderation generation ophalen mislukt.', error);
    res.status(503).json({ error: 'Moderation generation is unavailable.' });
    return;
  }
  if (!requestModerationScope?.scopeKey) {
    res.status(500).json({ error: 'Moderation fingerprint scope is unavailable.' });
    return;
  }
  const requestModerationGeneration = normalizeModerationGeneration(requestModerationScope.generation);""",
    'replace request reservation with generation read',
)

replace_once(
    "    matchedModerationExample = isCodexActor ? null : await findExactModerationExample(fingerprints.sha256);",
    "    matchedModerationExample = isCodexActor ? null : await findExactModerationExample(fingerprints.sha256, requestModerationGeneration);",
    'initial example lookup',
)

old_reuse_block = """    if (!skipUploadReuse) {
      matchedUpload = await findExactUpload(fingerprints.sha256, { isCodexActor, themes: normalizedThemes, makerTags: normalizedMakerTags });
      if (matchedUpload) {
        matchedFingerprintType = 'sha256';
      }
      if (!matchedUpload) {
        matchedUpload = await findNearDuplicateUpload(fingerprints, { isCodexActor, themes: normalizedThemes, makerTags: normalizedMakerTags, userId });
        if (matchedUpload) {
          matchedFingerprintType = 'dhash';
        }
      }
    }"""
new_reuse_block = """    matchedUpload = await findExactUpload(fingerprints.sha256, {
      isCodexActor,
      themes: normalizedThemes,
      makerTags: normalizedMakerTags,
      currentGeneration: requestModerationGeneration,
    });
    if (matchedUpload) {
      matchedFingerprintType = 'sha256';
    }
    if (!matchedUpload) {
      matchedUpload = await findNearDuplicateUpload(fingerprints, {
        isCodexActor,
        themes: normalizedThemes,
        makerTags: normalizedMakerTags,
        userId,
        currentGeneration: requestModerationGeneration,
      });
      if (matchedUpload) {
        matchedFingerprintType = 'dhash';
      }
    }"""
replace_once(old_reuse_block, new_reuse_block, 'unwrap cache lookup')

replace_once(
    "        matchedModerationExample = await findExactModerationExample(matchedUploadSha);",
    "        matchedModerationExample = await findExactModerationExample(matchedUploadSha, requestModerationGeneration);",
    'near source example lookup',
)
replace_once(
    "    && previousExampleRouteAllowed\n    && !skipUploadReuse;",
    "    && previousExampleRouteAllowed;",
    'remove override routing condition',
)
replace_once(
    "        sourceUploadId: matchedUpload.id,\n      })",
    "        sourceUploadId: matchedUpload.id,\n        currentGeneration: requestModerationGeneration,\n      })",
    'cache diagnostics generation',
)

# A review case created by this request must be fenced by the same scope read.
replace_once(
    "            if (await isKnownCodexDevActorUid({ db, uid: userId, transaction })) return;\n            const freshUserModerationSnap = await transaction.get(userModeration.ref);",
    """            if (await isKnownCodexDevActorUid({ db, uid: userId, transaction })) return;
            const freshModerationScope = await readModerationScopeGeneration({ db, fingerprints, transaction });
            if (freshModerationScope.generation !== requestModerationGeneration) {
              const error = new Error('Fresh evaluation superseded this moderation request');
              error.status = 409;
              error.code = 'fresh_evaluation_superseded_during_request';
              throw error;
            }
            const freshUserModerationSnap = await transaction.get(userModeration.ref);""",
    'review creation generation fence',
)
replace_once(
    "    } catch (error) {\n      logger.error('User moderation check mislukt.', error);\n    }",
    """    } catch (error) {
      if (error?.code === 'fresh_evaluation_superseded_during_request') throw error;
      logger.error('User moderation check mislukt.', error);
    }""",
    'propagate review generation supersede',
)

replace_once(
    "    moderatorCorrectionApplied: Boolean(policyResult.moderatorCorrectionApplied),",
    "    moderationGeneration: requestModerationGeneration,\n    moderationScopeKey: requestModerationScope.scopeKey,\n    moderatorCorrectionApplied: Boolean(policyResult.moderatorCorrectionApplied),",
    'response generation provenance',
)
replace_once(
    "      uploaderUid: userId || null,",
    "      uploaderUid: userId || null,\n      moderationGeneration: requestModerationGeneration,\n      moderationScopeKey: requestModerationScope.scopeKey,",
    'upload generation provenance',
)

replace_once(
    """      if (!isCodexActor && await isKnownCodexDevActorUid({ db, uid: userId, transaction })) {
        uploadSuppressedByHistoricalRegistry = true;
        return;
      }
      transaction.create(uploadRef, uploadPayload);""",
    """      if (!isCodexActor && await isKnownCodexDevActorUid({ db, uid: userId, transaction })) {
        uploadSuppressedByHistoricalRegistry = true;
        return;
      }
      const freshModerationScope = await readModerationScopeGeneration({ db, fingerprints, transaction });
      if (freshModerationScope.generation !== requestModerationGeneration) {
        const error = new Error('Fresh evaluation superseded this moderation request');
        error.status = 409;
        error.code = 'fresh_evaluation_superseded_during_request';
        throw error;
      }
      transaction.create(uploadRef, uploadPayload);""",
    'upload persistence generation fence',
)

replace_once(
    "    logger.error('Upload opslaan mislukt.', error);\n  }",
    """    if (error?.code === 'fresh_evaluation_superseded_during_request') throw error;
    logger.error('Upload opslaan mislukt.', error);
  }""",
    'propagate persistence generation supersede',
)

# Do not attach a now-stale upload to a case if a moderator queued a newer generation after persistence.
replace_once(
    """      await db.runTransaction(async (transaction) => {
        if (await isKnownCodexDevActorUid({ db, uid: userId, transaction })) return;
        transaction.set(db.collection('reviewCases').doc(reviewCaseId),""",
    """      await db.runTransaction(async (transaction) => {
        if (await isKnownCodexDevActorUid({ db, uid: userId, transaction })) return;
        const freshModerationScope = await readModerationScopeGeneration({ db, fingerprints, transaction });
        if (freshModerationScope.generation !== requestModerationGeneration) return;
        transaction.set(db.collection('reviewCases').doc(reviewCaseId),""",
    'review link generation fence',
)

# Replace debug routing and remove one-shot consume/release behavior.
sub_once(
    r"      path: blockedByReport\n        \? 'blockedFingerprint'\n        : skipUploadReuse\n          \? 'freshEvaluationOverrideUsed'\n          : cachedResult && matchedFingerprintType === 'sha256'\n            \? 'exactReuse'\n            : cachedResult && matchedFingerprintType === 'dhash'\n              \? 'nearReuse'\n              : matchedUpload\n                \? 'matchedUploadFreshEvaluation'\n                : 'none',",
    """      path: blockedByReport
        ? 'blockedFingerprint'
        : cachedResult && matchedFingerprintType === 'sha256'
          ? 'exactReuse'
          : cachedResult && matchedFingerprintType === 'dhash'
            ? 'nearReuse'
            : matchedUpload
              ? 'matchedUploadFreshEvaluation'
              : 'freshEvaluation',""",
    'debug routing generation path',
)
replace_once(
    "      geminiDiagnostics,\n    };",
    "      geminiDiagnostics,\n      moderationGeneration: requestModerationGeneration,\n      moderationScopeKey: requestModerationScope.scopeKey,\n    };",
    'debug generation provenance',
)
sub_once(
    r"\n  if \(skipUploadReuse\) \{\n    try \{\n      await consumeFreshEvaluationOverride\(\{.*?\n  \}\n\n  res\.status\(200\)\.json\(response\);\n  \} catch \(error\) \{\n    if \(skipUploadReuse\) \{\n      try \{\n        await releaseFreshEvaluationOverrideReservation\(\{.*?\n    \}\n    logger\.error\('moderateImage fout\.', error\);\n    res\.status\(500\)\.json\(\{ error: 'Moderatie mislukt\.' \}\);",
    """
  res.status(200).json(response);
  } catch (error) {
    logger.error('moderateImage fout.', error);
    const status = Number(error?.status) || 500;
    res.status(status).json({
      error: error?.message || 'Moderatie mislukt.',
      ...(error?.code ? { code: error.code } : {}),
    });""",
    'remove override consume release',
    flags=re.S,
)

new_queue_endpoint = r"""export const moderatorQueueFreshEvaluation = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    await ensureModerator(decoded);
    const body = parseJsonBody(req);
    const uploadIdFromBody = String(body?.uploadId || '').trim();
    const reviewCaseId = String(body?.reviewCaseId || '').trim();
    const reasonCode = String(body?.reasonCode || '').trim();
    if (!reviewCaseId) {
      res.status(400).json({ error: 'reviewCaseId is required' });
      return;
    }
    if (!reasonCode) {
      res.status(400).json({ error: 'reasonCode is required' });
      return;
    }
    if (!MODERATION_EXAMPLE_REASON_CODES.has(reasonCode)
      || !MODERATION_EXAMPLE_REASON_CODES_BY_ACTION.queueFreshEvaluation.has(reasonCode)) {
      res.status(400).json({ error: 'Invalid reasonCode for action queueFreshEvaluation' });
      return;
    }

    const pickString = (...values) => values
      .map((value) => String(value || '').trim())
      .find(Boolean) || '';
    const ownerForUpload = (data = {}) => pickString(data?.userId, data?.uploaderUid, data?.ownerUid, data?.userUid);

    const reviewCaseRef = db.collection('reviewCases').doc(reviewCaseId);
    const initialReviewCaseSnap = await reviewCaseRef.get();
    if (!initialReviewCaseSnap.exists) {
      res.status(404).json({ error: 'Review case not found' });
      return;
    }
    const initialReviewCaseData = initialReviewCaseSnap.data() || {};
    if (!isUploadReviewCaseData(initialReviewCaseData)) {
      res.status(409).json({ error: 'Fresh evaluation requires an upload review case' });
      return;
    }
    const initialReviewCaseUploadIds = resolveReviewCaseUploadIds(initialReviewCaseData);
    if (uploadIdFromBody && initialReviewCaseUploadIds.length > 0 && !initialReviewCaseUploadIds.includes(uploadIdFromBody)) {
      const error = new Error('uploadId does not belong to this review case');
      error.status = 409;
      error.code = 'review_case_upload_mismatch';
      throw error;
    }
    const effectiveUploadId = uploadIdFromBody || initialReviewCaseUploadIds[0] || null;

    let responseUserId = null;
    let responseScopeKeys = [];
    let responseGenerations = {};
    let responseUploadFound = false;
    let responseStatus = 'closedNoFingerprint';

    await db.runTransaction(async (transaction) => {
      const freshReviewCaseSnap = await transaction.get(reviewCaseRef);
      if (!freshReviewCaseSnap.exists) {
        const error = new Error('Review case not found');
        error.status = 404;
        throw error;
      }
      const freshReviewCaseData = freshReviewCaseSnap.data() || {};
      if (!isUploadReviewCaseData(freshReviewCaseData)) {
        const error = new Error('Fresh evaluation requires an upload review case');
        error.status = 409;
        throw error;
      }

      const freshReviewCaseUploadIds = resolveReviewCaseUploadIds(freshReviewCaseData);
      if (uploadIdFromBody && freshReviewCaseUploadIds.length > 0 && !freshReviewCaseUploadIds.includes(uploadIdFromBody)) {
        const error = new Error('Review case upload changed while queuing fresh evaluation');
        error.status = 409;
        error.code = 'review_case_upload_changed';
        throw error;
      }
      const linkedUploadIds = Array.from(new Set([
        ...freshReviewCaseUploadIds,
        ...(uploadIdFromBody ? [uploadIdFromBody] : []),
      ].filter(Boolean)));
      if (linkedUploadIds.length > 25) {
        const error = new Error('Review case has too many linked uploads for atomic fresh evaluation');
        error.status = 409;
        error.code = 'review_case_link_limit';
        throw error;
      }

      const linkedUploadRefs = linkedUploadIds.map((uploadId) => db.collection('uploads').doc(uploadId));
      const linkedUploadSnaps = await Promise.all(linkedUploadRefs.map((ref) => transaction.get(ref)));
      const linkedUploads = linkedUploadSnaps
        .map((snapshot, index) => ({
          id: linkedUploadIds[index],
          ref: linkedUploadRefs[index],
          exists: snapshot.exists,
          data: snapshot.exists ? (snapshot.data() || {}) : {},
        }));

      const freshCaseUserId = pickString(
        freshReviewCaseData?.userId,
        freshReviewCaseData?.uploaderUid,
        freshReviewCaseData?.ownerUid,
        freshReviewCaseData?.uploaderSnapshot?.uid,
        ...linkedUploads.map((item) => ownerForUpload(item.data)),
      );
      for (const linkedUpload of linkedUploads) {
        const linkedOwner = ownerForUpload(linkedUpload.data);
        if (freshCaseUserId && linkedOwner && freshCaseUserId !== linkedOwner) {
          const error = new Error('Review case and upload ownership do not match');
          error.status = 409;
          error.code = 'review_case_upload_owner_mismatch';
          throw error;
        }
      }

      const fingerprintEntries = collectModerationFingerprintEntries(
        freshReviewCaseData,
        freshReviewCaseData?.uploadSnapshot,
        ...linkedUploads.filter((item) => item.exists).map((item) => item.data),
      );
      const scopeKeys = collectModerationScopeKeys(fingerprintEntries);
      if (scopeKeys.length > 25) {
        const error = new Error('Review case spans too many moderation fingerprint scopes');
        error.status = 409;
        error.code = 'moderation_scope_limit';
        throw error;
      }

      const scopeRefs = scopeKeys.map((scopeKey) => getModerationFreshScopeRef({ db, scopeKey }));
      const scopeSnaps = await Promise.all(scopeRefs.map((ref) => transaction.get(ref)));
      const currentGenerations = Object.fromEntries(scopeKeys.map((scopeKey, index) => [
        scopeKey,
        normalizeModerationGeneration(scopeSnaps[index]?.exists ? scopeSnaps[index].data()?.generation : 0),
      ]));
      const nextGenerations = planModerationScopeGenerationIncrement({
        scopeKeys,
        currentGenerations,
      });

      const moderationRef = freshCaseUserId ? db.collection('userModeration').doc(freshCaseUserId) : null;
      const freshModerationSnap = moderationRef ? await transaction.get(moderationRef) : null;
      const freshModerationData = freshModerationSnap?.exists ? (freshModerationSnap.data() || {}) : {};

      // All transaction reads are complete above this line.
      Object.entries(nextGenerations).forEach(([scopeKey, generation]) => {
        const scopeRef = getModerationFreshScopeRef({ db, scopeKey });
        transaction.set(scopeRef, {
          generation,
          scopeKey,
          reviewCaseId,
          reasonCode,
          queuedByUid: decoded.uid,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      const hasScopes = scopeKeys.length > 0;
      const nextStatus = hasScopes ? 'freshEvalQueued' : 'closedNoFingerprint';
      const wasOpenUploadCase = freshReviewCaseData.status === 'inReview';
      if (moderationRef && wasOpenUploadCase) {
        transaction.set(moderationRef, {
          openReviewCount: getOpenReviewCountAfterCaseExit({
            openReviewCount: freshModerationData.openReviewCount,
            wasOpenUploadCase: true,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      transaction.set(reviewCaseRef, {
        status: nextStatus,
        queueExitReason: 'reEvaluateOnNextUpload',
        queuedFreshEvaluationAt: FieldValue.serverTimestamp(),
        queuedFreshEvaluationBy: decoded.uid,
        queuedFreshEvaluationByUid: decoded.uid,
        queueReasonCode: reasonCode,
        fingerprintQueued: hasScopes,
        queueFreshEvaluationMode: hasScopes ? 'moderationGeneration' : 'closeOnlyNoFingerprint',
        moderationScopeGenerations: nextGenerations,
        lock: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      linkedUploads.filter((item) => item.exists).forEach((linkedUpload) => {
        transaction.set(linkedUpload.ref, {
          reviewStatus: nextStatus,
          publicationStatus: nextStatus,
          requiresUploaderAcceptance: false,
          queueExitReason: 'reEvaluateOnNextUpload',
          queuedFreshEvaluationAt: FieldValue.serverTimestamp(),
          queuedFreshEvaluationBy: decoded.uid,
          queuedFreshEvaluationByUid: decoded.uid,
          queueReasonCode: reasonCode,
          previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(),
          queueFreshEvaluationMode: hasScopes ? 'moderationGeneration' : 'closeOnlyNoFingerprint',
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      const primaryUpload = linkedUploads.find((item) => item.id === effectiveUploadId && item.exists)
        || linkedUploads.find((item) => item.exists)
        || null;
      const primaryFingerprints = collectModerationFingerprintEntries(
        primaryUpload?.data,
        freshReviewCaseData,
      )[0] || null;
      const primaryScopeKey = resolveModerationScopeKey(primaryFingerprints || {});
      const primaryGeneration = primaryScopeKey
        ? normalizeModerationGeneration(nextGenerations[primaryScopeKey])
        : 0;
      const queueModerationExampleRef = db.collection('moderationExamples')
        .doc(`${reviewCaseId}_queueFreshEvaluation`);
      const queueExamplePayload = buildCommonModerationExample({
        uploadId: primaryUpload?.id || effectiveUploadId,
        reviewCaseId,
        uploaderUid: freshCaseUserId || null,
        fingerprints: primaryFingerprints,
        uploadData: primaryUpload?.data || {},
        reviewData: freshReviewCaseData,
        aiResult: primaryUpload?.data?.aiResult || freshReviewCaseData?.uploadSnapshot?.aiResult || {},
        moderationSignals: primaryUpload?.data?.moderationSignals || freshReviewCaseData?.uploadSnapshot?.moderationSignals || {},
        correctionSnapshot: primaryUpload?.data?.correction || primaryUpload?.data?.postDraft?.correction || freshReviewCaseData?.uploadSnapshot?.correction || null,
        decision: null,
        policyDecisionOutcome: 'review',
        moderatorDecision: {
          action: 'queueFreshEvaluation',
          finalOutcome: 'review',
          reasonCode,
          notes: null,
          decidedBy: decoded.uid,
          decidedAt: FieldValue.serverTimestamp(),
        },
        moderationGeneration: primaryGeneration,
        source: 'moderatorQueueFreshEvaluation',
        nowFactory: () => FieldValue.serverTimestamp(),
      });
      transaction.set(queueModerationExampleRef, {
        ...queueExamplePayload,
        moderationScopeGenerations: nextGenerations,
      }, { merge: true });

      responseUserId = freshCaseUserId || null;
      responseScopeKeys = scopeKeys;
      responseGenerations = nextGenerations;
      responseUploadFound = Boolean(primaryUpload?.exists);
      responseStatus = nextStatus;
    });

    res.status(200).json({
      ok: true,
      reviewCaseId,
      uploadId: effectiveUploadId,
      userId: responseUserId,
      uploadFound: responseUploadFound,
      uploadUpdateSkipped: Boolean(effectiveUploadId) && !responseUploadFound,
      fingerprintQueued: responseScopeKeys.length > 0,
      queueFreshEvaluationMode: responseScopeKeys.length > 0 ? 'moderationGeneration' : 'closeOnlyNoFingerprint',
      moderationScopeKeys: responseScopeKeys,
      moderationGenerations: responseGenerations,
      status: responseStatus,
      message: responseScopeKeys.length > 0
        ? 'Fresh evaluation generation incremented for matching fingerprint scope.'
        : 'Case removed from active review; no valid fingerprint scope was available.',
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: error.message || 'Failed to queue fresh evaluation',
      ...(error?.code ? { code: error.code } : {}),
    });
  }
});

"""

sub_once(
    r"export const moderatorQueueFreshEvaluation = onRequest\(\{ cors: true, region: 'europe-west4' \}, async \(req, res\) => \{.*?\n\}\);\n\nexport const userModerationAction",
    new_queue_endpoint + 'export const userModerationAction',
    'replace moderator fresh evaluation endpoint',
    flags=re.S,
)

# Publication must share the same authority doc inside the write transaction.
replace_once(
    """        if (messageRef && latestMessage?.metadata?.uploadId !== uploadId) {
          const error = new Error('Not authorized for this action');
          error.status = 403;
          throw error;
        }
        if (publicationAuthorProfileRef) {""",
    """        if (messageRef && latestMessage?.metadata?.uploadId !== uploadId) {
          const error = new Error('Not authorized for this action');
          error.status = 403;
          throw error;
        }
        if (postRef) {
          const latestModerationScope = await readModerationScopeGeneration({
            db,
            fingerprints: latestUpload?.fingerprints || null,
            transaction,
          });
          if (!isModerationGenerationCurrent({
            evidenceGeneration: latestUpload?.moderationGeneration,
            currentGeneration: latestModerationScope.generation,
          })) {
            const error = new Error('Upload moderation is stale and must be evaluated again');
            error.status = 409;
            error.code = 'moderation_generation_stale';
            throw error;
          }
        }
        if (publicationAuthorProfileRef) {""",
    'publication generation fence',
)

# Explicit live-code invariants: legacy runtime authority is gone.
for forbidden in [
    'freshEvaluationReservationMs',
    'reserveFreshEvaluationOverride',
    'consumeFreshEvaluationOverride',
    'releaseFreshEvaluationOverrideReservation',
    'reservationRequestId',
    'reservationExpiresAtMs',
    'matchesFingerprintEntry',
    'freshEvaluationOverrides',
    'skipUploadReuse',
    'overrideReservation',
]:
    if forbidden in source:
        raise SystemExit(f'legacy symbol still present after refactor: {forbidden}')

for required in [
    'requestModerationGeneration',
    'moderationGeneration: requestModerationGeneration',
    'fresh_evaluation_superseded_during_request',
    'planModerationScopeGenerationIncrement',
    'moderation_generation_stale',
    'collectModerationFingerprintEntries',
    'readModerationScopeGeneration',
]:
    if required not in source:
        raise SystemExit(f'required generation invariant missing: {required}')

if source == original:
    raise SystemExit('index refactor made no changes')

path.write_text(source)
