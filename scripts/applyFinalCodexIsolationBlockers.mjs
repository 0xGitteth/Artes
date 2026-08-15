#!/usr/bin/env node
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (path) => fs.readFile(path, 'utf8');
const write = (path, content) => fs.writeFile(path, content, 'utf8');

const replaceOnce = (source, search, replacement, label) => {
  const first = source.indexOf(search);
  if (first === -1) throw new Error(`Missing anchor for ${label}`);
  if (source.indexOf(search, first + search.length) !== -1) {
    throw new Error(`Anchor for ${label} is not unique`);
  }
  return source.slice(0, first) + replacement + source.slice(first + search.length);
};

const replaceOnceAfter = (source, after, search, replacement, label) => {
  const anchor = source.indexOf(after);
  if (anchor === -1) throw new Error(`Missing preceding anchor for ${label}`);
  const first = source.indexOf(search, anchor + after.length);
  if (first === -1) throw new Error(`Missing anchor for ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
};

const replaceBetween = (source, start, end, replacement, label) => {
  const startIndex = source.indexOf(start);
  if (startIndex === -1) throw new Error(`Missing start anchor for ${label}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex === -1) throw new Error(`Missing end anchor for ${label}`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
};

const appendOnce = (source, marker, addition, label) => {
  if (source.includes(addition.trim())) return source;
  const index = source.indexOf(marker);
  if (index === -1) throw new Error(`Missing append marker for ${label}`);
  return source.slice(0, index + marker.length) + addition + source.slice(index + marker.length);
};

// 1. Preserve approved-merge contributor recovery evidence before cleanup.
{
  const path = 'functions/scripts/reconcileCodexDevIsolation.js';
  let source = await read(path);
  const contributorAnchor = "    const contributors = await queryDocs(db.collection('contributors').where('createdByUid', '==', uid));";
  const preclassification = String.raw`    const claimRequests = await queryDocs(db.collection('claimRequests').where('requestedByUid', '==', uid));
    const approvedMergeRecoveryContributorIds = new Set();
    for (const claimRequest of claimRequests) {
      const requestData = claimRequest.data() || {};
      if (requestData.mode !== 'merge' || requestData.status !== 'approved') continue;
      const primaryContributorId = requestData.primaryContributorId || requestData.contributorId || null;
      const secondaryContributorId = requestData.secondaryContributorId || null;
      if (primaryContributorId) approvedMergeRecoveryContributorIds.add(primaryContributorId);
      if (secondaryContributorId) approvedMergeRecoveryContributorIds.add(secondaryContributorId);
    }

    const contributors = await queryDocs(db.collection('contributors').where('createdByUid', '==', uid));`;
  source = replaceOnce(source, contributorAnchor, preclassification, 'approved merge preclassification');
  source = replaceOnce(
    source,
    '      if (legitimateOwner || activeOrdinaryClaims.length > 0) {',
    String.raw`      const requiredForApprovedMergeRecovery = approvedMergeRecoveryContributorIds.has(contributor.id);
      if (legitimateOwner || activeOrdinaryClaims.length > 0 || requiredForApprovedMergeRecovery) {`,
    'approved merge contributor preservation condition',
  );
  source = replaceOnceAfter(
    source,
    "    const outgoingFollows = await queryDocs(db.collection('users').doc(uid).collection('following'));",
    "    const claimRequests = await queryDocs(db.collection('claimRequests').where('requestedByUid', '==', uid));\n",
    '',
    'reuse preloaded claim requests',
  );
  await write(path, source);
}

// 2. Block global Codex moderation-record reads while retaining only explicit own test-upload read.
{
  const path = 'firestore.rules';
  let source = await read(path);
  source = replaceOnce(
    source,
    "      allow read: if isDevAnon() || isModerator() || (request.auth != null && request.auth.uid == resource.data.userId);",
    "      allow read: if !isKnownCodexProductionDenied() && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId));",
    'reviewCases production deny',
  );
  source = replaceOnce(
    source,
    "      allow read: if isDevAnon() || isModerator() || (request.auth != null && request.auth.uid == resource.data.userId);",
    String.raw`      allow read: if (!isKnownCodexProductionDenied()
          && (isModerator() || (request.auth != null && request.auth.uid == resource.data.userId)))
        || (isCodexDev()
          && request.auth.uid == resource.data.userId
          && ('testActor' in resource.data)
          && resource.data.testActor == 'codex');`,
    'uploads production deny with narrow test self-read',
  );
  await write(path, source);
}

// 3. Shared transaction wrapper used by every userModerationAction write path.
await write('functions/userModerationActionIsolation.js', String.raw`const defaultDeniedError = () => {
  const error = new Error('Codex Dev production moderation actions are isolated.');
  error.status = 403;
  error.code = 'codex-dev-production-denied';
  return error;
};

export const runUserModerationActionMutation = async ({
  db,
  uid,
  isKnownCodexDevActorUid,
  mutate,
  createDeniedError = defaultDeniedError,
}) => {
  if (!db || !uid || typeof isKnownCodexDevActorUid !== 'function' || typeof mutate !== 'function') {
    throw new Error('runUserModerationActionMutation requires db, uid, actor lookup, and mutate callback');
  }
  return db.runTransaction(async (transaction) => {
    if (await isKnownCodexDevActorUid({ db, uid, transaction })) {
      throw createDeniedError();
    }
    return mutate(transaction);
  });
};
`);

{
  const path = 'functions/index.js';
  let source = await read(path);
  source = replaceOnce(
    source,
    "import { canPublishUpload, getUserPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';\n",
    "import { canPublishUpload, getUserPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';\nimport { runUserModerationActionMutation } from './userModerationActionIsolation.js';\n",
    'user moderation transaction helper import',
  );

  const replacement = String.raw`export const userModerationAction = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    requireVerifiedPasswordUser(decoded);
    const body = parseJsonBody(req);
    const { messageId, uploadId, action, postDraft: postDraftFromBody } = body || {};
    if (isCodexDevForProductionDeny(decoded)
      || await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev production moderation actions are isolated.' });
      return;
    }
    if (!uploadId || !action || (requiresMessageIdForAction(action) && !messageId)) {
      res.status(400).json({ error: 'uploadId and action are required (messageId required for this action)' });
      return;
    }
    if (!['publishNow', 'saveDraft', 'dismiss', 'repairPublished', 'acceptCorrection', 'rejectCorrection', 'markPublicationPromptOpened', 'discardApprovedUpload'].includes(action)) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }

    const userId = decoded.uid;
    const threadId = 'support_' + userId;
    const threadRef = db.collection('threads').doc(threadId);
    const messageRef = action === 'repairPublished' || !messageId ? null : threadRef.collection('messages').doc(messageId);
    const uploadRef = db.collection('uploads').doc(uploadId);
    const userRef = db.collection('users').doc(userId);
    const postRef = action === 'publishNow' || action === 'repairPublished'
      ? db.collection('posts').doc(uploadId)
      : null;
    const draftRef = action === 'saveDraft'
      ? userRef.collection('drafts').doc()
      : null;

    const [messageSnap, uploadSnap] = await Promise.all([
      messageRef ? messageRef.get() : Promise.resolve(null),
      uploadRef.get(),
    ]);
    if (!uploadSnap.exists) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }
    if (messageRef && !messageSnap?.exists) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    const message = messageSnap?.data?.() || null;
    const upload = uploadSnap.data() || {};
    const uploadOwnerId = upload?.userId || upload?.ownerUid || upload?.userUid || null;
    if (uploadOwnerId !== userId) {
      res.status(403).json({ error: 'Not authorized for this action' });
      return;
    }
    if (messageRef && message?.metadata?.uploadId !== uploadId) {
      res.status(403).json({ error: 'Not authorized for this action' });
      return;
    }

    if ((action === 'publishNow' || action === 'repairPublished') && !canPublishUpload(upload)) {
      res.status(409).json({ error: 'Upload is not approved' });
      return;
    }
    if (action === 'saveDraft' && upload?.reviewStatus !== 'approved') {
      res.status(409).json({ error: 'Upload is not approved' });
      return;
    }
    if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && upload?.reviewStatus !== 'approved') {
      res.status(409).json({ error: 'Upload is not approved' });
      return;
    }
    const initialPublicationStatus = String(upload?.publicationStatus || upload?.publishStatus || '').trim();
    if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && initialPublicationStatus === 'published') {
      res.status(409).json({ error: 'Upload is already published' });
      return;
    }
    if (action === 'acceptCorrection' || action === 'rejectCorrection') {
      const validation = validateUploaderCorrectionAction({ action, upload, userId });
      if (!validation.ok) {
        res.status(validation.status || 400).json({ error: validation.error });
        return;
      }
    }

    let resolvedAuthorProfile = null;
    if (action === 'publishNow' || action === 'repairPublished') {
      const initialPostDraft = {
        ...(upload?.postDraft || {}),
        ...(postDraftFromBody && typeof postDraftFromBody === 'object' ? postDraftFromBody : {}),
      };
      const requestedAuthorProfileId = initialPostDraft?.authorProfileId || upload?.authorProfileId || userId;
      resolvedAuthorProfile = await resolveAuthorProfileForUid(userId, requestedAuthorProfileId);
    }

    await runUserModerationActionMutation({
      db,
      uid: userId,
      isKnownCodexDevActorUid,
      mutate: async (transaction) => {
        const [latestUploadSnap, latestMessageSnap, latestUserSnap, latestPostSnap] = await Promise.all([
          transaction.get(uploadRef),
          messageRef ? transaction.get(messageRef) : Promise.resolve(null),
          postRef ? transaction.get(userRef) : Promise.resolve(null),
          postRef ? transaction.get(postRef) : Promise.resolve(null),
        ]);

        if (!latestUploadSnap.exists) {
          const error = new Error('Upload not found');
          error.status = 404;
          throw error;
        }
        if (messageRef && !latestMessageSnap?.exists) {
          const error = new Error('Message not found');
          error.status = 404;
          throw error;
        }

        const latestUpload = latestUploadSnap.data() || {};
        const latestMessage = latestMessageSnap?.data?.() || null;
        const latestOwnerId = latestUpload?.userId || latestUpload?.ownerUid || latestUpload?.userUid || null;
        if (latestOwnerId !== userId) {
          const error = new Error('Not authorized for this action');
          error.status = 403;
          throw error;
        }
        if (messageRef && latestMessage?.metadata?.uploadId !== uploadId) {
          const error = new Error('Not authorized for this action');
          error.status = 403;
          throw error;
        }

        const latestPublicationStatus = String(latestUpload?.publicationStatus || latestUpload?.publishStatus || '').trim();
        if ((action === 'publishNow' || action === 'repairPublished') && !canPublishUpload(latestUpload)) {
          const error = new Error('Upload is not approved');
          error.status = 409;
          throw error;
        }
        if (action === 'saveDraft' && latestUpload?.reviewStatus !== 'approved') {
          const error = new Error('Upload is not approved');
          error.status = 409;
          throw error;
        }
        if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && latestUpload?.reviewStatus !== 'approved') {
          const error = new Error('Upload is not approved');
          error.status = 409;
          throw error;
        }
        if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && latestPublicationStatus === 'published') {
          const error = new Error('Upload is already published');
          error.status = 409;
          throw error;
        }

        let correctionPlan = null;
        if (action === 'acceptCorrection' || action === 'rejectCorrection') {
          const validation = validateUploaderCorrectionAction({ action, upload: latestUpload, userId });
          if (!validation.ok) {
            const error = new Error(validation.error);
            error.status = validation.status || 400;
            throw error;
          }
          const { correctedTaxonomy } = validation;
          const reviewCaseId = latestUpload?.reviewCaseId || null;
          const nextCorrection = {
            ...(latestUpload?.correction && typeof latestUpload.correction === 'object' ? latestUpload.correction : {}),
            suggestedThemes: correctedTaxonomy.themes,
            suggestedTriggers: correctedTaxonomy.triggers,
          };
          if (action === 'acceptCorrection') {
            nextCorrection.userAcceptedAt = FieldValue.serverTimestamp();
            nextCorrection.userRejectedAt = null;
            nextCorrection.requiresModeratorReview = false;
            nextCorrection.publishBlocked = false;
            nextCorrection.finalAcceptedThemes = correctedTaxonomy.themes;
            nextCorrection.finalAcceptedTriggers = correctedTaxonomy.triggers;
          } else {
            nextCorrection.userRejectedAt = FieldValue.serverTimestamp();
            nextCorrection.requiresModeratorReview = true;
            nextCorrection.publishBlocked = true;
            nextCorrection.reviewRequestedAt = FieldValue.serverTimestamp();
          }
          const correctionActionName = action === 'acceptCorrection' ? 'acceptCorrection' : 'rejectCorrection';
          const moderationExampleId = (reviewCaseId || uploadId) + '_uploaderCorrection';
          correctionPlan = {
            correctedTaxonomy,
            nextCorrection,
            moderationExampleRef: db.collection('moderationExamples').doc(moderationExampleId),
            moderationExamplePayload: buildCommonModerationExample({
              source: 'userModerationAction',
              uploadId,
              reviewCaseId,
              postId: uploadId,
              uploaderUid: userId,
              fingerprints: latestUpload?.fingerprints || null,
              uploadData: latestUpload,
              reviewData: {},
              aiResult: latestUpload?.aiResult || {},
              moderationSignals: latestUpload?.moderationSignals || {},
              correctionSnapshot: {
                originalSelectedThemes: Array.isArray(latestUpload?.postDraft?.styles) ? latestUpload.postDraft.styles : [],
                originalSelectedTriggers: Array.isArray(latestUpload?.postDraft?.makerTags) ? latestUpload.postDraft.makerTags : [],
                finalAcceptedThemes: action === 'acceptCorrection' ? correctedTaxonomy.themes : [],
                finalAcceptedTriggers: action === 'acceptCorrection' ? correctedTaxonomy.triggers : [],
              },
              decision: null,
              policyDecisionOutcome: latestUpload?.aiResult?.outcome || null,
              moderatorDecision: {
                action: correctionActionName,
                priorAction: latestUpload?.moderatorDecision?.action || null,
                reasonCode: latestUpload?.moderatorDecision?.reasonCode || null,
                correctedTaxonomy,
              },
              uploaderCorrectionResponse: action === 'acceptCorrection'
                ? { status: 'accepted', acceptedAt: FieldValue.serverTimestamp(), acceptedBy: userId }
                : { status: 'rejected', rejectedAt: FieldValue.serverTimestamp(), rejectedBy: userId },
              userCorrectionAction: {
                acceptedCorrection: action === 'acceptCorrection',
                rejectedCorrection: action === 'rejectCorrection',
                requestedReview: action === 'rejectCorrection',
                timestamp: FieldValue.serverTimestamp(),
              },
              nowFactory: () => FieldValue.serverTimestamp(),
            }),
          };
        }

        let publicationPlan = null;
        if (postRef) {
          const publishDecision = getUserPublicPostPublishDecision(latestUserSnap?.exists ? latestUserSnap.data() : null);
          if (!publishDecision.allowed) {
            const error = new Error(publishDecision.code);
            error.status = 403;
            error.code = publishDecision.code;
            throw error;
          }
          const postDraft = {
            ...(latestUpload?.postDraft || {}),
            ...(postDraftFromBody && typeof postDraftFromBody === 'object' ? postDraftFromBody : {}),
          };
          const normalizedImageUrl = String(postDraft?.imageUrl || latestUpload?.imageUrl || latestUpload?.imageRef || '').trim();
          if (!normalizedImageUrl) {
            const error = new Error('Cannot publish upload without imageUrl');
            error.status = 400;
            throw error;
          }
          publicationPlan = {
            title: String(postDraft?.title || latestUpload?.title || latestUpload?.caption || '').trim(),
            description: String(postDraft?.description || postDraft?.caption || latestUpload?.description || latestUpload?.caption || '').trim(),
            imageUrl: normalizedImageUrl,
            styles: Array.isArray(postDraft?.styles)
              ? postDraft.styles.filter(Boolean)
              : Array.isArray(postDraft?.themes) ? postDraft.themes.filter(Boolean) : [],
            makerTags: Array.isArray(postDraft?.makerTags)
              ? postDraft.makerTags.filter(Boolean)
              : Array.isArray(latestUpload?.makerTags) ? latestUpload.makerTags.filter(Boolean) : [],
            appliedTriggers: Array.isArray(postDraft?.appliedTriggers)
              ? postDraft.appliedTriggers.filter(Boolean)
              : Array.isArray(latestUpload?.appliedTriggers) ? latestUpload.appliedTriggers.filter(Boolean) : [],
            credits: Array.isArray(postDraft?.credits)
              ? postDraft.credits.filter(Boolean)
              : Array.isArray(postDraft?.contributors) ? postDraft.contributors.filter(Boolean) : [],
            authorName: String(postDraft?.authorName || resolvedAuthorProfile?.displayName || latestUpload?.authorName || '').trim(),
            authorRole: String(postDraft?.authorRole || latestUpload?.authorRole || '').trim(),
            isChallenge: Boolean(postDraft?.isChallenge || latestUpload?.isChallenge),
          };
        }

        // No transaction reads are allowed below this line.
        if (action === 'markPublicationPromptOpened') {
          transaction.set(uploadRef, {
            publicationPromptOpenedAt: FieldValue.serverTimestamp(),
            publicationPromptOpenedByUid: userId,
            publicationPromptDismissedAt: FieldValue.serverTimestamp(),
            publicationPromptDismissedByUid: userId,
          }, { merge: true });
          if (messageRef) transaction.set(messageRef, { unread: false }, { merge: true });
        }

        if (action === 'discardApprovedUpload') {
          transaction.set(uploadRef, {
            publicationStatus: 'discarded',
            publishStatus: 'discarded',
            discardedAt: FieldValue.serverTimestamp(),
            discardedByUid: userId,
            publicationPromptDismissedAt: FieldValue.serverTimestamp(),
            publicationPromptDismissedByUid: userId,
          }, { merge: true });
          const reviewCaseId = latestUpload?.reviewCaseId || null;
          if (reviewCaseId) {
            transaction.set(db.collection('reviewCases').doc(reviewCaseId), {
              userPublicationStatus: 'discarded',
              userDiscardedAt: FieldValue.serverTimestamp(),
              userDiscardedByUid: userId,
            }, { merge: true });
          }
          if (messageRef) {
            transaction.set(messageRef, {
              unread: false,
              resolved: true,
              resolvedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }

        if (correctionPlan) {
          transaction.set(uploadRef, {
            correctedTaxonomy: correctionPlan.correctedTaxonomy,
            uploaderCorrectionResponse: action === 'acceptCorrection'
              ? { status: 'accepted', acceptedAt: FieldValue.serverTimestamp(), acceptedBy: userId }
              : { status: 'rejected', rejectedAt: FieldValue.serverTimestamp(), rejectedBy: userId },
            correction: correctionPlan.nextCorrection,
            publicationStatus: action === 'acceptCorrection' ? 'correction_accepted' : 'user_disagreed',
            reviewStatus: action === 'acceptCorrection' ? 'approved' : 'needs_user_correction',
            requiresUploaderAcceptance: action !== 'acceptCorrection',
            ...(action === 'acceptCorrection' ? {
              postDraft: {
                ...(latestUpload?.postDraft || {}),
                styles: correctionPlan.correctedTaxonomy.themes,
                makerTags: correctionPlan.correctedTaxonomy.triggers,
                appliedTriggers: correctionPlan.correctedTaxonomy.triggers,
              },
            } : {}),
          }, { merge: true });
          transaction.set(correctionPlan.moderationExampleRef, correctionPlan.moderationExamplePayload, { merge: true });
        }

        if (publicationPlan) {
          if (!latestPostSnap?.exists) {
            transaction.create(postRef, {
              title: publicationPlan.title || 'Untitled',
              description: publicationPlan.description || '',
              imageUrl: publicationPlan.imageUrl,
              authorId: userId,
              authorUid: userId,
              authorProfileId: resolvedAuthorProfile.profileId,
              authorOwnerUid: userId,
              authorName: publicationPlan.authorName || null,
              authorRole: publicationPlan.authorRole || null,
              styles: publicationPlan.styles,
              makerTags: publicationPlan.makerTags,
              appliedTriggers: publicationPlan.appliedTriggers,
              triggers: publicationPlan.appliedTriggers,
              outcome: latestUpload?.outcome || 'allowed',
              forbiddenReasons: Array.isArray(latestUpload?.forbiddenReasons) ? latestUpload.forbiddenReasons : [],
              reviewCaseId: latestUpload?.reviewCaseId || null,
              credits: publicationPlan.credits,
              likes: 0,
              isChallenge: publicationPlan.isChallenge,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          transaction.set(uploadRef, {
            publicationStatus: 'published',
            publishedAt: FieldValue.serverTimestamp(),
            postId: uploadId,
          }, { merge: true });
          if (messageRef) {
            transaction.set(messageRef, {
              unread: false,
              resolved: true,
              resolvedAt: FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        }

        if (action === 'saveDraft') {
          transaction.set(draftRef, {
            uploadId,
            storagePath: latestUpload?.storagePath || null,
            imageRef: latestUpload?.imageRef || null,
            caption: latestUpload?.caption || null,
            tags: latestUpload?.tags || null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            status: 'draft',
          });
          transaction.set(uploadRef, { publicationStatus: 'draft' }, { merge: true });
          transaction.set(messageRef, {
            unread: false,
            resolved: true,
            resolvedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        if (action === 'dismiss') {
          transaction.set(messageRef, { unread: false }, { merge: true });
        }

        transaction.set(threadRef, { updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      },
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to perform action', ...(error.code ? { code: error.code } : {}) });
  }
});


`;
  source = replaceBetween(
    source,
    "export const userModerationAction = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {",
    'export const getContributorByAliasCallable',
    replacement,
    'userModerationAction authoritative transaction',
  );
  await write(path, source);
}

// 4. Regression coverage for contributor recovery.
{
  const path = 'tests/codexDevLegacyCleanup.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    "  'contributors/claimed-by-test': { createdByUid: 'real', claimedByUid: 'marked-test', status: 'claimed' },\n",
    "  'contributors/claimed-by-test': { createdByUid: 'real', claimedByUid: 'marked-test', status: 'claimed' },\n  'contributors/merge-primary': { createdByUid: 'real', displayName: 'Merge Primary' },\n  'contributors/merge-secondary': { createdByUid: 'marked-test', claimedByUid: 'marked-test', status: 'merged', displayName: 'Merge Secondary Recovery', mergedInto: 'merge-primary' },\n",
    'merge recovery contributor fixtures',
  );
  source = replaceOnce(
    source,
    "  'contributorAliases/merge-evidence-alias': { contributorId: 'merge-primary' },\n",
    "  'contributorAliases/merge-evidence-alias': { contributorId: 'merge-primary' },\n  'contributorAliases/merge-secondary-evidence-alias': { contributorId: 'merge-secondary', createdByUid: 'marked-test', type: 'instagram' },\n",
    'merge recovery alias fixture',
  );
  source = replaceOnce(source, 'assert.equal(dryStats.preservedContributors, 3);', 'assert.equal(dryStats.preservedContributors, 4);', 'preserved contributor count');
  source = replaceOnce(source, 'assert.equal(dryStats.preservedContributorAliases, 5);', 'assert.equal(dryStats.preservedContributorAliases, 6);', 'preserved alias count');
  source = replaceOnce(
    source,
    "'contributors/moderation-claim-contributor', 'contributorAliases/real-alias'",
    "'contributors/moderation-claim-contributor', 'contributors/merge-secondary', 'contributorAliases/real-alias'",
    'preserve merge secondary contributor assertion list',
  );
  source = replaceOnce(
    source,
    "'contributorAliases/moderation-claim-alias', 'contributorAliases/merge-evidence-alias'",
    "'contributorAliases/moderation-claim-alias', 'contributorAliases/merge-evidence-alias', 'contributorAliases/merge-secondary-evidence-alias'",
    'preserve merge secondary alias assertion list',
  );
  source = replaceOnce(
    source,
    "assert.equal(applyDocs.get('contributors/claimed-by-test').claimedByUid, null);\n",
    "assert.equal(applyDocs.get('contributors/claimed-by-test').claimedByUid, null);\nassert.equal(applyDocs.get('contributors/merge-secondary').displayName, 'Merge Secondary Recovery');\nassert.equal(applyDocs.get('contributors/merge-secondary').mergedInto, 'merge-primary');\n",
    'merge secondary profile evidence assertion',
  );
  await write(path, source);
}

// 5. Firestore emulator coverage for moderation-record privacy.
{
  const path = 'tests/firestore.publicUsers.rules.test.mjs';
  let source = await read(path);
  const seedAnchor = String.raw`      await setDoc(doc(db, 'config', 'moderation'), {
        moderatorEmails: ['mod_1@example.com'],
      });`;
  const seedAddition = String.raw`
      await setDoc(doc(db, 'reviewCases', 'owner_review_case'), { userId: ownerUid, status: 'inReview' });
      await setDoc(doc(db, 'reviewCases', 'other_review_case'), { userId: otherUid, status: 'inReview' });
      await setDoc(doc(db, 'reviewCases', 'codex_legacy_review_case'), { userId: 'codex-dev-user', status: 'inReview' });
      await setDoc(doc(db, 'uploads', 'owner_upload_rules'), { userId: ownerUid, outcome: 'allowed' });
      await setDoc(doc(db, 'uploads', 'other_upload_rules'), { userId: otherUid, outcome: 'allowed' });
      await setDoc(doc(db, 'uploads', 'codex_test_upload_rules'), { userId: 'codex-dev-user', testActor: 'codex', outcome: 'allowed' });
      await setDoc(doc(db, 'uploads', 'codex_legacy_production_upload_rules'), { userId: 'codex-dev-user', outcome: 'allowed' });
      await setDoc(doc(db, 'uploads', 'retired_codex_test_upload_rules'), { userId: 'retired-codex', testActor: 'codex', outcome: 'allowed' });`;
  source = appendOnce(source, seedAnchor, seedAddition, 'moderation record fixtures');

  const contextAnchor = "    const codexDevDb = authedContext(testEnv, 'codex-dev-user', { devCodex: true, devActor: 'codex', email_verified: false }).firestore();\n";
  source = replaceOnce(
    source,
    contextAnchor,
    contextAnchor
      + "    const codexModeratorDb = authedContext(testEnv, 'codex-dev-user', { devCodex: true, devActor: 'codex', email_verified: true, email: 'mod_1@example.com' }).firestore();\n",
    'current Codex moderator context',
  );
  const retiredContextAnchor = "    const retiredCodexDb = authedContext(testEnv, 'retired-codex', { email_verified: true, idvVerified: true, isAdult: true }).firestore();\n";
  source = replaceOnce(
    source,
    retiredContextAnchor,
    retiredContextAnchor
      + "    const retiredCodexModeratorDb = authedContext(testEnv, 'retired-codex', { email_verified: true, idvVerified: true, isAdult: true, email: 'mod_1@example.com' }).firestore();\n",
    'retired Codex moderator context',
  );

  const assertionMarker = "    const agencyOwnerDb = authedContext(testEnv, 'agency_owner', { email_verified: true }).firestore();\n";
  const assertions = String.raw`

    // Production moderation data is not a Codex dev-wide namespace.
    await assertSucceeds(getDoc(doc(ownerDb, 'uploads', 'owner_upload_rules')));
    await assertFails(getDoc(doc(ownerDb, 'uploads', 'other_upload_rules')));
    await assertSucceeds(getDoc(doc(ownerDb, 'reviewCases', 'owner_review_case')));
    await assertFails(getDoc(doc(ownerDb, 'reviewCases', 'other_review_case')));
    await assertSucceeds(getDoc(doc(moderatorDb, 'uploads', 'owner_upload_rules')));
    await assertSucceeds(getDoc(doc(moderatorDb, 'reviewCases', 'other_review_case')));

    await assertFails(getDoc(doc(codexDevDb, 'uploads', 'owner_upload_rules')));
    await assertFails(getDoc(doc(codexDevDb, 'uploads', 'codex_legacy_production_upload_rules')));
    await assertSucceeds(getDoc(doc(codexDevDb, 'uploads', 'codex_test_upload_rules')));
    await assertFails(getDoc(doc(codexDevDb, 'reviewCases', 'owner_review_case')));
    await assertFails(getDoc(doc(codexDevDb, 'reviewCases', 'codex_legacy_review_case')));
    await assertFails(getDocs(collection(codexDevDb, 'uploads')));
    await assertFails(getDocs(collection(codexDevDb, 'reviewCases')));

    await assertFails(getDoc(doc(codexModeratorDb, 'uploads', 'owner_upload_rules')));
    await assertFails(getDoc(doc(codexModeratorDb, 'reviewCases', 'owner_review_case')));
    await assertSucceeds(getDoc(doc(codexModeratorDb, 'uploads', 'codex_test_upload_rules')));

    await assertFails(getDoc(doc(retiredCodexDb, 'uploads', 'retired_codex_test_upload_rules')));
    await assertFails(getDoc(doc(retiredCodexDb, 'reviewCases', 'owner_review_case')));
    await assertFails(getDoc(doc(retiredCodexModeratorDb, 'uploads', 'owner_upload_rules')));
    await assertFails(getDoc(doc(retiredCodexModeratorDb, 'reviewCases', 'owner_review_case')));`;
  source = appendOnce(source, assertionMarker, assertions, 'moderation record read assertions');
  await write(path, source);
}

// 6. Executable retry/isolation tests plus structural coverage that no userModerationAction write escaped the guard.
{
  const path = 'tests/codexDevIsolation.test.mjs';
  let source = await read(path);
  source = replaceOnce(
    source,
    "import { createClaimInviteAtomically } from '../functions/claimInviteTransaction.js';\n",
    "import { createClaimInviteAtomically } from '../functions/claimInviteTransaction.js';\nimport { runUserModerationActionMutation } from '../functions/userModerationActionIsolation.js';\n",
    'user moderation isolation test import',
  );
  const addition = String.raw`

test('userModerationAction guarded mutation retries into quarantine with zero committed writes', async () => {
  const shapes = new Map([
    ['correction', ['uploads/u', 'moderationExamples/e']],
    ['prompt', ['uploads/u', 'threads/t/messages/m', 'threads/t']],
    ['discard', ['uploads/u', 'reviewCases/r', 'threads/t/messages/m', 'threads/t']],
    ['saveDraft', ['users/u/drafts/d', 'uploads/u', 'threads/t/messages/m', 'threads/t']],
    ['dismiss', ['threads/t/messages/m', 'threads/t']],
    ['publish', ['posts/u', 'uploads/u', 'threads/t/messages/m', 'threads/t']],
  ]);

  for (const [name, paths] of shapes) {
    let denied = false;
    const committed = [];
    let attempts = 0;
    const makeTransaction = (queued) => ({
      set: (ref) => queued.push(ref.path),
      create: (ref) => queued.push(ref.path),
      update: (ref) => queued.push(ref.path),
    });
    const db = {
      runTransaction: async (callback) => {
        attempts += 1;
        const firstQueued = [];
        await callback(makeTransaction(firstQueued));
        // Simulate Firestore detecting a concurrent registry write at commit:
        // first-attempt writes are discarded and the callback is retried.
        denied = true;
        attempts += 1;
        const retryQueued = [];
        await callback(makeTransaction(retryQueued));
        committed.push(...retryQueued);
      },
    };
    const isKnown = async () => denied;
    await assert.rejects(
      runUserModerationActionMutation({
        db,
        uid: 'ordinary-becoming-codex',
        isKnownCodexDevActorUid: isKnown,
        mutate: async (transaction) => {
          paths.forEach((path) => transaction.set({ path }, {}));
        },
      }),
      (error) => error.status === 403 && error.code === 'codex-dev-production-denied',
      name,
    );
    assert.equal(attempts, 2, name + ' retried after concurrent registry registration');
    assert.deepEqual(committed, [], name + ' commits zero writes after quarantine');
  }
});

test('userModerationAction guarded mutation allows an ordinary transaction and denies an already registered actor before mutate', async () => {
  const committed = [];
  const ordinaryDb = {
    runTransaction: async (callback) => {
      const queued = [];
      const result = await callback({ set: (ref) => queued.push(ref.path) });
      committed.push(...queued);
      return result;
    },
  };
  await runUserModerationActionMutation({
    db: ordinaryDb,
    uid: 'ordinary',
    isKnownCodexDevActorUid: async () => false,
    mutate: async (transaction) => transaction.set({ path: 'uploads/ordinary' }, {}),
  });
  assert.deepEqual(committed, ['uploads/ordinary']);

  let mutateCalls = 0;
  const deniedDb = { runTransaction: async (callback) => callback({}) };
  await assert.rejects(
    runUserModerationActionMutation({
      db: deniedDb,
      uid: 'retired-codex',
      isKnownCodexDevActorUid: async () => true,
      mutate: async () => { mutateCalls += 1; },
    }),
    (error) => error.status === 403 && error.code === 'codex-dev-production-denied',
  );
  assert.equal(mutateCalls, 0);
});

test('userModerationAction has one authoritative transaction boundary and no direct Firestore writes afterward', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const userModerationAction');
  const end = source.indexOf('export const getContributorByAliasCallable', start);
  assert.ok(start >= 0 && end > start);
  const section = source.slice(start, end);
  assert.match(section, /runUserModerationActionMutation\(\{/);
  assert.doesNotMatch(section, /\b(?:uploadRef|messageRef|threadRef|draftRef)\.set\(/);
  assert.doesNotMatch(section, /db\.collection\('moderationExamples'\)\.doc\([^\n]+\)\.set\(/);
  assert.match(section, /transaction\.set\(threadRef, \{ updatedAt:/);
  assert.match(section, /transaction\.set\(correctionPlan\.moderationExampleRef/);
  assert.match(section, /transaction\.set\(draftRef/);
  assert.match(section, /transaction\.create\(postRef/);
  const lastRead = section.lastIndexOf('transaction.get(');
  const writeIndexes = [
    section.indexOf('transaction.set('),
    section.indexOf('transaction.create('),
    section.indexOf('transaction.update('),
  ].filter((index) => index >= 0);
  assert.ok(writeIndexes.length > 0);
  assert.ok(lastRead >= 0 && lastRead < Math.min(...writeIndexes), 'all transaction reads precede every queued write');
});
`;
  source += addition;
  await write(path, source);
}

// This file is only a transport mechanism for ChatGPT's GitHub write limitation.
// Remove it from the working tree so the final PR contains only the product/test changes.
await fs.unlink(fileURLToPath(import.meta.url));
console.log('Applied final Codex isolation blockers and removed temporary patcher.');
