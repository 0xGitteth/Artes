import crypto from 'crypto';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { VertexAI } from '@google-cloud/vertexai';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import admin from 'firebase-admin';
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  buildWebsiteClaimUrl,
  checkWebsiteClaimToken,
  fetchWebsiteClaimText,
  hashWebsiteProofToken,
  normalizeDomain,
} from './websiteClaimProof.js';
import { createDiditSession, refreshDiditSession, diditWebhook } from './didit.js';
import { MODERATOR_DECISION_ACTIONS, isModeratorDecisionActionCompatible, normalizeModeratorDecisionAction, validateCorrectedTaxonomyForAction } from './moderatorDecision.js';
import { applyAutomaticModeratorCorrectionToPostDraft, buildAcceptedCorrectionModerationState, buildModeratedPublicationTaxonomy, deriveAcceptedCorrectionAppliedTriggers, validateAcceptedCorrectionPublicationTaxonomy, validateUploaderCorrectionAction } from './uploaderCorrection.js';
import { finalizeCorrectionReviewCasePlan, resolveCorrectionReviewReopenPlan, validateCorrectionAcceptancePlanProvenance, validateRoutedCorrectionAcceptanceProvenance } from './correctionReviewOwnership.js';
import { canManageApprovedUploadPrompt, canPublishUpload, canSaveDraftUpload, getServerPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';
import { runUserModerationActionMutation } from './userModerationActionIsolation.js';
import { deleteSupportResetMessagesPageAtomically } from './supportResetIsolation.js';
import { buildCommonModerationExample } from './moderationExampleBuilder.js';
import {
  fetchModerationExamplesForFingerprints,
  resolveEffectiveUploadId,
  resolveModerationExampleFingerprints,
  resolveModerationSourceFinalOutcome,
  resolveReviewCaseUploadIds,
} from './moderationExamplesLookup.js';
import { composeModerationPolicyResult } from './moderationPolicy.js';
import { runGeminiClassifier as runGeminiClassifierV2 } from './geminiModerationClassifier.js';
import { GEMINI_MODERATION_PROMPT_VERSION } from './geminiModerationContract.js';
import { routeGeminiForbiddenReasons } from './geminiModerationRouting.js';
import {
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
} from './moderationGenerationStore.js';
import {
  getCodexDevLoginDecision,
  getCodexDevLoginDiagnostics,
  isValidCodexDevLoginSecret,
  shouldExposeCodexDevLoginDiagnostics,
} from './codexDevLogin.js';
import {
  CODEX_DEV_ACTOR,
  buildCodexDevPrivateProfile,
  isCodexDevForProductionDeny,
  isCodexDevUid,
  resolveCodexDevUid,
} from './codexDevIdentity.js';
import {
  acquireCodexDevLifecycleFence,
  acquireCodexDevMergeFence,
  ensureCodexDevActorRegistered,
  ensureModeratorUidLockedOutOfCodexRegistration,
  isKnownCodexDevActorUid,
  queueCodexDevMergeFenceRenewal,
  readAndValidateCodexDevLifecycleFence,
  readAndValidateCodexDevMergeFence,
  releaseCodexDevLifecycleFence,
  releaseCodexDevMergeFence,
  releaseCodexDevMergeFenceIfUnmutated,
} from './codexDevActorRegistry.js';
import { createMarkSupportThreadReadForModerator } from './supportThreadRead.js';
import { createClaimInviteAtomically } from './claimInviteTransaction.js';
import { isAvailablePersonalPublicProfile } from './publicProfileAvailability.js';
import { applyFollowingCreatedCounters, applyFollowingDeletedCounters } from './followCounters.js';
import { resetPersonalOnboardingAtomically } from './publicProfileUnpublish.js';
import { findBestReusableAcrossPages, findFirstUploadReviewCaseAcrossPages, findReusableAcrossPages, isUploadReviewCaseData, resolveCachedReviewCaseIdForUploader, reviewCaseMatchesCurrentUploadEvidence, reviewCaseMatchesFingerprint, reviewCaseReferencesUpload, selectNearReusableUpload, shouldCreateProductionReviewCase } from './uploadReuseIsolation.js';
import { getOpenReviewCountAfterCaseExit, getReviewAccessDecision } from './reviewLifecycle.js';
import { MODERATION_STATES, PUBLICATION_STATES, resolveModerationStateForResult, resolveUploadPublicationState } from './moderationLifecycle.js';
import { getDeletedPublishedPostCleanupDecision, getModerationPendingMediaCleanupDecision, getModerationPreviewRetentionDecision, getOperationalModerationPreviewReviewCaseId, isOperationalModerationPreviewReviewCase, resolveOwnedModerationPreviewStoragePath } from './moderationPreviewStorage.js';
import { buildPersistedModerationDraftState, buildPersistedPublicationConsentProof, normalizePersistedPublicationStringList, resolveTrustedModeratedImageUrl, sanitizePersistedPublicationCorrection, sanitizePersistedPublicationImageMeta } from './persistedPublication.js';
import { cleanupCodexDevPostTrees } from './codexTestDataCleanup.js';
import { validateModerationPublicationAuthorProfile } from './moderationPublicationAuthor.js';

const suggestThreshold = 0.45;
const forbiddenThreshold = 0.7;
const mediumLogThreshold = 0.55;
const codexDevLoginSecret = defineSecret('CODEX_DEV_LOGIN_SECRET');
const configuredModerationPreviewRetentionDays = Number.parseInt(process.env.MODERATION_PREVIEW_RETENTION_DAYS || '30', 10);
const moderationPreviewRetentionDays = Number.isFinite(configuredModerationPreviewRetentionDays)
  && configuredModerationPreviewRetentionDays > 0
  ? configuredModerationPreviewRetentionDays
  : 30;
const moderationPreviewRetentionMs = moderationPreviewRetentionDays * 24 * 60 * 60 * 1000;
const configuredModerationPreviewGcBatchSize = Number.parseInt(process.env.MODERATION_PREVIEW_GC_BATCH_SIZE || '200', 10);
const moderationPreviewGcBatchSize = Number.isFinite(configuredModerationPreviewGcBatchSize)
  && configuredModerationPreviewGcBatchSize > 0
  ? Math.min(configuredModerationPreviewGcBatchSize, 500)
  : 200;
const buildModerationPreviewRetentionExpiry = (nowMs = Date.now()) => Timestamp.fromMillis(
  Number(nowMs) + moderationPreviewRetentionMs
);
const moderationPreviewPendingCleanupDelayMs = 24 * 60 * 60 * 1000;
const moderationPreviewCleanupRetryMs = 6 * 60 * 60 * 1000;
const buildModerationPreviewPendingCleanupExpiry = (nowMs = Date.now()) => Timestamp.fromMillis(
  Number(nowMs) + moderationPreviewPendingCleanupDelayMs
);

const ADULT_ART_NUDE_TRIGGER = 'adultArtNude';
const ADULT_EROTIC_SUGGESTIVE_TRIGGER = 'adultEroticSuggestive';
const INTERNAL_SEXUAL_EXPLICIT_TRIGGER = 'sexualExplicit';
const ART_NUDE_THEME = 'Art Nude';

const TRIGGER_ALIASES = {
  nudityerotic: ADULT_ART_NUDE_TRIGGER,
  'naakt (erotisch)': ADULT_ART_NUDE_TRIGGER,
  'naakt (artistiek)': ADULT_ART_NUDE_TRIGGER,
  adultartnude: ADULT_ART_NUDE_TRIGGER,
  explicit18: ADULT_EROTIC_SUGGESTIVE_TRIGGER,
  'expliciet 18+': ADULT_EROTIC_SUGGESTIVE_TRIGGER,
  adulteroticsuggestive: ADULT_EROTIC_SUGGESTIVE_TRIGGER,
};

const likelihoodScores = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 0.1,
  UNLIKELY: 0.25,
  POSSIBLE: 0.5,
  LIKELY: 0.7,
  VERY_LIKELY: 0.9,
};


const resolveValidatedPublicationAuthorOrThrow = (validation) => {
  if (validation?.ok && validation.author) return validation.author;
  const error = new Error(validation?.error || 'Publication author is not available');
  error.status = validation?.status || 400;
  error.code = validation?.code || 'publication_author_invalid';
  throw error;
};

const resolveAuthorProfileForUid = async (userId, requestedProfileId) => {
  const ownerUid = String(userId || '').trim();
  const profileId = String(requestedProfileId || '').trim() || ownerUid;
  if (ownerUid && profileId === ownerUid) {
    return resolveValidatedPublicationAuthorOrThrow(validateModerationPublicationAuthorProfile({
      userId: ownerUid,
      requestedProfileId: profileId,
    }));
  }

  const profileSnap = profileId ? await db.collection('profiles').doc(profileId).get() : null;
  return resolveValidatedPublicationAuthorOrThrow(validateModerationPublicationAuthorProfile({
    userId: ownerUid,
    requestedProfileId: profileId,
    profileExists: Boolean(profileSnap?.exists),
    profileData: profileSnap?.exists ? (profileSnap.data() || {}) : null,
  }));
};

const dataUrlPattern = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

const needlesKeywords = ['needle', 'syringe', 'injection', 'injections', 'hypodermic', 'vaccination'];
const spidersKeywords = ['spider', 'spiders', 'insect', 'insects', 'bug', 'bugs', 'beetle', 'mosquito', 'cockroach', 'ant', 'fly'];
const VISION_DIAGNOSTIC_ONLY_TRIGGERS = new Set(['spidersInsects', 'needlesInjections']);
const dhashPrefixLength = 4;
const dhashThreshold = Number.parseInt(process.env.DHASH_HAMMING_THRESHOLD || '8', 10);
const falseAppealThreshold = Number.parseInt(process.env.FALSE_APPEAL_THRESHOLD || '2', 10);
const cooldownDays = Number.parseInt(process.env.REVIEW_COOLDOWN_DAYS || '7', 10);
const claimInviteExpiryMs = Number.parseInt(process.env.CLAIM_INVITE_EXPIRY_MS || `${14 * 24 * 60 * 60 * 1000}`, 10);
const claimInviteRateLimitPerDay = Number.parseInt(process.env.CLAIM_INVITE_DAILY_LIMIT || '5', 10);
const claimCodeExpiryMs = 5 * 60 * 1000;
const claimProofRetentionMs = 30 * 24 * 60 * 60 * 1000;
const emailProofExpiryMs = Number.parseInt(process.env.EMAIL_PROOF_EXPIRY_MS || `${24 * 60 * 60 * 1000}`, 10);
const websiteProofExpiryMs = Number.parseInt(process.env.WEBSITE_PROOF_EXPIRY_MS || `${24 * 60 * 60 * 1000}`, 10);
const websiteProofVerifyLimit = Number.parseInt(process.env.WEBSITE_PROOF_VERIFY_LIMIT || '5', 10);
const websiteProofVerifyWindowMs = Number.parseInt(process.env.WEBSITE_PROOF_VERIFY_WINDOW_MS || `${10 * 60 * 1000}`, 10);
const websiteProofFetchTimeoutMs = Number.parseInt(process.env.WEBSITE_PROOF_FETCH_TIMEOUT_MS || '8000', 10);
const websiteProofMaxBytes = Number.parseInt(process.env.WEBSITE_PROOF_MAX_BYTES || `${8 * 1024}`, 10);
const websiteProofMaxRedirects = Number.parseInt(process.env.WEBSITE_PROOF_MAX_REDIRECTS || '2', 10);

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();
const lockDurationMs = 10 * 60 * 1000;

const toContributorString = (value) => String(value ?? '').trim();

const normalizeContributorInstagram = (handle) => toContributorString(handle)
  .replace(/^@+/, '')
  .toLowerCase()
  .replace(/[^a-z0-9_.]/g, '');

const normalizeContributorEmail = (email) => toContributorString(email).toLowerCase();

const makeContributorAliasId = (type, value) => `${type}:${toContributorString(value).toLowerCase()}`;

const isValidContributorEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const buildTemporaryContributorAliases = ({ instagramHandle, website, email }) => {
  const normalizedInstagram = normalizeContributorInstagram(instagramHandle);
  const normalizedDomain = normalizeDomain(website);
  const normalizedEmail = normalizeContributorEmail(email);
  const aliases = [
    normalizedInstagram ? { type: 'instagram', value: normalizedInstagram } : null,
    normalizedDomain ? { type: 'domain', value: normalizedDomain } : null,
    normalizedEmail ? { type: 'email', value: normalizedEmail } : null,
  ].filter(Boolean);

  return {
    aliases,
    normalizedInstagram,
    normalizedDomain,
    normalizedEmail,
  };
};

const normalizeContributorAliasValue = (type, value) => {
  if (type === 'instagram') return normalizeContributorInstagram(value);
  if (type === 'domain') return normalizeDomain(value);
  if (type === 'email') return normalizeContributorEmail(value);
  return toContributorString(value).toLowerCase();
};

const toPublicContributor = (id, data = {}) => ({
  id,
  displayName: data.displayName || 'Tijdelijk profiel',
  instagramHandle: data.instagramHandle || null,
  website: data.website || null,
  hasEmail: Boolean(data.hasEmail),
  status: data.status || null,
  claimedByUid: data.claimedByUid || data.claimedBy || null,
});

const getContributorContactRef = (contributorId) => db
  .collection('contributors')
  .doc(contributorId)
  .collection('private')
  .doc('contact');
const MODERATION_EXAMPLE_REASON_CODES = new Set([
  'allowed_art_nude',
  'allowed_boudoir',
  'allowed_non_sensitive',
  'review_borderline_adult',
  'forbidden_explicit_sexual',
  'forbidden_non_consensual_context',
  'forbidden_self_harm_instruction',
  'forbidden_suicide_instruction',
  'forbidden_eating_disorder_instruction',
  'forbidden_harmful_drug_instruction',
  'forbidden_other_safety',
  'wrong_theme_or_label',
  'unclear_ai_result',
]);
const MODERATION_EXAMPLE_REASON_CODES_BY_ACTION = {
  approve: new Set(['allowed_art_nude', 'allowed_boudoir', 'allowed_non_sensitive', 'wrong_theme_or_label']),
  reject: new Set(['forbidden_explicit_sexual', 'forbidden_non_consensual_context', 'forbidden_self_harm_instruction', 'forbidden_suicide_instruction', 'forbidden_eating_disorder_instruction', 'forbidden_harmful_drug_instruction', 'forbidden_other_safety', 'wrong_theme_or_label']),
  queueFreshEvaluation: new Set(['review_borderline_adult', 'unclear_ai_result', 'wrong_theme_or_label']),
};

const visionClient = new ImageAnnotatorClient();

const generateClaimCode = () => `ARTES-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const setCorsHeaders = (req, res) => {
  const allowedOrigins = [
    'https://artes.app',
    'https://artis.sliplane.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  const origin = req.get('origin');
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
};

const getAppIdFromEnv = () => {
  const direct = process.env.FIREBASE_APP_ID;
  if (direct) return direct;
  const firebaseConfig = process.env.FIREBASE_CONFIG;
  if (!firebaseConfig) return null;
  try {
    const parsed = JSON.parse(firebaseConfig);
    return parsed?.appId || null;
  } catch (error) {
    return null;
  }
};

export const ensureCodexDevProfileState = async (uid) => {
  const now = FieldValue.serverTimestamp();
  const userRef = db.collection('users').doc(uid);
  const publicUserRef = db.collection('publicUsers').doc(uid);
  await ensureCodexDevActorRegistered({ db, auth: admin.auth(), uid, now });
  const existingUserSnap = await userRef.get();
  await userRef.set(buildCodexDevPrivateProfile({
    uid,
    now,
    exists: existingUserSnap.exists,
  }), { merge: true });

  // A test actor has no public projection. Remove the legacy projection that
  // used to leak capability/IDV fields and could make Codex discoverable.
  await publicUserRef.delete();
};

const buildReportedPostPath = (postId) => {
  const appId = getAppIdFromEnv();
  if (!appId || !postId) return null;
  return `artifacts/${appId}/public/data/posts/${postId}`;
};

const getTokenFromRequest = (req) => {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7);
};

const verifyToken = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) {
    const error = new Error('Missing auth token');
    error.status = 401;
    throw error;
  }
  try {
    return await admin.auth().verifyIdToken(token);
  } catch (error) {
    const err = new Error('Invalid auth token');
    err.status = 401;
    throw err;
  }
};

const requireEmailVerified = (decoded) => {
  if (!decoded?.email_verified) {
    const error = new Error('Email not verified');
    error.status = 403;
    throw error;
  }
};

const requireVerifiedPasswordUser = (decoded) => {
  const provider = decoded?.firebase?.sign_in_provider;
  if (provider === 'password' && !decoded?.email_verified) {
    const error = new Error('Email not verified');
    error.status = 403;
    throw error;
  }
};

const getModeratorConfig = async () => {
  const snapshot = await db.collection('config').doc('moderation').get();
  const data = snapshot.exists ? snapshot.data() : {};
  const moderatorEmails = Array.isArray(data?.moderatorEmails)
    ? data.moderatorEmails.map((email) => String(email).toLowerCase())
    : [];
  return { moderatorEmails };
};

const ensureModerator = async (decoded) => {
  requireEmailVerified(decoded);
  const { moderatorEmails } = await getModeratorConfig();
  const email = decoded?.email?.toLowerCase() || '';
  if (!email || !moderatorEmails.includes(email)) {
    const error = new Error('Not a moderator');
    error.status = 403;
    throw error;
  }
  if (isCodexDevForProductionDeny(decoded)) {
    const error = new Error('Codex Dev cannot receive production moderator authorization.');
    error.status = 403;
    throw error;
  }
  await ensureModeratorUidLockedOutOfCodexRegistration({
    db, uid: decoded?.uid, email, now: new Date(),
  });
  return { email };
};

const fetchPublicUser = async (uid) => {
  if (!uid) return null;
  const snap = await db.collection('publicUsers').doc(uid).get();
  return snap.exists ? snap.data() : null;
};

const resolveDisplayTitle = (publicUser) => publicUser?.displayName || publicUser?.username || 'Chat';

const SUPPORT_INTRO_MESSAGE = 'Je kunt hier chatten met de moderatie. Om spam te voorkomen kun je maximaal 1 bericht sturen. Je krijgt binnen 3 werkdagen reactie.';
const LEGACY_SUPPORT_INTRO_MESSAGE = 'Je kunt hier chatten met de moderatie. Om spam te voorkomen kun je maximaal 1 bericht sturen totdat wij reageren. We reageren binnen 3 werkdagen.';
const SUPPORT_INTRO_TEXTS = [SUPPORT_INTRO_MESSAGE, LEGACY_SUPPORT_INTRO_MESSAGE];

const detectSupportThreadHasUserMessage = async (threadRef, userUid) => {
  const roleSnap = await threadRef.collection('messages')
    .where('senderRole', '==', 'user')
    .limit(1)
    .get();
  if (!roleSnap.empty) return true;

  const uidSnap = await threadRef.collection('messages')
    .where('senderUid', '==', userUid)
    .limit(1)
    .get();
  return !uidSnap.empty;
};

const ensureModerationThreadForUser = async (uid) => {
  if (!uid) return null;
  const threadId = `support_${uid}`;
  const threadRef = db.collection('threads').doc(threadId);
  const threadIndexRef = db.collection('users').doc(uid).collection('threadIndex').doc(threadId);
  const publicProfile = await fetchPublicUser(uid);
  const displayName = publicProfile?.displayName || publicProfile?.username || 'Artes gebruiker';
  const displayNameLower = displayName.toLowerCase();
  const created = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(threadRef);
    if (snapshot.exists) {
      const data = snapshot.data() || {};
      const updates = {
        type: 'support',
        title: 'Artes Moderatie',
        userUid: uid,
        userDisplayName: data.userDisplayName || displayName,
        userDisplayNameLower: data.userDisplayNameLower || displayNameLower,
        userPhotoURL: data.userPhotoURL || publicProfile?.photoURL || null,
        userUsername: data.userUsername || publicProfile?.username || '',
        participantUids: [uid],
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (typeof data.userMessageAllowance !== 'number') {
        updates.userMessageAllowance = 1;
      }
      if (typeof data.userCanSend !== 'boolean') {
        updates.userCanSend = true;
      }
      if (!data.lastMessagePreview) {
        updates.lastMessagePreview = SUPPORT_INTRO_MESSAGE;
      }
      if (typeof data.hasUserMessage !== 'boolean') {
        updates.hasUserMessage = await detectSupportThreadHasUserMessage(threadRef, uid);
      }
      transaction.set(
        threadRef,
        updates,
        { merge: true }
      );
      return false;
    }
    transaction.set(threadRef, {
      type: 'support',
      title: 'Artes Moderatie',
      threadKey: threadId,
      userUid: uid,
      participantUids: [uid],
      userDisplayName: displayName,
      userDisplayNameLower: displayNameLower,
      userPhotoURL: publicProfile?.photoURL || null,
      userUsername: publicProfile?.username || '',
      userMessageAllowance: 1,
      userCanSend: true,
      hasUserMessage: false,
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: SUPPORT_INTRO_MESSAGE,
      unreadForModerator: 0,
      unreadForUser: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const messageRef = threadRef.collection('messages').doc();
    transaction.set(messageRef, {
      text: SUPPORT_INTRO_MESSAGE,
      // Maak het voor elke mogelijke frontend check herkenbaar als system message
      type: 'system',
      senderRole: 'system',
      senderUid: null,
      senderId: 'system',
      senderLabel: 'Artes Moderatie',
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  await threadIndexRef.set(
    {
      threadId,
      pinned: true,
      hidden: false,
      displayTitle: 'Artes Moderatie',
      threadType: 'support',
      lastMessageAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return threadId;
};

const parseJsonBody = (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }
  return null;
};

const claimStatuses = ['pending', 'approved', 'denied', 'needsModeration'];
const claimVoteOptions = ['yes', 'no'];
const claimTimeoutMs = 7 * 24 * 60 * 60 * 1000;

const arraysEqual = (left = [], right = []) => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const buildContributorMergePostUpdate = (postData, primaryContributorId, secondaryContributorId) => {
  const updates = {};
  let changed = false;
  let nextCredits = postData?.credits;

  if (Array.isArray(nextCredits)) {
    let creditsChanged = false;
    nextCredits = nextCredits.map((credit) => {
      if (credit?.contributorId !== secondaryContributorId) return credit;
      creditsChanged = true;
      return { ...credit, contributorId: primaryContributorId };
    });
    if (creditsChanged) {
      updates.credits = nextCredits;
      changed = true;
    }
  }

  const baseCredits = updates.credits || postData?.credits;
  let contributorIds = Array.isArray(postData?.contributorIds)
    ? postData.contributorIds.map((id) => (id === secondaryContributorId ? primaryContributorId : id)).filter(Boolean)
    : [];
  if (Array.isArray(baseCredits) && baseCredits.length > 0) {
    const derived = Array.from(new Set(baseCredits.map((credit) => credit?.contributorId).filter(Boolean)));
    if (derived.length > 0) {
      contributorIds = derived;
    }
  }
  contributorIds = Array.from(new Set(contributorIds));
  const existingContributorIds = Array.isArray(postData?.contributorIds) ? postData.contributorIds.filter(Boolean) : [];
  if (!arraysEqual(existingContributorIds, contributorIds)) {
    updates.contributorIds = contributorIds;
    changed = true;
  }

  if (changed) {
    updates.updatedAt = FieldValue.serverTimestamp();
  }

  return { changed, updates };
};

const assertMergeActorAllowed = async ({ transaction, denyActorUid, mergeFenceToken = null }) => {
  if (denyActorUid && mergeFenceToken) {
    return readAndValidateCodexDevMergeFence({ db, uid: denyActorUid, token: mergeFenceToken, transaction });
  }
  if (denyActorUid && await isKnownCodexDevActorUid({ db, uid: denyActorUid, transaction })) {
    const error = new Error('Codex Dev contributor claims are isolated.');
    error.status = 403;
    throw error;
  }
  return null;
};

const updatePostsForContributorMerge = async (primaryContributorId, secondaryContributorId, denyActorUid = null, mergeFenceToken = null) => {
  let updatedPosts = 0;
  let lastDoc = null;
  let hasMore = true;
  while (hasMore) {
    let queryRef = db.collection('posts')
      .where('contributorIds', 'array-contains', secondaryContributorId)
      .orderBy(FieldPath.documentId())
      .limit(200);
    if (lastDoc) {
      queryRef = queryRef.startAfter(lastDoc);
    }
    const snapshot = await queryRef.get();
    if (snapshot.empty) {
      hasMore = false;
      continue;
    }
    let pageUpdatedPosts = 0;
    await db.runTransaction(async (transaction) => {
      pageUpdatedPosts = 0;
      const fenceValidation = await assertMergeActorAllowed({ transaction, denyActorUid, mergeFenceToken });
      const freshDocs = [];
      for (const docSnap of snapshot.docs) {
        const freshSnap = await transaction.get(docSnap.ref);
        freshDocs.push({ ref: docSnap.ref, snap: freshSnap });
      }
      const mutationPlans = [];
      for (const { ref, snap: freshSnap } of freshDocs) {
        if (!freshSnap.exists) continue;
        const { changed, updates } = buildContributorMergePostUpdate(freshSnap.data(), primaryContributorId, secondaryContributorId);
        if (!changed) continue;
        mutationPlans.push({ ref, updates });
        pageUpdatedPosts += 1;
      }
      queueCodexDevMergeFenceRenewal({
        transaction,
        validation: fenceValidation,
        mutationCommitted: mutationPlans.length > 0,
      });
      mutationPlans.forEach(({ ref, updates }) => transaction.update(ref, updates));
    });
    updatedPosts += pageUpdatedPosts;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.size === 200;
  }
  return updatedPosts;
};

const moveContributorAliases = async (primaryContributorId, secondaryContributorId, denyActorUid = null, mergeFenceToken = null) => {
  let movedAliases = 0;
  let skippedAliases = 0;
  let lastDoc = null;
  let hasMore = true;
  while (hasMore) {
    let queryRef = db.collection('contributorAliases')
      .where('contributorId', '==', secondaryContributorId)
      .orderBy(FieldPath.documentId())
      .limit(200);
    if (lastDoc) {
      queryRef = queryRef.startAfter(lastDoc);
    }
    const snapshot = await queryRef.get();
    if (snapshot.empty) {
      hasMore = false;
      continue;
    }
    let pageMovedAliases = 0;
    let pageSkippedAliases = 0;
    await db.runTransaction(async (transaction) => {
      pageMovedAliases = 0;
      pageSkippedAliases = 0;
      const fenceValidation = await assertMergeActorAllowed({ transaction, denyActorUid, mergeFenceToken });
      const freshDocs = [];
      for (const docSnap of snapshot.docs) {
        const freshSnap = await transaction.get(docSnap.ref);
        freshDocs.push({ ref: docSnap.ref, snap: freshSnap });
      }
      const aliasesToMove = [];
      for (const { ref, snap: freshSnap } of freshDocs) {
        if (!freshSnap.exists || freshSnap.data()?.contributorId !== secondaryContributorId) {
          pageSkippedAliases += 1;
          continue;
        }
        aliasesToMove.push(ref);
        pageMovedAliases += 1;
      }
      queueCodexDevMergeFenceRenewal({
        transaction,
        validation: fenceValidation,
        mutationCommitted: aliasesToMove.length > 0,
      });
      aliasesToMove.forEach((ref) => transaction.update(ref, { contributorId: primaryContributorId }));
    });
    movedAliases += pageMovedAliases;
    skippedAliases += pageSkippedAliases;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.size === 200;
  }
  return { movedAliases, skippedAliases };
};

const mergeContributorsInternal = async ({
  primaryContributorId,
  secondaryContributorId,
  moderatorEmail,
  source,
  denyActorUid = null,
  mergeFenceToken = null,
}) => {
  if (!primaryContributorId || !secondaryContributorId) {
    const error = new Error('Missing contributor ids');
    error.status = 400;
    throw error;
  }
  if (primaryContributorId === secondaryContributorId) {
    const error = new Error('Contributor ids must be different');
    error.status = 400;
    throw error;
  }

  const primaryRef = db.collection('contributors').doc(primaryContributorId);
  const secondaryRef = db.collection('contributors').doc(secondaryContributorId);
  const [primarySnap, secondarySnap] = await Promise.all([primaryRef.get(), secondaryRef.get()]);

  if (!primarySnap.exists || !secondarySnap.exists) {
    const error = new Error('Contributor not found');
    error.status = 404;
    throw error;
  }

  const updatedPosts = await updatePostsForContributorMerge(primaryContributorId, secondaryContributorId, denyActorUid, mergeFenceToken);
  const aliasResult = await moveContributorAliases(primaryContributorId, secondaryContributorId, denyActorUid, mergeFenceToken);

  await db.runTransaction(async (transaction) => {
    const fenceValidation = await assertMergeActorAllowed({ transaction, denyActorUid, mergeFenceToken });
    queueCodexDevMergeFenceRenewal({ transaction, validation: fenceValidation, mutationCommitted: true });
    transaction.set(secondaryRef, {
      status: 'merged',
      mergedInto: primaryContributorId,
      mergedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  logger.info('Merged contributors', {
    primaryContributorId,
    secondaryContributorId,
    updatedPosts,
    movedAliases: aliasResult.movedAliases,
    skippedAliases: aliasResult.skippedAliases,
    moderatorEmail,
    source,
  });

  return {
    primaryContributorId,
    secondaryContributorId,
    updatedPosts,
    movedAliases: aliasResult.movedAliases,
    skippedAliases: aliasResult.skippedAliases,
  };
};

const fetchUserProfile = async (uid) => {
  if (!uid) return null;
  const snapshot = await db.collection('users').doc(uid).get();
  return snapshot.exists ? snapshot.data() : null;
};

const canCreateClaimRequest = (profile) => Boolean(
  profile?.ageVerified === true || (typeof profile?.onboardingStep === 'number' && profile.onboardingStep >= 2)
);

const getDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const extractDomainHint = (website) => {
  if (!website) return null;
  const raw = String(website).trim().toLowerCase();
  if (!raw) return null;
  const withProtocol = raw.includes('://') ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.hostname.replace(/^www\./, '');
  } catch (error) {
    return raw.replace(/^www\./, '').split('/')[0];
  }
};

const maskEmailHint = (email) => {
  const raw = String(email || '').trim().toLowerCase();
  if (!raw || !raw.includes('@')) return null;
  const [localPart, domainPart] = raw.split('@');
  const domainSections = domainPart.split('.');
  const domainLabel = domainSections[0] || '';
  const domainTld = domainSections.slice(1).join('.') || '';
  const maskedLocal = localPart.length <= 2
    ? `${localPart.charAt(0) || ''}*`
    : `${localPart.slice(0, 1)}***${localPart.slice(-1)}`;
  const maskedDomain = domainLabel.length <= 2
    ? `${domainLabel.charAt(0) || ''}*`
    : `${domainLabel.slice(0, 1)}***${domainLabel.slice(-1)}`;
  return `${maskedLocal}@${maskedDomain}${domainTld ? `.${domainTld}` : ''}`;
};

const normalizeInstagramHint = (handle) => {
  const raw = String(handle || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/^@+/, '');
  if (!normalized) return null;
  return `@${normalized}`;
};

const hashEmailProofToken = (token) => (
  crypto.createHash('sha256').update(String(token ?? '')).digest('hex')
);

const fetchContributorWebsiteAlias = async (contributorId) => {
  if (!contributorId) return null;
  const snapshot = await db.collection('contributorAliases')
    .where('contributorId', '==', contributorId)
    .where('type', '==', 'domain')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const docSnap = snapshot.docs[0];
  const data = docSnap.data() || {};
  const domain = normalizeDomain(data?.value || '');
  if (!domain) return null;
  return {
    aliasId: docSnap.id,
    domain,
  };
};

const resolveContributorPostAuthorUid = (post) => post?.authorUid || post?.authorId || null;

const buildEligibleVouchers = async ({ contributorId, claimantUid }) => {
  const eligible = new Set();
  const userSnapshots = await db.collection('users')
    .where('contributorId', '==', contributorId)
    .limit(20)
    .get();

  userSnapshots.forEach((docSnap) => {
    if (docSnap.id && docSnap.id !== claimantUid) {
      eligible.add(docSnap.id);
    }
  });

  const postSnapshots = await db.collection('posts')
    .where('contributorIds', 'array-contains', contributorId)
    .limit(50)
    .get();

  postSnapshots.forEach((docSnap) => {
    const authorUid = resolveContributorPostAuthorUid(docSnap.data());
    if (authorUid && authorUid !== claimantUid) {
      eligible.add(authorUid);
    }
  });

  return Array.from(eligible).slice(0, 10);
};

const normalizeSupportSenderRole = (message, threadUserUid) => {
  if (!message) return 'user';
  if (message.senderRole) return message.senderRole;
  const text = message.text || message.message || '';
  const senderUid = message.senderUid || message.senderId || null;
  if (SUPPORT_INTRO_TEXTS.includes(text)) return 'system';
  if (threadUserUid && senderUid === threadUserUid) return 'user';
  return 'moderator';
};

const createDecisionMessage = ({
  decision,
  decisionMessagePublic,
  decisionReasons = [],
  caseType = 'upload',
  uploadId = null,
  reviewCaseId = null,
  reportedPostId = null,
  ownerUid = null,
}) => ({
  senderUid: 'system',
  text: decisionMessagePublic,
  type: 'moderation_decision',
  unread: true,
  metadata: {
    decision,
    reasons: decisionReasons,
    caseType,
    uploadId,
    reviewCaseId,
    reportedPostId,
    ownerUid,
  },
});

const buildReportRemovalMessage = (baseMessage) => {
  const prefix = 'Deze foto is handmatig gerapporteerd. Na controle is de moderatie het eens met de melding en is de foto verwijderd.';
  const trimmed = String(baseMessage || '').trim();
  if (!trimmed) return prefix;
  const available = 280 - prefix.length - 1;
  if (available <= 0) return prefix;
  const suffix = trimmed.slice(0, available);
  return `${prefix} ${suffix}`;
};

const normalizeMakerTags = (makerTags) => {
  const raw = Array.isArray(makerTags)
    ? makerTags
    : typeof makerTags === 'string'
      ? makerTags.split(',')
      : [];
  const normalized = raw
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => {
      const lowered = tag.toLowerCase();
      return TRIGGER_ALIASES[lowered] || tag;
    });
  return [...new Set(normalized)];
};

const normalizeThemes = (themes) => {
  const raw = Array.isArray(themes) ? themes : [];
  return [...new Set(raw.map((theme) => String(theme).trim()).filter(Boolean))];
};

const sanitizeUploaderSnapshot = (snapshot = {}) => {
  const uid = String(snapshot?.uid || '').trim() || null;
  const displayName = String(snapshot?.displayName || '').trim() || null;
  const username = String(snapshot?.username || '').trim() || null;
  if (!uid && !displayName && !username) return null;
  return {
    ...(uid ? { uid } : {}),
    ...(displayName ? { displayName } : {}),
    ...(username ? { username } : {}),
  };
};

const buildAiSummary = (source = {}) => ({
  classification: source?.classification || null,
  shouldReview: (typeof source?.shouldReview === 'boolean') ? source.shouldReview : null,
  forbiddenReasons: Array.isArray(source?.forbiddenReasons) ? source.forbiddenReasons : [],
  appliedTriggers: Array.isArray(source?.appliedTriggers) ? source.appliedTriggers : [],
  suggestedTriggers: Array.isArray(source?.suggestedTriggers) ? source.suggestedTriggers : [],
  moderationSignals: source?.moderationSignals && typeof source.moderationSignals === 'object'
    ? {
        adultDecision: source.moderationSignals.adultDecision ?? null,
        sexualExplicitConfidence: source.moderationSignals.sexualExplicitConfidence ?? null,
        explicitDecisionBranchHit: Boolean(source.moderationSignals.explicitDecisionBranchHit),
        explicitDecisionAddedForbiddenReason: Boolean(source.moderationSignals.explicitDecisionAddedForbiddenReason),
      }
    : null,
  userSelectedTaxonomy: source?.userSelectedTaxonomy && typeof source.userSelectedTaxonomy === 'object'
    ? source.userSelectedTaxonomy
    : { themes: [], triggers: [] },
  aiSuggestedTaxonomy: source?.aiSuggestedTaxonomy && typeof source.aiSuggestedTaxonomy === 'object'
    ? source.aiSuggestedTaxonomy
    : { triggers: [] },
  aiSafetySignals: Array.isArray(source?.aiSafetySignals) ? source.aiSafetySignals : [],
  aiVisionLabels: Array.isArray(source?.aiVisionLabels) ? source.aiVisionLabels : [],
  policyAppliedTriggers: Array.isArray(source?.policyAppliedTriggers) ? source.policyAppliedTriggers : [],
  geminiDiagnostics: source?.geminiDiagnostics && typeof source.geminiDiagnostics === 'object'
    ? source.geminiDiagnostics
    : null,
});

const getUploaderSnapshotFromPublicProfile = async (uid, fallback = {}) => {
  const resolvedUid = String(uid || '').trim();
  if (!resolvedUid) return sanitizeUploaderSnapshot(fallback);
  try {
    const publicSnap = await db.collection('publicUsers').doc(resolvedUid).get();
    if (publicSnap.exists) {
      const data = publicSnap.data() || {};
      return sanitizeUploaderSnapshot({
        uid: resolvedUid,
        displayName: data.displayName || fallback?.displayName || null,
        username: data.username || fallback?.username || null,
      });
    }
  } catch (error) {
    logger.warn('Uploader snapshot uit publicUsers ophalen mislukt.', { uid: resolvedUid, error: error?.message || String(error) });
  }
  return sanitizeUploaderSnapshot({ uid: resolvedUid, ...fallback });
};

const scoreFromLikelihood = (likelihood) => likelihoodScores[likelihood] ?? 0;

const parseImageDataUrl = (image) => {
  if (typeof image !== 'string') {
    return { error: 'Image moet een base64 data-URL string zijn.' };
  }
  const match = image.match(dataUrlPattern);
  if (!match) {
    return { error: 'Image moet een geldige base64 data-URL zijn (png/jpg/webp).' };
  }
  const mimeType = `image/${match[1]}`;
  const buffer = Buffer.from(match[2], 'base64');
  return { buffer, mimeType };
};

const buildModerationPreviewStoragePath = ({ mimeType, userId, uploadId }) => {
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

const ensureJsonBody = (req) => {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }
  return null;
};

const hexBitCounts = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

const computeDhash = async (buffer) => {
  const resized = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();
  const bits = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = resized[y * 9 + x];
      const right = resized[y * 9 + x + 1];
      bits.push(left > right ? '1' : '0');
    }
  }
  const hex = [];
  for (let i = 0; i < bits.length; i += 4) {
    const chunk = bits.slice(i, i + 4).join('');
    hex.push(Number.parseInt(chunk, 2).toString(16));
  }
  return hex.join('');
};

const hammingDistance = (a, b) => {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    const xor = Number.parseInt(a[i], 16) ^ Number.parseInt(b[i], 16);
    distance += hexBitCounts[xor] || 0;
  }
  return distance;
};

const buildFingerprint = async (buffer) => {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const dhash = await computeDhash(buffer);
  return {
    sha256,
    dhash,
    dhashPrefix: dhash.slice(0, dhashPrefixLength),
  };
};

const buildFingerprintFromUrl = async (imageUrl) => {
  if (!imageUrl) return null;
  const response = await fetch(imageUrl);
  if (!response.ok) {
    const error = new Error('Kon afbeelding niet ophalen.');
    error.status = response.status;
    throw error;
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return buildFingerprint(buffer);
};

const resolveTimestamp = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getUserModeration = async (userId) => {
  if (!userId) return null;
  const ref = db.collection('userModeration').doc(userId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    const initial = {
      openReviewCount: 0,
      cooldownUntil: null,
      falseAppealCount: 0,
      reviewRightsLevel: 1,
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(initial);
    return { ref, data: initial };
  }
  return { ref, data: snapshot.data() };
};

const findOpenReviewCase = async (userId) => {
  if (!userId) return null;
  const doc = await findFirstUploadReviewCaseAcrossPages({
    fetchPage: async (cursor) => {
      let query = db
        .collection('reviewCases')
        .where('userId', '==', userId)
        .where('status', '==', 'inReview')
        .limit(20);
      if (cursor) query = query.startAfter(cursor);
      return (await query.get()).docs;
    },
  });
  return doc ? { id: doc.id, data: doc.data() } : null;
};


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

const findExactUpload = async (sha256, { isCodexActor = false, themes = [], makerTags = [], currentGeneration = 0 } = {}) => {
  const doc = await findReusableAcrossPages({
    isCodexActor,
    isReusable: (uploadData) => (
      isReusableModerationCache(uploadData, GEMINI_MODERATION_PROMPT_VERSION, currentGeneration)
      && hasMatchingReusableModerationTaxonomy({ uploadData, themes, makerTags })
    ),
    fetchPage: async (cursor) => {
      let query = db.collection('uploads').where('fingerprints.sha256', '==', sha256).limit(25);
      if (cursor) query = query.startAfter(cursor);
      return (await query.get()).docs;
    },
    select: (docs) => docs[0] || null,
  });
  if (!doc) return null;
  return { id: doc.id, data: doc.data() };
};

const findExactModerationExample = async (sha256, currentGeneration = 0) => {
  if (!sha256) return null;
  let cursor = null;
  let best = null;
  let hasMore = true;
  while (hasMore) {
    let query = db.collection('moderationExamples').where('fingerprints.sha256', '==', sha256).limit(25);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    snapshot.docs.forEach((doc) => {
      const candidate = { id: doc.id, data: doc.data() };
      if (!isUploadModerationExampleData(candidate.data)) return;
      if (!isModerationExampleGenerationRouteable(candidate.data, currentGeneration)) return;
      if (!best || compareModerationExampleCandidates(candidate, best) < 0) best = candidate;
    });
    if (snapshot.docs.length < 25) {
      hasMore = false;
    } else {
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }
  }
  return best;
};

const findNearDuplicateUpload = async ({ dhash, dhashPrefix }, { isCodexActor = false, themes = [], makerTags = [], userId = null, currentGeneration = 0 } = {}) => {
  if (!dhash) return null;
  return findBestReusableAcrossPages({
    isCodexActor,
    isReusable: (uploadData) => (
      isReusableModerationCache(uploadData, GEMINI_MODERATION_PROMPT_VERSION, currentGeneration)
      && hasMatchingReusableModerationTaxonomy({ uploadData, themes, makerTags })
      && isNearDuplicateReuseOwnedByUploader({ uploadData, userId })
    ),
    fetchPage: async (cursor) => {
      let query = db.collection('uploads').where('fingerprints.dhashPrefix', '==', dhashPrefix).limit(25);
      if (cursor) query = query.startAfter(cursor);
      return (await query.get()).docs;
    },
    selectBest: (docs) => selectNearReusableUpload({
      uploads: docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      isCodexActor,
      distanceFor: (candidate) => hammingDistance(dhash, candidate?.fingerprints?.dhash),
      threshold: dhashThreshold,
    }),
  });
};

const isFingerprintBlocked = (fingerprints, blockedFingerprints = []) => {
  if (!fingerprints || !Array.isArray(blockedFingerprints)) return false;
  if (blockedFingerprints.some((item) => item?.sha256 && item.sha256 === fingerprints.sha256)) {
    return true;
  }
  if (!fingerprints.dhash || !fingerprints.dhashPrefix) return false;
  const candidates = blockedFingerprints.filter((item) => item?.dhashPrefix === fingerprints.dhashPrefix);
  for (const candidate of candidates) {
    if (!candidate?.dhash) continue;
    const distance = hammingDistance(fingerprints.dhash, candidate.dhash);
    if (distance <= dhashThreshold) {
      return true;
    }
  }
  return false;
};

const extractLabelScore = (labels, keywords) => {
  if (!labels?.length) return 0;
  return labels.reduce((maxScore, label) => {
    const description = label.description?.toLowerCase() || '';
    if (keywords.some((keyword) => description.includes(keyword))) {
      return Math.max(maxScore, Number(label.score) || 0);
    }
    return maxScore;
  }, 0);
};

const buildTriggerRecord = (trigger, score, source) => ({ trigger, score, source });
const isVisionDiagnosticOnlyTrigger = (trigger) => VISION_DIAGNOSTIC_ONLY_TRIGGERS.has(String(trigger || '').trim());
const isVisionDiagnosticOnlyAppliedTrigger = (item) => {
  const trigger = typeof item === 'string' ? item : item?.trigger;
  return isVisionDiagnosticOnlyTrigger(trigger);
};
const normalizeArray = (value) => (Array.isArray(value) ? value : []);
const extractTriggerKey = (item) => (typeof item === 'string' ? item : item?.trigger);
const normalizeSource = (value) => String(value || '').trim().toLowerCase();
const isRawVisionSource = (value) => ['labeldetection', 'visionlabel', 'vision', 'cloudvision'].includes(normalizeSource(value));
const isRawVisionDerivedRecord = (item) => isRawVisionSource(typeof item === 'object' ? item?.source : null);
const isSourceLessLegacyDiagnosticRecord = (item) => {
  if (!item || typeof item === 'string') return isVisionDiagnosticOnlyTrigger(item);
  const hasSource = Object.prototype.hasOwnProperty.call(item, 'source') && item.source !== null && item.source !== undefined && String(item.source).trim() !== '';
  return !hasSource && isVisionDiagnosticOnlyTrigger(item?.trigger);
};
const sanitizeRawVisionDerivedRecords = (items) => normalizeArray(items)
  .filter((item) => !isRawVisionDerivedRecord(item))
  .filter((item) => !isSourceLessLegacyDiagnosticRecord(item));

const normalizeAdultDecision = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'none' || normalized === 'borderline' || normalized === 'explicit') {
    return normalized;
  }
  return null;
};

const parseGeminiJson = (text) => {
  if (!text) return null;
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    return null;
  }
};

const buildGeminiRawPreview = (text, maxLength = 400) => {
  if (typeof text !== 'string') return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}…`
    : normalized;
};

const buildGeminiDiagnostics = (overrides = {}) => ({
  attempted: false,
  success: false,
  fallbackUsed: false,
  fallbackReason: null,
  apiErrorCode: null,
  finishReason: null,
  safetyRatings: null,
  rawTextPresent: false,
  parsedJsonPresent: false,
  missingFields: [],
  model: null,
  promptVersion: 'gemini_moderation_v1',
  ...overrides,
});

const runGeminiClassifier = async ({ buffer, mimeType }) => {
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-002';
  const promptVersion = 'gemini_moderation_v1';
  if (process.env.ENABLE_GEMINI_CLASSIFIER !== 'true') {
    return {
      parsed: null,
      parseSucceeded: false,
      hasRawText: false,
      rawPreview: null,
      rawLength: 0,
      diagnostics: buildGeminiDiagnostics({ fallbackReason: 'classifier_disabled', model: modelName, promptVersion }),
    };
  }
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION || 'europe-west4';
  if (!project) {
    logger.warn('Gemini classifier skipped: GOOGLE_CLOUD_PROJECT ontbreekt.');
    return null;
  }
  const vertex = new VertexAI({ project, location });
  const model = vertex.getGenerativeModel({ model: modelName });
  const prompt = [
    'You are a moderation classifier. Return ONLY valid JSON.',
    'Schema: {"triggers": [{"trigger": string, "confidence": number, "severity": "suggest"|"forbidden"}], "forbiddenReasons": [string], "adultDecision": "none"|"borderline"|"explicit", "sexualExplicitConfidence": number}',
    'Use adultDecision="explicit" only for clear explicit sexual activity (e.g. penetration, oral sex, masturbation with explicit intent).',
    'Use adultDecision="borderline" for visible nudity/genitals without clear explicit sexual act.',
    'If uncertain between borderline and explicit, choose borderline.',
    'Only include triggers that are NOT adultArtNude, adultEroticSuggestive, nudityErotic, explicit18, needlesInjections, spidersInsects.',
    'If nothing is detected, return {"triggers": [], "forbiddenReasons": [], "adultDecision": "none", "sexualExplicitConfidence": 0}.',
  ].join('\n');

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { data: buffer.toString('base64'), mimeType } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
    },
  });

  const candidate = result?.response?.candidates?.[0] || null;
  const text = candidate?.content?.parts?.[0]?.text;
  const finishReason = candidate?.finishReason || null;
  const safetyRatings = Array.isArray(candidate?.safetyRatings)
    ? candidate.safetyRatings.map((item) => ({
        category: item?.category || null,
        probability: item?.probability || null,
        blocked: Boolean(item?.blocked),
      }))
    : null;
  const parsed = parseGeminiJson(text);
  const missingFields = [];
  if (parsed && typeof parsed === 'object') {
    if (!Object.prototype.hasOwnProperty.call(parsed, 'adultDecision')) missingFields.push('adultDecision');
    if (!Object.prototype.hasOwnProperty.call(parsed, 'sexualExplicitConfidence')) missingFields.push('sexualExplicitConfidence');
  }
  const rawTextPresent = typeof text === 'string' && text.trim().length > 0;
  const parsedJsonPresent = Boolean(parsed);
  let fallbackReason = null;
  if (!rawTextPresent) fallbackReason = 'empty_response';
  else if (!parsedJsonPresent) fallbackReason = 'malformed_json';
  else if (missingFields.length > 0) fallbackReason = 'missing_required_fields';
  return {
    parsed,
    parseSucceeded: parsedJsonPresent,
    hasRawText: rawTextPresent,
    rawPreview: buildGeminiRawPreview(text),
    rawLength: typeof text === 'string' ? text.length : 0,
    diagnostics: buildGeminiDiagnostics({
      attempted: true,
      success: parsedJsonPresent && missingFields.length === 0,
      fallbackUsed: Boolean(fallbackReason),
      fallbackReason,
      finishReason,
      safetyRatings,
      rawTextPresent,
      parsedJsonPresent,
      missingFields,
      model: modelName,
      promptVersion,
    }),
  };
};

export const moderateImage = onRequest({ cors: true, region: 'europe-west4', memory: '1GiB' }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Gebruik POST.' });
    return;
  }

  let decoded = null;
  try {
    decoded = await verifyToken(req);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to verify token' });
    return;
  }

  const body = ensureJsonBody(req);
  if (!body) {
    res.status(400).json({ error: 'Ongeldige JSON body.' });
    return;
  }

  const { image, makerTags, themes } = body;
  const includeDebug = process.env.NODE_ENV === 'development' || body?.debug === true;
  const userId = decoded.uid;
  const isCodexActor = isCodexDevForProductionDeny(decoded)
    || await isKnownCodexDevActorUid({ db, uid: decoded.uid });
  const parsed = parseImageDataUrl(image);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  let fingerprints;
  try {
    fingerprints = await buildFingerprint(parsed.buffer);
  } catch (error) {
    logger.error('Fingerprint generatie mislukt.', error);
    res.status(500).json({ error: 'Kon fingerprints niet genereren.' });
    return;
  }

  let matchedUpload = null;
  let matchedFingerprintType = null;
  let matchedModerationExample = null;
  let matchedModerationExampleFingerprintType = null;
  let userModeration = null;
  let blockedByReport = false;
  try {
    userModeration = await getUserModeration(userId);
    blockedByReport = isFingerprintBlocked(fingerprints, userModeration?.data?.blockedFingerprints);
  } catch (error) {
    logger.error('User moderation ophalen mislukt.', error);
  }

  if (blockedByReport) {
    const blockedResponse = {
      outcome: 'forbidden',
      appliedTriggers: [buildTriggerRecord('reportedContent', 1, 'manualReport')],
      suggestedTriggers: [],
      forbiddenReasons: [{ trigger: 'reportedContent', reason: 'Manual report removal', score: 1 }],
      showSuggestionUI: false,
      canRequestReview: false,
      reviewCaseId: null,
      fingerprints,
      legacy: {
        labels: [],
        isSensitive: true,
      },
    };
    if (includeDebug) {
      blockedResponse.debug = {
        path: 'blockedFingerprint',
        matchedUploadId: null,
        matchedFingerprintType: null,
        forbiddenTriggerKeys: ['reportedContent'],
        suggestedTriggerKeys: [],
      };
    }
    res.status(200).json(blockedResponse);
    return;
  }

  let requestModerationScope = null;
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
  const requestModerationGeneration = normalizeModerationGeneration(requestModerationScope.generation);
  const normalizedMakerTags = normalizeMakerTags(makerTags);
  const normalizedThemes = normalizeThemes(themes);

  try {
    matchedModerationExample = isCodexActor ? null : await findExactModerationExample(fingerprints.sha256, requestModerationGeneration);
    if (matchedModerationExample) matchedModerationExampleFingerprintType = 'sha256';

    matchedUpload = await findExactUpload(fingerprints.sha256, {
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
    }

    if (!isCodexActor && !matchedModerationExample && matchedUpload && matchedFingerprintType === 'dhash') {
      const matchedUploadSha = String(matchedUpload?.data?.fingerprints?.sha256 || '').trim();
      if (matchedUploadSha && matchedUploadSha !== fingerprints.sha256) {
        matchedModerationExample = await findExactModerationExample(matchedUploadSha, requestModerationGeneration);
        if (matchedModerationExample) matchedModerationExampleFingerprintType = 'dhash';
      }
    }

  let cachedResult = null;
  const previousExampleAction = String(matchedModerationExample?.data?.moderatorDecision?.action || '');
  const previousExampleIsFinalDecision = isFinalModerationExampleAction(previousExampleAction);
  const previousExampleIsNearDuplicate = matchedModerationExampleFingerprintType === 'dhash';
  const previousExampleRouteAllowed = !previousExampleIsNearDuplicate
    || canRouteNearDuplicateModerationExampleAction(previousExampleAction);
  const shouldRouteByPreviousExample = Boolean(matchedModerationExample?.id)
    && previousExampleIsFinalDecision
    && previousExampleRouteAllowed;
  const cachedGeminiDiagnostics = matchedUpload?.data && matchedFingerprintType === 'sha256'
    ? buildReusableCacheGeminiDiagnostics({
        uploadData: matchedUpload.data,
        expectedPromptVersion: GEMINI_MODERATION_PROMPT_VERSION,
        sourceUploadId: matchedUpload.id,
        currentGeneration: requestModerationGeneration,
      })
    : null;
  if (matchedUpload?.data && cachedGeminiDiagnostics) {
    cachedResult = {
      outcome: matchedUpload.data.outcome,
      appliedTriggers: matchedUpload.data.appliedTriggers || [],
      suggestedTriggers: matchedUpload.data.suggestedTriggers || [],
      forbiddenReasons: matchedUpload.data.forbiddenReasons || [],
      aiSafetySignals: matchedUpload.data.aiSafetySignals || [],
      aiVisionLabels: matchedUpload.data.aiVisionLabels || [],
      policyAppliedTriggers: matchedUpload.data.policyAppliedTriggers || [],
      geminiDiagnostics: cachedGeminiDiagnostics,
      reviewCaseId: resolveCachedReviewCaseIdForUploader({ uploadData: matchedUpload.data, userId, isCodexActor }),
    };
  }

  const appliedTriggers = normalizedMakerTags.map((tag) => buildTriggerRecord(tag, 1, 'makerTag'));
  const suggestedTriggers = [];
  const forbiddenReasons = [];
  let aiSafetySignals = [];

  const imageAnnotator = new ImageAnnotatorClient();
  let labels = [];
  let safeSearch = null;

  if (cachedResult) {
    labels = [];
  }

  if (!cachedResult) {
    try {
      const [safeSearchResult] = await imageAnnotator.safeSearchDetection({
        image: { content: parsed.buffer },
      });
      safeSearch = safeSearchResult.safeSearchAnnotation || null;
    } catch (error) {
      logger.error('SafeSearch detectie mislukt.', error);
    }
  }

  if (!cachedResult) {
    try {
      const [labelResult] = await imageAnnotator.labelDetection({
        image: { content: parsed.buffer },
        maxResults: 15,
      });
      labels = labelResult.labelAnnotations || [];
    } catch (error) {
      logger.error('Label detectie mislukt.', error);
    }
  }

  if (!cachedResult && safeSearch) {
    const nudityScore = scoreFromLikelihood(safeSearch.racy);
    const explicitScore = scoreFromLikelihood(safeSearch.adult);

    if (nudityScore >= forbiddenThreshold) {
      suggestedTriggers.push(buildTriggerRecord(ADULT_EROTIC_SUGGESTIVE_TRIGGER, nudityScore, 'safeSearch'));
    } else if (nudityScore >= suggestThreshold) {
      suggestedTriggers.push(buildTriggerRecord(ADULT_EROTIC_SUGGESTIVE_TRIGGER, nudityScore, 'safeSearch'));
    }

    if (explicitScore >= forbiddenThreshold) {
      suggestedTriggers.push(buildTriggerRecord(ADULT_EROTIC_SUGGESTIVE_TRIGGER, explicitScore, 'safeSearch'));
    } else if (explicitScore >= suggestThreshold) {
      suggestedTriggers.push(buildTriggerRecord(ADULT_EROTIC_SUGGESTIVE_TRIGGER, explicitScore, 'safeSearch'));
    }

    if (nudityScore >= mediumLogThreshold || explicitScore >= mediumLogThreshold) {
      logger.info('Medium log threshold bereikt.', { nudityScore, explicitScore });
    }
  }

  if (!cachedResult && normalizedThemes.includes(ART_NUDE_THEME)) {
    const hasArtNudeTrigger = appliedTriggers.some((item) => item.trigger === ADULT_ART_NUDE_TRIGGER);
    if (!hasArtNudeTrigger) {
      appliedTriggers.push(buildTriggerRecord(ADULT_ART_NUDE_TRIGGER, 1, 'themeRule'));
    }
  }

  const needlesScore = cachedResult ? 0 : extractLabelScore(labels, needlesKeywords);
  const spidersScore = cachedResult ? 0 : extractLabelScore(labels, spidersKeywords);

  if (!cachedResult) {
    if (needlesScore >= forbiddenThreshold) {
      aiSafetySignals.push({ signal: 'needlesInjections', score: needlesScore, source: 'visionLabel' });
    } else if (needlesScore >= suggestThreshold) {
      aiSafetySignals.push({ signal: 'needlesInjections', score: needlesScore, source: 'visionLabel' });
    }
  }

  if (!cachedResult) {
    if (spidersScore >= forbiddenThreshold) {
      aiSafetySignals.push({ signal: 'spidersInsects', score: spidersScore, source: 'visionLabel' });
    } else if (spidersScore >= suggestThreshold) {
      aiSafetySignals.push({ signal: 'spidersInsects', score: spidersScore, source: 'visionLabel' });
    }
  }

  if (!cachedResult && (needlesScore >= mediumLogThreshold || spidersScore >= mediumLogThreshold)) {
    logger.info('Medium log threshold labels bereikt.', { needlesScore, spidersScore });
  }

  let geminiResult = null;
  let geminiAttempted = false;
  let geminiFailed = false;
  let geminiAdultDecision = null;
  let geminiSexualExplicitConfidence = 0;
  let geminiDiagnostics = buildGeminiDiagnostics(cachedGeminiDiagnostics || {});
  let explicitDecisionBranchHit = false;
  let explicitDecisionAddedForbiddenReason = false;
  let geminiDebug = {
    parseSucceeded: false,
    hasRawText: false,
    rawPreview: null,
    rawLength: 0,
    parsedKeys: [],
    hasUsableGeminiOutput: false,
    hasTriggersArray: false,
    hasForbiddenReasonsArray: false,
    rawAdultDecision: null,
    rawSexualExplicitConfidence: null,
    normalizedAdultDecision: null,
    normalizedSexualExplicitConfidence: 0,
  };

  if (!cachedResult) {
    try {
      geminiAttempted = true;
      const geminiClassifierResult = await runGeminiClassifierV2(parsed);
      geminiResult = geminiClassifierResult?.parsed || null;
      geminiDiagnostics = buildGeminiDiagnostics({
        ...geminiDiagnostics,
        ...(geminiClassifierResult?.diagnostics || {}),
        attempted: true,
      });
      geminiDebug = {
        ...geminiDebug,
        parseSucceeded: Boolean(geminiClassifierResult?.parseSucceeded),
        hasRawText: Boolean(geminiClassifierResult?.hasRawText),
        rawPreview: geminiClassifierResult?.rawPreview || null,
        rawLength: Number(geminiClassifierResult?.rawLength) || 0,
        parsedKeys: geminiResult && typeof geminiResult === 'object' ? Object.keys(geminiResult) : [],
        rawAdultDecision: geminiResult?.adultDecision ?? null,
        rawSexualExplicitConfidence: geminiResult?.sexualExplicitConfidence ?? null,
      };
      if (geminiResult?.triggers?.length) {
        geminiResult.triggers.forEach((item) => {
          const rawTrigger = String(item.trigger || '').trim();
          const trigger = TRIGGER_ALIASES[rawTrigger.toLowerCase()] || rawTrigger;
          const confidence = Number(item.confidence) || 0;
          if (!trigger) return;
          if (item.severity === 'forbidden' && confidence >= suggestThreshold) {
            appliedTriggers.push(buildTriggerRecord(trigger, confidence, 'gemini'));
            forbiddenReasons.push({ trigger, reason: 'Gemini classifier', score: confidence });
          } else if (confidence >= suggestThreshold) {
            suggestedTriggers.push(buildTriggerRecord(trigger, confidence, 'gemini'));
          }
        });
      }
      geminiAdultDecision = normalizeAdultDecision(geminiResult?.adultDecision);
      geminiSexualExplicitConfidence = Number(geminiResult?.sexualExplicitConfidence) || 0;
      const routedGeminiForbiddenReasons = routeGeminiForbiddenReasons({
        forbiddenReasons: geminiResult?.forbiddenReasons,
        adultDecision: geminiAdultDecision,
        sexualExplicitConfidence: geminiSexualExplicitConfidence,
        forbiddenThreshold,
        sexualExplicitTrigger: INTERNAL_SEXUAL_EXPLICIT_TRIGGER,
      });
      forbiddenReasons.push(...routedGeminiForbiddenReasons.records);
      explicitDecisionAddedForbiddenReason = routedGeminiForbiddenReasons.explicitDecisionAddedForbiddenReason;
      geminiDebug = {
        ...geminiDebug,
        normalizedAdultDecision: geminiAdultDecision,
        normalizedSexualExplicitConfidence: geminiSexualExplicitConfidence,
      };
      explicitDecisionBranchHit = geminiAdultDecision === 'explicit';
    } catch (error) {
      geminiFailed = true;
      geminiDiagnostics = buildGeminiDiagnostics({
        ...geminiDiagnostics,
        attempted: true,
        success: false,
        fallbackUsed: true,
        fallbackReason: 'api_error',
        apiErrorCode: error?.code ? String(error.code) : null,
      });
      logger.error('Gemini classifier fout.', error);
    }

    const hasUsableGeminiOutput = Boolean(
      geminiResult
      && (
        Array.isArray(geminiResult.triggers)
        || Array.isArray(geminiResult.forbiddenReasons)
        || geminiAdultDecision !== null
        || geminiSexualExplicitConfidence > 0
      )
    );
    geminiDebug = {
      ...geminiDebug,
      hasTriggersArray: Array.isArray(geminiResult?.triggers),
      hasForbiddenReasonsArray: Array.isArray(geminiResult?.forbiddenReasons),
      hasUsableGeminiOutput,
    };

    const geminiUnavailableOrUnusable = geminiFailed || !geminiResult || !hasUsableGeminiOutput;
    const adultSafeSearchScore = safeSearch ? scoreFromLikelihood(safeSearch.adult) : 0;
    const racySafeSearchScore = safeSearch ? scoreFromLikelihood(safeSearch.racy) : 0;
    const hasStrongAdultSafeSearchSignal = adultSafeSearchScore >= forbiddenThreshold;
    if (geminiAttempted && geminiUnavailableOrUnusable && hasStrongAdultSafeSearchSignal) {
      if (!geminiDiagnostics.fallbackReason) {
        geminiDiagnostics = buildGeminiDiagnostics({
          ...geminiDiagnostics,
          attempted: geminiAttempted,
          fallbackUsed: true,
          fallbackReason: geminiFailed ? 'api_error_or_timeout' : 'unusable_output',
          rawTextPresent: Boolean(geminiDebug.hasRawText),
          parsedJsonPresent: Boolean(geminiDebug.parseSucceeded),
        });
      }
      suggestedTriggers.push(
        buildTriggerRecord('gemini_uncertain_fallback', adultSafeSearchScore, 'geminiFallback')
      );
    }

  }

  const policyResult = composeModerationPolicyResult({
    cachedResult,
    appliedTriggers,
    suggestedTriggers,
    forbiddenReasons,
    aiSafetySignals,
    rawVisionLabels: labels.map((label) => label?.description).filter(Boolean),
    normalizedThemes,
    normalizedMakerTags,
    geminiAdultDecision,
    geminiSexualExplicitConfidence,
    explicitDecisionBranchHit,
    explicitDecisionAddedForbiddenReason,
    shouldRouteByPreviousExample,
    matchedModerationExample,
    safeSearchAdultScore: safeSearch ? scoreFromLikelihood(safeSearch.adult) : 0,
    safeSearchNudityScore: safeSearch ? scoreFromLikelihood(safeSearch.racy) : 0,
    forbiddenThreshold,
    mediumLogThreshold,
    geminiDiagnostics,
  });

  const finalAppliedTriggers = policyResult.appliedTriggers;
  const finalSuggestedTriggers = policyResult.suggestedTriggers;
  const finalForbiddenReasons = policyResult.forbiddenReasons;
  const finalPolicyAppliedTriggers = policyResult.policyAppliedTriggers;
  const aiVisionLabels = policyResult.aiVisionLabels;
  aiSafetySignals = policyResult.aiSafetySignals;
  let reviewCaseId = null;
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

  const previousModeratorExample = policyResult.previousModeratorExample;
  const effectiveShouldReview = policyRequiresReview;
  const outcome = policyResult.outcome;
  const requiredThemes = policyResult.requiredThemes;
  const autoAppliedTriggers = policyResult.autoAppliedTriggers;
  const classification = policyResult.classification;
  const forbiddenOutcome = outcome === 'forbidden';
  const publishBlocked = Boolean(policyResult.publishBlocked || forbiddenOutcome);
  const userMessage = forbiddenOutcome
    ? (classification === 'disallowed_sexual_explicit'
      ? 'Deze publicatie is geblokkeerd: Pornografisch / Seksueel expliciet.'
      : classification === 'disallowed_moderator_rejected'
        ? 'Deze publicatie is geblokkeerd op basis van een eerdere moderatiebeslissing.'
        : 'Deze publicatie is geblokkeerd door de safety check.')
    : outcome === 'needsCorrection'
      ? 'Pas de door de moderator gevraagde categoriecorrectie toe voordat je publiceert.'
      : requiredThemes.length > 0
      ? 'Deze content is toegestaan, maar voeg eerst het thema Art Nude toe voordat je publiceert.'
      : effectiveShouldReview
        ? (finalForbiddenReasons.some((reason) => reason?.reason === 'sexual_explicit_uncertain')
          ? 'Deze content kan seksueel expliciet zijn en moet eerst handmatig worden beoordeeld.'
          : 'Deze content moet eerst handmatig worden beoordeeld voordat je kunt publiceren.')
        : autoAppliedTriggers.length > 0
          ? 'Deze content is toegestaan met 18+ labeling.'
          : 'AI-check: toegestaan. Je kunt publiceren.';

  const response = {
    outcome,
    appliedTriggers: finalAppliedTriggers,
    suggestedTriggers: finalSuggestedTriggers,
    forbiddenReasons: finalForbiddenReasons,
    showSuggestionUI: finalSuggestedTriggers.length > 0 || outcome === 'needsCorrection',
    canRequestReview,
    reviewCaseId,
    classification,
    publishBlocked,
    requiredThemes,
    autoAppliedTriggers,
    shouldReview: effectiveShouldReview,
    userMessage,
    moderationSignals: policyResult.moderationSignals,
    geminiDiagnostics,
    userSelectedTaxonomy: policyResult.userSelectedTaxonomy,
    moderationGeneration: requestModerationGeneration,
    moderationScopeKey: requestModerationScope.scopeKey,
    moderatorCorrectionApplied: Boolean(policyResult.moderatorCorrectionApplied),
    moderatorCorrectedTaxonomy: policyResult.moderatorCorrectedTaxonomy,
    aiSuggestedTaxonomy: policyResult.aiSuggestedTaxonomy,
    aiSafetySignals,
    aiVisionLabels,
    policyAppliedTriggers: finalPolicyAppliedTriggers,
  };

  const uploadRef = db.collection('uploads').doc();
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
        publicationState: PUBLICATION_STATES.pending,
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

      let automaticReviewUploaderSnapshot = null;
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
          // The transactionally observed upload-review case is capacity authority.
          // openReviewCount is a mirrored counter and may be stale after legacy failures.
          const effectiveOpenReviewCount = transactionOpenReviewCase ? 1 : 0;
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
    const durablePersistenceError = new Error('Moderation result could not be durably persisted');
    durablePersistenceError.status = Number(error?.status) >= 400 && Number(error?.status) < 600
      ? Number(error.status)
      : 500;
    durablePersistenceError.code = error?.code || 'moderation_upload_persistence_failed';
    throw durablePersistenceError;
  }

  canRequestReview = Boolean(uploadId)
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

  response.uploadId = uploadId;
  response.previewField = previewField;

  if (includeDebug) {
    response.debug = {
      path: blockedByReport
        ? 'blockedFingerprint'
        : cachedResult && matchedFingerprintType === 'sha256'
          ? 'exactReuse'
          : cachedResult && matchedFingerprintType === 'dhash'
            ? 'nearReuse'
            : matchedUpload
              ? 'matchedUploadFreshEvaluation'
              : 'freshEvaluation',
      matchedUploadId: matchedUpload?.id || null,
      matchedModerationExampleId: matchedModerationExample?.id || null,
      matchedFingerprintType,
      matchedModerationExampleFingerprintType,
      forbiddenTriggerKeys: finalForbiddenReasons.map((reason) => reason?.trigger).filter(Boolean),
      suggestedTriggerKeys: finalSuggestedTriggers.map((item) => item?.trigger).filter(Boolean),
      geminiDebug: {
        ...geminiDebug,
        geminiAttempted,
        geminiFailed,
      },
      geminiDiagnostics,
      moderationGeneration: requestModerationGeneration,
      moderationScopeKey: requestModerationScope.scopeKey,
    };
  }

  res.status(200).json(response);
  } catch (error) {
    logger.error('moderateImage fout.', error);
    const status = Number(error?.status) || 500;
    res.status(status).json({
      error: error?.message || 'Moderatie mislukt.',
      ...(error?.code ? { code: error.code } : {}),
    });
  }
});

export const isModerator = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    const { moderatorEmails } = await getModeratorConfig();
    const email = decoded?.email?.toLowerCase() || '';
    const isAllowed = Boolean(email && decoded?.email_verified && moderatorEmails.includes(email));
    res.status(200).json({ isModerator: isAllowed });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to verify moderator' });
  }
});



export const createDmThread = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    const body = parseJsonBody(req);
    const recipientUid = body?.recipientUid;
    if (!recipientUid || recipientUid === decoded.uid) {
      res.status(400).json({ error: 'Invalid recipientUid' });
      return;
    }
    if (isCodexDevForProductionDeny(decoded)
      || await isKnownCodexDevActorUid({ db, uid: decoded.uid })
      || await isKnownCodexDevActorUid({ db, uid: recipientUid })) {
      res.status(403).json({ error: 'Codex Dev direct messages are isolated.' });
      return;
    }

    const participantPair = [decoded.uid, recipientUid].sort();
    const dmKey = participantPair.join('_');
    const canonicalThreadId = `dm_${dmKey}`;
    const canonicalRef = db.collection('threads').doc(canonicalThreadId);

    const canonicalSnap = await canonicalRef.get();
    if (canonicalSnap.exists) {
      const canonicalData = canonicalSnap.data() || {};
      const canonicalParticipants = Array.isArray(canonicalData?.participantUids)
        ? [...canonicalData.participantUids].sort()
        : [];
      if (canonicalData?.type === 'dm' && arraysEqual(canonicalParticipants, participantPair)) {
        res.status(200).json({ threadId: canonicalThreadId });
        return;
      }
    }

    const existingSnap = await db.collection('threads')
      .where('type', '==', 'dm')
      .where('dmKey', '==', dmKey)
      .get();
    if (!existingSnap.empty) {
      const pickTimestamp = (data, key) => {
        const value = data?.[key];
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (value?._seconds) return value._seconds * 1000;
        return 0;
      };
      const sorted = [...existingSnap.docs].sort((left, right) => {
        if (left.id === canonicalThreadId && right.id !== canonicalThreadId) return -1;
        if (right.id === canonicalThreadId && left.id !== canonicalThreadId) return 1;
        const leftData = left.data() || {};
        const rightData = right.data() || {};
        const byLastMessageAt = pickTimestamp(rightData, 'lastMessageAt') - pickTimestamp(leftData, 'lastMessageAt');
        if (byLastMessageAt !== 0) return byLastMessageAt;
        const byCreatedAt = pickTimestamp(rightData, 'createdAt') - pickTimestamp(leftData, 'createdAt');
        if (byCreatedAt !== 0) return byCreatedAt;
        return left.id.localeCompare(right.id);
      });
      res.status(200).json({ threadId: sorted[0].id });
      return;
    }

    const [senderPublicSnap, recipientPublicSnap] = await Promise.all([
      db.collection('publicUsers').doc(decoded.uid).get(),
      db.collection('publicUsers').doc(recipientUid).get(),
    ]);
    if (!senderPublicSnap.exists || !isAvailablePersonalPublicProfile(senderPublicSnap.data())) {
      res.status(403).json({ error: 'Je profiel is niet beschikbaar.' });
      return;
    }
    if (!recipientPublicSnap.exists || !isAvailablePersonalPublicProfile(recipientPublicSnap.data())) {
      res.status(404).json({ error: 'Profiel is niet beschikbaar.' });
      return;
    }

    const senderPublic = senderPublicSnap.data() || {};
    const recipientPublic = recipientPublicSnap.data() || {};
    const senderTitle = resolveDisplayTitle(recipientPublic);
    const recipientTitle = resolveDisplayTitle(senderPublic);
    const senderIndexRef = db.collection('users').doc(decoded.uid).collection('threadIndex').doc(canonicalThreadId);
    const recipientIndexRef = db.collection('users').doc(recipientUid).collection('threadIndex').doc(canonicalThreadId);
    await db.runTransaction(async (transaction) => {
      const [senderDenied, recipientDenied] = await Promise.all([
        isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction }),
        isKnownCodexDevActorUid({ db, uid: recipientUid, transaction }),
      ]);
      if (senderDenied || recipientDenied) {
        const error = new Error('Codex Dev direct messages are isolated.');
        error.status = 403;
        throw error;
      }
      const existingCanonicalSnap = await transaction.get(canonicalRef);
      if (existingCanonicalSnap.exists) {
        const existingData = existingCanonicalSnap.data() || {};
        const existingParticipants = Array.isArray(existingData?.participantUids)
          ? [...existingData.participantUids].sort()
          : [];
        if (existingData?.type !== 'dm' || !arraysEqual(existingParticipants, participantPair)) {
          const error = new Error('Canonical DM thread id conflict');
          error.status = 409;
          throw error;
        }
        return;
      }
      transaction.create(canonicalRef, {
        type: 'dm',
        participantUids: [decoded.uid, recipientUid],
        dmKey,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageText: '',
        lastSenderUid: decoded.uid,
      });
      transaction.set(senderIndexRef, {
          threadId: canonicalThreadId,
          pinned: false,
          hidden: false,
          displayTitle: senderTitle,
          lastMessageAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      transaction.set(recipientIndexRef, {
          threadId: canonicalThreadId,
          pinned: false,
          hidden: false,
          displayTitle: recipientTitle,
          lastMessageAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    });

    res.status(200).json({ threadId: canonicalThreadId });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to create dm thread' });
  }
});

export const resetPersonalOnboarding = onCall({ region: 'europe-west4' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (isCodexDevForProductionDeny({ uid, ...(request.auth?.token || {}) })) {
    throw new HttpsError('permission-denied', 'Codex Dev identity cannot be reset.');
  }
  if (await isKnownCodexDevActorUid({ db, uid })) {
    throw new HttpsError('permission-denied', 'Codex Dev identity cannot be reset.');
  }
  return resetPersonalOnboardingAtomically({ db, uid, onboardingStep: 2 });
});

export const createDevCodexToken = onRequest({ cors: true, region: 'europe-west4', secrets: [codexDevLoginSecret] }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const requestSecret = req.get('x-codex-dev-secret');
  if (!isValidCodexDevLoginSecret(requestSecret, codexDevLoginSecret.value())) {
    res.status(403).json({ error: 'Codex dev login is unavailable', code: 'forbidden_secret' });
    return;
  }

  const devLoginDecision = getCodexDevLoginDecision();
  if (!devLoginDecision.allowed) {
    res.status(403).json({
      error: 'Codex dev login is unavailable',
      code: devLoginDecision.code,
      ...(shouldExposeCodexDevLoginDiagnostics(req) ? {
        diagnostics: getCodexDevLoginDiagnostics(),
      } : {}),
    });
    return;
  }

  try {
    const uid = resolveCodexDevUid();
    await ensureCodexDevProfileState(uid);
    const token = await admin.auth().createCustomToken(uid, {
      devCodex: true,
      devActor: CODEX_DEV_ACTOR,
    });
    res.status(200).json({ ok: true, uid, token });
  } catch (error) {
    logger.error('createDevCodexToken failed', error);
    res.status(500).json({ error: 'Failed to create Codex dev token' });
  }
});

export const archiveDmThread = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)
      || await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev direct messages are isolated.' });
      return;
    }
    const body = parseJsonBody(req);
    const threadId = String(body?.threadId || '').trim();
    if (!threadId) {
      res.status(400).json({ error: 'threadId is required' });
      return;
    }

    const threadRef = db.collection('threads').doc(threadId);
    const indexRef = db.collection('users').doc(decoded.uid).collection('threadIndex').doc(threadId);
    let indexFound = false;
    await db.runTransaction(async (transaction) => {
      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {
        const error = new Error('Codex Dev direct messages are isolated.');
        error.status = 403;
        throw error;
      }
      const [threadSnap, indexSnap] = await Promise.all([
        transaction.get(threadRef),
        transaction.get(indexRef),
      ]);
      if (!threadSnap.exists) {
        const error = new Error('Thread not found');
        error.status = 404;
        throw error;
      }
      const threadData = threadSnap.data() || {};
      if (threadData?.type !== 'dm') {
        const error = new Error('Only DM threads can be archived');
        error.status = 400;
        throw error;
      }
      const participants = Array.isArray(threadData?.participantUids) ? threadData.participantUids : [];
      if (!participants.includes(decoded.uid)) {
        const error = new Error('Not a participant');
        error.status = 403;
        throw error;
      }
      indexFound = indexSnap.exists;
      if (indexSnap.exists) {
        transaction.set(indexRef, { hidden: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    });

    res.status(200).json({ ok: true, threadId, indexFound });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to archive dm thread' });
  }
});


export const dismissSupportThread = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    await ensureModerator(decoded);

    const body = parseJsonBody(req);
    const threadId = String(body?.threadId || '').trim();
    if (!threadId) {
      res.status(400).json({ error: 'threadId is required' });
      return;
    }

    const threadRef = db.collection('threads').doc(threadId);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const threadData = threadSnap.data() || {};
    if (threadData?.type !== 'support') {
      res.status(400).json({ error: 'Only support threads can be dismissed' });
      return;
    }

    await threadRef.set({
      hasUserMessage: false,
      unreadForModerator: 0,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    res.status(200).json({ ok: true, threadId });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to dismiss support thread' });
  }
});

export const resetSupportThread = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)
      || await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev support traffic is isolated.' });
      return;
    }
    const body = parseJsonBody(req);
    const requestedThreadId = String(body?.threadId || '').trim();
    const fallbackThreadId = `support_${decoded.uid}`;
    const threadId = requestedThreadId || fallbackThreadId;

    const threadRef = db.collection('threads').doc(threadId);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    const threadData = threadSnap.data() || {};
    if (threadData?.type !== 'support') {
      res.status(400).json({ error: 'Only support threads can be reset' });
      return;
    }

    const isOwner = threadData?.userUid === decoded.uid;
    let isModeratorRequest = false;
    if (!isOwner) {
      try {
        await ensureModerator(decoded);
        isModeratorRequest = true;
      } catch (_error) {
        isModeratorRequest = false;
      }
    }
    if (!isOwner && !isModeratorRequest) {
      res.status(403).json({ error: 'Not authorized to reset this support thread' });
      return;
    }

    const userUid = threadData?.userUid;
    if (!userUid) {
      res.status(400).json({ error: 'Support thread is missing userUid' });
      return;
    }

    const supportResetFenceToken = crypto.randomUUID();
    await acquireCodexDevLifecycleFence({
      db, uid: decoded.uid, token: supportResetFenceToken, operation: 'resetSupportThread',
    });
    try {
    const messagesRef = threadRef.collection('messages');
    let keptIntroRef = null;
    let hasMoreMessages = true;
    while (hasMoreMessages) {
      const snapshot = await messagesRef.limit(400).get();
      if (snapshot.empty) {
        hasMoreMessages = false;
        continue;
      }
      const pageResult = await deleteSupportResetMessagesPageAtomically({
        db,
        actorUid: decoded.uid,
        fenceToken: supportResetFenceToken,
        threadRef,
        expectedUserUid: userUid,
        isModeratorRequest,
        messageDocs: snapshot.docs,
        keptIntroRef,
        introTexts: SUPPORT_INTRO_TEXTS,
      });
      keptIntroRef = pageResult.keptIntroRef || keptIntroRef;
      hasMoreMessages = pageResult.deletesInRound > 0 && snapshot.size === 400;
    }

    const indexRef = db.collection('users').doc(userUid).collection('threadIndex').doc(threadId);
    const introRef = keptIntroRef || messagesRef.doc();
    await db.runTransaction(async (transaction) => {
      await readAndValidateCodexDevLifecycleFence({
        db,
        uid: decoded.uid,
        token: supportResetFenceToken,
        transaction,
        operation: 'resetSupportThread',
      });
      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {
        const error = new Error('Codex Dev support traffic is isolated.');
        error.status = 403;
        throw error;
      }
      const freshThreadSnap = await transaction.get(threadRef);
      if (!freshThreadSnap.exists) {
        const error = new Error('Thread not found');
        error.status = 404;
        throw error;
      }
      const freshThreadData = freshThreadSnap.data() || {};
      if (freshThreadData?.type !== 'support' || freshThreadData?.userUid !== userUid) {
        const error = new Error('Support thread changed during reset');
        error.status = 409;
        throw error;
      }
      if (freshThreadData.userUid !== decoded.uid && !isModeratorRequest) {
        const error = new Error('Not authorized to reset this support thread');
        error.status = 403;
        throw error;
      }

      if (!keptIntroRef) {
        transaction.set(introRef, {
          text: SUPPORT_INTRO_MESSAGE,
          type: 'system',
          senderRole: 'system',
          senderUid: null,
          senderId: 'system',
          senderLabel: 'Artes Moderatie',
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.update(threadRef, {
        type: 'support',
        title: 'Artes Moderatie',
        threadKey: freshThreadData?.threadKey || threadId,
        userUid,
        participantUids: [userUid],
        hasUserMessage: false,
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessagePreview: SUPPORT_INTRO_MESSAGE,
        unreadForModerator: 0,
        unreadForUser: 0,
        userMaySend: true,
        userCanSend: true,
        userMessageAllowance: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(indexRef, {
        threadId,
        type: 'support',
        threadType: 'support',
        pinned: true,
        hidden: false,
        displayTitle: 'Artes Moderatie',
        lastMessageAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    } finally {
      await releaseCodexDevLifecycleFence({ db, uid: decoded.uid, token: supportResetFenceToken });
    }
    res.status(200).json({ ok: true, threadId, resetBy: isOwner ? 'owner' : 'moderator' });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to reset support thread' });
  }
});

export const sendDmMessage = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)) {
      res.status(403).json({ error: 'Codex Dev direct messages are isolated.' });
      return;
    }
    const body = parseJsonBody(req);
    const threadId = body?.threadId;
    const text = String(body?.text || '').trim();
    if (!threadId || !text) {
      res.status(400).json({ error: 'threadId and text are required' });
      return;
    }
    if (text.length > 2000) {
      res.status(400).json({ error: 'Message too long' });
      return;
    }

    const threadRef = db.collection('threads').doc(threadId);
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const threadData = threadSnap.data();
    if (threadData?.type !== 'dm') {
      res.status(403).json({ error: 'Cannot send message to system thread' });
      return;
    }
    const participantUids = Array.isArray(threadData?.participantUids) ? threadData.participantUids : null;
    const legacyParticipants = Array.isArray(threadData?.participants) ? threadData.participants : [];
    const codexScanParticipants = [...new Set([
      ...(participantUids || []),
      ...legacyParticipants,
    ].filter((uid) => typeof uid === 'string' && uid))];
    const knownCodexParticipant = (await Promise.all(codexScanParticipants.map((uid) => (
      isKnownCodexDevActorUid({ db, uid })
    )))).some(Boolean);
    if (knownCodexParticipant) {
      res.status(403).json({ error: 'Codex Dev direct messages are retired.' });
      return;
    }
    const authorizedParticipants = (participantUids || legacyParticipants)
      .filter((uid) => typeof uid === 'string' && uid);
    if (!authorizedParticipants.includes(decoded.uid)) {
      res.status(403).json({ error: 'Not a participant' });
      return;
    }

    const publicUsers = await Promise.all(authorizedParticipants.map((uid) => fetchPublicUser(uid)));
    const publicUsersByUid = new Map(authorizedParticipants.map((uid, index) => [uid, publicUsers[index] || null]));
    const messageRef = threadRef.collection('messages').doc();
    const now = FieldValue.serverTimestamp();

    await db.runTransaction(async (transaction) => {
      const freshThreadSnap = await transaction.get(threadRef);
      if (!freshThreadSnap.exists) {
        const error = new Error('Thread not found');
        error.status = 404;
        throw error;
      }
      const freshThreadData = freshThreadSnap.data() || {};
      if (freshThreadData?.type !== 'dm') {
        const error = new Error('Cannot send message to system thread');
        error.status = 403;
        throw error;
      }
      const freshParticipantUids = Array.isArray(freshThreadData?.participantUids)
        ? freshThreadData.participantUids
        : null;
      const freshLegacyParticipants = Array.isArray(freshThreadData?.participants)
        ? freshThreadData.participants
        : [];
      const freshCodexScanParticipants = [...new Set([
        ...(freshParticipantUids || []),
        ...freshLegacyParticipants,
      ].filter((uid) => typeof uid === 'string' && uid))];
      const freshAuthorizedParticipants = (freshParticipantUids || freshLegacyParticipants)
        .filter((uid) => typeof uid === 'string' && uid);
      const hasKnownCodexParticipant = (await Promise.all(freshCodexScanParticipants.map((uid) => (
        isKnownCodexDevActorUid({ db, uid, transaction })
      )))).some(Boolean);
      if (hasKnownCodexParticipant) {
        const error = new Error('Codex Dev direct messages are retired.');
        error.status = 403;
        throw error;
      }
      if (!freshAuthorizedParticipants.includes(decoded.uid)) {
        const error = new Error('Not a participant');
        error.status = 403;
        throw error;
      }

      transaction.set(messageRef, {
        senderId: decoded.uid,
        senderUid: decoded.uid,
        senderRole: 'user',
        text,
        type: 'text',
        createdAt: now,
      });
      transaction.update(threadRef, {
        updatedAt: now,
        lastMessageAt: now,
        lastMessageText: text,
        lastSenderUid: decoded.uid,
      });
      freshAuthorizedParticipants.forEach((uid) => {
        const otherUid = freshAuthorizedParticipants.find((participantUid) => participantUid !== uid) || uid;
        const otherPublic = publicUsersByUid.get(otherUid) || null;
        const indexRef = db.collection('users').doc(uid).collection('threadIndex').doc(threadId);
        transaction.set(indexRef, {
          threadId,
          pinned: false,
          hidden: false,
          displayTitle: resolveDisplayTitle(otherPublic),
          lastMessageAt: now,
        }, { merge: true });
      });
    });

    res.status(200).json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to send message' });
  }
});

export const sendSupportMessage = onRequest({ cors: false, region: 'europe-west4' }, async (req, res) => {
  setCorsHeaders(req, res);
  
  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    logger.info('sendSupportMessage: Received POST request', { origin: req.get('origin') });
    
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)) {
      res.status(403).json({ error: 'Codex Dev support traffic is isolated.' });
      return;
    }
    if (await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev support traffic is isolated.' });
      return;
    }
    logger.info('sendSupportMessage: Token verified', { uid: decoded.uid });
    
    const body = parseJsonBody(req);
    const threadId = body?.threadId || `support_${decoded.uid}`;
    const text = String(body?.text || '').trim();
    
    if (!threadId || !text) {
      logger.warn('sendSupportMessage: Missing required fields', { threadId, textLength: text?.length });
      res.status(400).json({ error: 'threadId and text are required' });
      return;
    }
    
    if (text.length > 2000) {
      logger.warn('sendSupportMessage: Message too long', { textLength: text.length });
      res.status(400).json({ error: 'Message too long' });
      return;
    }

    const threadRef = db.collection('threads').doc(threadId);
    await db.runTransaction(async (transaction) => {
      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {
        const error = new Error('Codex Dev support traffic is isolated.');
        error.status = 403;
        throw error;
      }
      const threadSnap = await transaction.get(threadRef);
      if (!threadSnap.exists) {
        const error = new Error('Thread not found');
        error.status = 404;
        throw error;
      }
      const threadData = threadSnap.data();
      if (threadData?.type !== 'support' || threadData?.userUid !== decoded.uid) {
        const error = new Error('Not authorized for support thread');
        error.status = 403;
        throw error;
      }

      // Count only real user messages (senderRole === 'user' or legacy fallback)
      const messagesSnap = await transaction.get(threadRef.collection('messages'));
      let userMessageCount = 0;
      let hasModeratorReply = false;

      messagesSnap.docs.forEach((doc) => {
        const msg = doc.data();
        const senderRole = normalizeSupportSenderRole(msg, threadData?.userUid);

        if (senderRole === 'user') {
          userMessageCount++;
        }
        
        if (senderRole === 'moderator') {
          hasModeratorReply = true;
        }
      });

      if (process.env.NODE_ENV === 'development') {
        logger.info('sendSupportMessage: Throttle check', {
          uid: decoded.uid,
          threadId,
          userMessageCount,
          hasModeratorReply,
          userCanSend: threadData?.userMaySend ?? threadData?.userCanSend,
        });
      }

      // User can send if: they haven't sent yet OR moderator has replied
      const canSendMessage = userMessageCount === 0 || hasModeratorReply;
      if (!canSendMessage) {
        const error = new Error('User may not send yet');
        error.status = 403;
        throw error;
      }

      const publicProfile = await fetchPublicUser(decoded.uid);
      const senderLabel = publicProfile?.displayName || publicProfile?.username || 'Gebruiker';
      const messageRef = threadRef.collection('messages').doc();
      transaction.set(messageRef, {
        text,
        senderUid: decoded.uid,
        senderId: decoded.uid,
        senderRole: 'user',
        senderLabel,
        type: 'text',
        createdAt: FieldValue.serverTimestamp(),
      });

      if (process.env.NODE_ENV === 'development') {
        logger.info('sendSupportMessage: User message stored', {
          uid: decoded.uid,
          threadId,
          senderUid: decoded.uid,
          messageLength: text.length,
          newUserMessageCount: userMessageCount + 1,
        });
      }

      transaction.update(threadRef, {
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessagePreview: text,
        hasUserMessage: true,
        userMaySend: false,
        userCanSend: false,
        userMessageAllowance: 0,
        unreadForModerator: (threadData?.unreadForModerator || 0) + 1,
        unreadForUser: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    logger.info('sendSupportMessage: Message sent successfully', { uid: decoded.uid });
    res.status(200).json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    logger.error('sendSupportMessage: Error', { status, error: error.message });
    res.status(status).json({ error: error.message || 'Failed to send support message' });
  }
});

export const reportPost = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)) {
      res.status(403).json({ error: 'Codex Dev reports are isolated.' });
      return;
    }
    if (await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev reports are isolated.' });
      return;
    }
    requireVerifiedPasswordUser(decoded);
    const body = parseJsonBody(req);
    const {
      postId,
      imageUrl,
      title = null,
      authorId = null,
      authorName = null,
      contributorUids = [],
    } = body || {};
    if (!postId || !imageUrl) {
      res.status(400).json({ error: 'postId and imageUrl are required' });
      return;
    }
    const normalizedContributors = Array.isArray(contributorUids)
      ? [...new Set(contributorUids.filter(Boolean))]
      : [];
    const reportedPostPath = buildReportedPostPath(postId);
    let reportedFingerprints = null;
    try {
      reportedFingerprints = await buildFingerprintFromUrl(imageUrl);
    } catch (error) {
      logger.error('Reported image fingerprint mislukt.', error);
    }

    const uploaderSnapshot = await getUploaderSnapshotFromPublicProfile(authorId || null, {
      uid: authorId || null,
      displayName: authorName || null,
    });

    const reviewRef = db.collection('reviewCases').doc();
    await db.runTransaction(async (transaction) => {
      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {
        const error = new Error('Codex Dev reports are isolated.');
        error.status = 403;
        throw error;
      }
      transaction.create(reviewRef, {
        caseType: 'report',
        status: 'inReview',
        decision: null,
        userId: authorId || null,
        ...(uploaderSnapshot ? { uploaderSnapshot } : {}),
        reviewReason: 'reportedPost',
        reportedPost: {
          id: postId,
          imageUrl,
          title,
          authorId: authorId || null,
          authorName: authorName || null,
        },
        reportedPostPath: reportedPostPath || null,
        contributorUids: normalizedContributors,
        reportedFingerprints,
        reportedByUid: decoded.uid,
        reportedByEmail: decoded.email || null,
        reportedByName: decoded.name || null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    res.status(200).json({ ok: true, reviewCaseId: reviewRef.id });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to report post' });
  }
});

export const requestUploadReviewCase = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)) {
      res.status(403).json({ error: 'Codex Dev review cases are isolated.' });
      return;
    }
    if (await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev review cases are isolated.' });
      return;
    }
    const body = parseJsonBody(req);
    const uploadId = String(body?.uploadId || '').trim();
    if (!uploadId) {
      res.status(400).json({ error: 'uploadId is required' });
      return;
    }

    const manualUserModeration = await getUserModeration(decoded.uid);

    const uploadRef = db.collection('uploads').doc(uploadId);
    const uploadSnapshot = await uploadRef.get();
    if (!uploadSnapshot.exists) {
      res.status(404).json({ error: 'Upload not found' });
      return;
    }

    const uploadData = uploadSnapshot.data() || {};
    const uploadOwnerId = uploadData.userId || uploadData.ownerUid || uploadData.userUid || null;
    if (uploadOwnerId !== decoded.uid) {
      res.status(403).json({ error: 'Not authorized for this upload' });
      return;
    }

    const postDraftInput = body?.postDraft && typeof body.postDraft === 'object'
      ? body.postDraft
      : null;
    const postDraftAuthorProfile = postDraftInput
      ? await resolveAuthorProfileForUid(decoded.uid, postDraftInput.authorProfileId)
      : null;
    let postDraft = null;
    if (postDraftInput) {
      const draftState = buildPersistedModerationDraftState({
        upload: uploadData,
        draft: {
          ...postDraftInput,
          title: String(postDraftInput.title || '').trim(),
          description: String(postDraftInput.description || postDraftInput.caption || '').trim(),
          authorProfileId: postDraftAuthorProfile.profileId,
          authorOwnerUid: decoded.uid,
          authorName: String(postDraftInput.authorName || postDraftAuthorProfile?.displayName || '').trim(),
          authorRole: String(postDraftInput.authorRole || '').trim(),
          styles: Array.isArray(postDraftInput.styles)
            ? postDraftInput.styles.filter(Boolean)
            : Array.isArray(postDraftInput.themes)
              ? postDraftInput.themes.filter(Boolean)
              : [],
          makerTags: Array.isArray(postDraftInput.makerTags) ? postDraftInput.makerTags.filter(Boolean) : [],
          appliedTriggers: Array.isArray(postDraftInput.appliedTriggers) ? postDraftInput.appliedTriggers.filter(Boolean) : [],
          credits: Array.isArray(postDraftInput.credits)
            ? postDraftInput.credits.filter(Boolean)
            : Array.isArray(postDraftInput.contributors)
              ? postDraftInput.contributors.filter(Boolean)
              : [],
          isChallenge: Boolean(postDraftInput.isChallenge),
        },
      });
      if (!draftState.ok) {
        res.status(draftState.status || 409).json({ error: draftState.error, code: draftState.code });
        return;
      }
      postDraft = draftState.draft;
    }

    let existingCase = null;
    if (uploadData.reviewCaseId) {
      const linkedCaseSnap = await db.collection('reviewCases').doc(uploadData.reviewCaseId).get();
      if (linkedCaseSnap.exists) {
        const linkedCaseData = linkedCaseSnap.data() || {};
        if (linkedCaseData.status === 'inReview' && linkedCaseData.userId === decoded.uid) {
          existingCase = { id: linkedCaseSnap.id, data: linkedCaseData };
        }
      }
    }

    if (!existingCase) {
      const matchingOpenCaseDoc = await findFirstUploadReviewCaseAcrossPages({
        fetchPage: async (cursor) => {
          let query = db
            .collection('reviewCases')
            .where('userId', '==', decoded.uid)
            .where('status', '==', 'inReview')
            .limit(20);
          if (cursor) query = query.startAfter(cursor);
          return (await query.get()).docs;
        },
        matches: (data) => {
          if (data.uploadId === uploadId) return true;
          return Array.isArray(data.linkedUploadIds) && data.linkedUploadIds.includes(uploadId);
        },
      });
      existingCase = matchingOpenCaseDoc
        ? { id: matchingOpenCaseDoc.id, data: matchingOpenCaseDoc.data() || {} }
        : null;
    }

    const uploaderSnapshot = await getUploaderSnapshotFromPublicProfile(decoded.uid, {
      uid: decoded.uid,
      displayName: postDraft?.authorName || null,
    });
    const aiSummary = buildAiSummary({
      classification: uploadData?.classification || null,
      shouldReview: Boolean(uploadData?.shouldReview),
      forbiddenReasons: Array.isArray(uploadData?.forbiddenReasons) ? uploadData.forbiddenReasons : [],
      appliedTriggers: Array.isArray(uploadData?.appliedTriggers) ? uploadData.appliedTriggers : [],
      suggestedTriggers: Array.isArray(uploadData?.suggestedTriggers) ? uploadData.suggestedTriggers : [],
      moderationSignals: uploadData?.moderationSignals || null,
      userSelectedTaxonomy: uploadData?.userSelectedTaxonomy || null,
      aiSuggestedTaxonomy: uploadData?.aiSuggestedTaxonomy || null,
      aiSafetySignals: Array.isArray(uploadData?.aiSafetySignals) ? uploadData.aiSafetySignals : [],
      aiVisionLabels: Array.isArray(uploadData?.aiVisionLabels) ? uploadData.aiVisionLabels : [],
      policyAppliedTriggers: Array.isArray(uploadData?.policyAppliedTriggers) ? uploadData.policyAppliedTriggers : [],
      geminiDiagnostics: uploadData?.geminiDiagnostics || null,
    });

    const candidateReviewRef = existingCase?.id
      ? db.collection('reviewCases').doc(existingCase.id)
      : null;
    const newReviewRef = db.collection('reviewCases').doc();
    let reviewCaseId = null;
    let created = false;

    await db.runTransaction(async (transaction) => {
      reviewCaseId = null;
      created = false;
      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {
        const error = new Error('Codex Dev review cases are isolated.');
        error.status = 403;
        throw error;
      }
      const freshUploadSnap = await transaction.get(uploadRef);
      if (!freshUploadSnap.exists) {
        const error = new Error('Upload not found');
        error.status = 404;
        throw error;
      }
      const freshUploadData = freshUploadSnap.data() || {};
      const freshUploadOwnerId = freshUploadData.userId || freshUploadData.ownerUid || freshUploadData.userUid || null;
      if (freshUploadOwnerId !== decoded.uid) {
        const error = new Error('Not authorized for this upload');
        error.status = 403;
        throw error;
      }

      let reusableReviewRef = null;
      const freshLinkedReviewCaseId = String(freshUploadData.reviewCaseId || '').trim();
      const candidateReviewCaseIds = [...new Set([
        freshLinkedReviewCaseId,
        candidateReviewRef?.id || null,
      ].filter(Boolean))];
      for (const candidateReviewCaseId of candidateReviewCaseIds) {
        const candidateRef = db.collection('reviewCases').doc(candidateReviewCaseId);
        const candidateSnap = await transaction.get(candidateRef);
        if (!candidateSnap.exists) continue;
        const candidateData = candidateSnap.data() || {};
        const candidateLinksUpload = freshLinkedReviewCaseId === candidateReviewCaseId
          || candidateData.uploadId === uploadId
          || (Array.isArray(candidateData.linkedUploadIds) && candidateData.linkedUploadIds.includes(uploadId));
        if (candidateData.status === 'inReview'
          && candidateData.userId === decoded.uid
          && (!candidateData.caseType || candidateData.caseType === 'upload')
          && candidateLinksUpload) {
          reusableReviewRef = candidateRef;
          break;
        }
      }

      if (!reusableReviewRef) {
        const freshUserModerationSnap = await transaction.get(manualUserModeration.ref);
        const freshUserModerationData = freshUserModerationSnap.exists
          ? (freshUserModerationSnap.data() || {})
          : {};
        const freshReviewAccess = getReviewAccessDecision({
          reviewRightsLevel: freshUserModerationData.reviewRightsLevel,
          openReviewCount: freshUserModerationData.openReviewCount,
          cooldownUntil: resolveTimestamp(freshUserModerationData.cooldownUntil),
        });
        if (!freshReviewAccess.allowed) {
          const error = new Error(freshReviewAccess.message);
          error.status = freshReviewAccess.status;
          error.code = freshReviewAccess.code;
          throw error;
        }
      }

      const reviewRef = reusableReviewRef || newReviewRef;
      reviewCaseId = reviewRef.id;
      created = !reusableReviewRef;
      const reviewUpdates = {
        uploadId,
        linkedUploadIds: created ? [uploadId] : FieldValue.arrayUnion(uploadId),
        ...(freshUploadData?.fingerprints ? {
          fingerprints: created
            ? [freshUploadData.fingerprints]
            : FieldValue.arrayUnion(freshUploadData.fingerprints),
        } : {}),
        ...(uploaderSnapshot ? { uploaderSnapshot } : {}),
        reviewReason: 'manualUserReviewRequest',
        aiSummary,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (created) {
        transaction.create(reviewRef, {
          caseType: 'upload',
          status: 'inReview',
          decision: null,
          userId: decoded.uid,
          ...reviewUpdates,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.set(reviewRef, reviewUpdates, { merge: true });
      }
      transaction.set(uploadRef, {
        reviewCaseId,
        moderationState: MODERATION_STATES.reviewPending,
        publicationState: PUBLICATION_STATES.pending,
        reviewStatus: 'inReview',
        reviewRequestedAt: FieldValue.serverTimestamp(),
        previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(postDraft ? { postDraft } : {}),
      }, { merge: true });
      if (created) {
        transaction.set(manualUserModeration.ref, {
          openReviewCount: 1,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    });

    res.status(200).json({ ok: true, reviewCaseId, created });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to request upload review case' });
  }
});


export const getModerationExamplesForCase = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    await ensureModerator(decoded);
    const body = parseJsonBody(req) || {};
    const reviewCaseId = String(body.reviewCaseId || '').trim();
    const uploadId = String(body.uploadId || '').trim();
    if (!reviewCaseId && !uploadId) {
      res.status(400).json({ error: 'reviewCaseId or uploadId is required' });
      return;
    }

    let reviewCase = null;
    let upload = null;
    let effectiveUploadId = uploadId;

    if (reviewCaseId) {
      const reviewSnap = await db.collection('reviewCases').doc(reviewCaseId).get();
      if (!reviewSnap.exists) {
        res.status(404).json({ error: 'Review case not found', examples: [] });
        return;
      }
      reviewCase = reviewSnap.data() || {};
      const allowedUploadIds = resolveReviewCaseUploadIds(reviewCase);
      if (uploadId && !allowedUploadIds.includes(uploadId)) {
        res.status(400).json({ error: 'uploadId is not linked to reviewCaseId' });
        return;
      }
      effectiveUploadId = resolveEffectiveUploadId({ requestUploadId: uploadId, reviewCase });
    }

    if (effectiveUploadId) {
      const uploadSnap = await db.collection('uploads').doc(effectiveUploadId).get();
      if (!uploadSnap.exists) {
        res.status(404).json({ error: 'Upload not found', examples: [] });
        return;
      }
      upload = uploadSnap.exists ? uploadSnap.data() || {} : null;
      const linkedReviewCaseId = String(upload?.reviewCaseId || '').trim();
      if (!reviewCase && linkedReviewCaseId) {
        const linkedReviewSnap = await db.collection('reviewCases').doc(linkedReviewCaseId).get();
        reviewCase = linkedReviewSnap.exists ? linkedReviewSnap.data() || {} : null;
      }
    }

    const fingerprints = resolveModerationExampleFingerprints(upload, reviewCase);
    const sourceContext = {
      finalOutcome: resolveModerationSourceFinalOutcome({ reviewCase, upload }),
    };
    const sourceIdentifiers = {
      sourceReviewCaseId: reviewCaseId || String(upload?.reviewCaseId || '').trim() || null,
      sourceUploadId: effectiveUploadId || null,
    };
    const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints, sourceContext, sourceIdentifiers, limit: 5 });
    res.status(200).json({ ok: true, reviewCaseId: reviewCaseId || null, uploadId: effectiveUploadId || null, examples });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to fetch moderation examples' });
  }
});

export const moderatorClaim = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    const { email } = await ensureModerator(decoded);
    const body = parseJsonBody(req);
    const reviewCaseId = body?.reviewCaseId;
    if (!reviewCaseId) {
      res.status(400).json({ error: 'reviewCaseId is required' });
      return;
    }
    const now = Date.now();
    const reviewRef = db.collection('reviewCases').doc(reviewCaseId);
    let claimed = false;
    let claimedBy = null;

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reviewRef);
      if (!snapshot.exists) {
        const error = new Error('Review case not found');
        error.status = 404;
        throw error;
      }
      const data = snapshot.data();
      if (data?.status !== 'inReview') {
        const error = new Error('Review case is not in review');
        error.status = 409;
        throw error;
      }
      const lock = data?.lock;
      const expiresAt = lock?.expiresAt?.toDate ? lock.expiresAt.toDate() : lock?.expiresAt;
      const isLocked = expiresAt && expiresAt.getTime ? expiresAt.getTime() > now : false;
      if (isLocked && lock?.claimedByUid !== decoded.uid) {
        claimed = false;
        claimedBy = lock?.claimedByEmail || null;
        return;
      }
      const expires = Timestamp.fromDate(new Date(now + lockDurationMs));
      transaction.update(reviewRef, {
        lock: {
          claimedByUid: decoded.uid,
          claimedByEmail: email,
          claimedAt: FieldValue.serverTimestamp(),
          expiresAt: expires,
        },
      });
      claimed = true;
      claimedBy = email;
    });

    res.status(200).json({ ok: true, claimed, claimedBy });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to claim review case' });
  }
});

export const moderatorRelease = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    await ensureModerator(decoded);
    const body = parseJsonBody(req);
    const reviewCaseId = body?.reviewCaseId;
    if (!reviewCaseId) {
      res.status(400).json({ error: 'reviewCaseId is required' });
      return;
    }
    const reviewRef = db.collection('reviewCases').doc(reviewCaseId);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reviewRef);
      if (!snapshot.exists) return;
      const data = snapshot.data();
      if (data?.lock?.claimedByUid === decoded.uid) {
        transaction.update(reviewRef, { lock: FieldValue.delete() });
      }
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to release lock' });
  }
});

export const moderatorDecide = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    const { email } = await ensureModerator(decoded);
    const body = parseJsonBody(req);
    const {
      reviewCaseId,
      decision,
      action,
      reasonCode,
      decisionMessagePublic,
      decisionReasons = [],
      moderatorNoteInternal = null,
    } = body || {};

    if (!reviewCaseId) {
      res.status(400).json({ error: 'reviewCaseId is required' });
      return;
    }
    const normalizedDecision = decision === 'approve'
      ? 'approved'
      : decision === 'reject'
        ? 'rejected'
        : decision;
    if (!['approved', 'rejected'].includes(normalizedDecision)) {
      res.status(400).json({ error: 'Invalid decision' });
      return;
    }
    const normalizedReasonCode = String(reasonCode || '').trim();
    if (!normalizedReasonCode) {
      res.status(400).json({ error: 'reasonCode is required' });
      return;
    }
    if (!MODERATION_EXAMPLE_REASON_CODES.has(normalizedReasonCode)) {
      res.status(400).json({ error: 'Invalid reasonCode' });
      return;
    }
    const normalizedAction = normalizedDecision === 'approved' ? 'approve' : 'reject';
    if (!MODERATION_EXAMPLE_REASON_CODES_BY_ACTION[normalizedAction]?.has(normalizedReasonCode)) {
      res.status(400).json({ error: `Invalid reasonCode for action ${normalizedAction}` });
      return;
    }
    const normalizedModeratorAction = normalizeModeratorDecisionAction(action, normalizedDecision);
    if (!normalizedModeratorAction) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }
    if (!isModeratorDecisionActionCompatible(normalizedModeratorAction, normalizedDecision)) {
      res.status(400).json({ error: 'Moderator action contradicts decision' });
      return;
    }
    const taxonomyValidation = validateCorrectedTaxonomyForAction(normalizedModeratorAction, body?.correctedTaxonomy || {});
    if (!taxonomyValidation.isValid) {
      res.status(400).json({ error: 'correctedTaxonomy is required for correction actions' });
      return;
    }
    const correctedThemes = taxonomyValidation.themes;
    const correctedTriggers = taxonomyValidation.triggers;
    const trimmedMessage = String(decisionMessagePublic || '').trim();
    if (!trimmedMessage) {
      res.status(400).json({ error: 'decisionMessagePublic is required' });
      return;
    }
    if (trimmedMessage.length > 280) {
      res.status(400).json({ error: 'decisionMessagePublic must be <= 280 chars' });
      return;
    }
    if (!Array.isArray(decisionReasons) || decisionReasons.length > 3) {
      res.status(400).json({ error: 'decisionReasons must be max 3 items' });
      return;
    }

    const now = Date.now();
    const reviewRef = db.collection('reviewCases').doc(reviewCaseId);
    let uploadId = null;
    let userId = null;
    let reportPostId = null;
    let caseType = 'upload';
    let finalDecisionMessage = trimmedMessage;
    let reviewSnapshotData = null;
    let uploadSnapshotData = null;
    let moderationExamplePayload = null;

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reviewRef);
      if (!snapshot.exists) {
        const error = new Error('Review case not found');
        error.status = 404;
        throw error;
      }
      const data = snapshot.data();
      reviewSnapshotData = data;
      const caseForbidden = data?.aiResult?.outcome === 'forbidden' || data?.outcome === 'forbidden';
      const isAllowedOverride = normalizedReasonCode === 'wrong_theme_or_label' && Boolean(moderatorNoteInternal);
      if (caseForbidden && normalizedDecision === 'approved' && !isAllowedOverride) {
        const error = new Error('Forbidden content requires explicit override path with reasonCode and audit note');
        error.status = 400;
        throw error;
      }
      caseType = data?.caseType || 'upload';
      const reportedPost = data?.reportedPost || null;
      reportPostId = reportedPost?.id || data?.reportedPostId || null;
      if (caseType === 'report' && normalizedDecision === 'approved') {
        finalDecisionMessage = buildReportRemovalMessage(trimmedMessage);
      }
      if (data?.status !== 'inReview') {
        const error = new Error('Review case already decided');
        error.status = 409;
        throw error;
      }
      const lock = data?.lock;
      const expiresAt = lock?.expiresAt?.toDate ? lock.expiresAt.toDate() : lock?.expiresAt;
      const isLocked = expiresAt && expiresAt.getTime ? expiresAt.getTime() > now : false;
      if (isLocked && lock?.claimedByUid && lock?.claimedByUid !== decoded.uid) {
        const error = new Error('Review case locked by another moderator');
        error.status = 423;
        throw error;
      }
      uploadId = data?.uploadId || (Array.isArray(data?.linkedUploadIds) ? data.linkedUploadIds[0] : null);
      userId = data?.userId || reportedPost?.authorId || null;
      if (!uploadId && caseType !== 'report') {
        const error = new Error('Review case missing uploadId');
        error.status = 400;
        throw error;
      }
      if (caseType === 'report' && !reportPostId) {
        const error = new Error('Review case missing reported post');
        error.status = 400;
        throw error;
      }

      let uploadRef = null;
      if (uploadId) {
        uploadRef = db.collection('uploads').doc(uploadId);
        const uploadSnapshot = await transaction.get(uploadRef);
        uploadSnapshotData = uploadSnapshot.exists ? (uploadSnapshot.data() || null) : null;
      }

      let decidingUserModerationData = {};
      if (caseType === 'upload' && userId) {
        const decidingUserModerationSnap = await transaction.get(db.collection('userModeration').doc(userId));
        decidingUserModerationData = decidingUserModerationSnap.exists
          ? (decidingUserModerationSnap.data() || {})
          : {};
      }

      const expires = Timestamp.fromDate(new Date(now + lockDurationMs));
      transaction.update(reviewRef, {
        lock: {
          claimedByUid: decoded.uid,
          claimedByEmail: email,
          claimedAt: FieldValue.serverTimestamp(),
          expiresAt: expires,
        },
      });

      if (uploadRef) {
        const isApproved = normalizedDecision === 'approved';
        const requiresUploaderAcceptance = normalizedModeratorAction === 'requestUserCorrection';
        const uploadReviewStatus = requiresUploaderAcceptance ? 'needs_user_correction' : normalizedDecision;
        const moderatorLifecycleState = !isApproved
          ? {
              outcome: 'forbidden',
              forbiddenReasons: [{ trigger: 'moderatorRejected', reason: normalizedReasonCode, source: 'moderatorDecision' }],
              shouldReview: false,
              publishBlocked: true,
              canRequestReview: false,
            }
          : requiresUploaderAcceptance
            ? {
                outcome: 'needsCorrection',
                forbiddenReasons: [],
                shouldReview: false,
                publishBlocked: true,
                canRequestReview: false,
              }
            : buildAcceptedCorrectionModerationState();
        transaction.update(uploadRef, {
          moderationState: !isApproved
            ? MODERATION_STATES.rejected
            : requiresUploaderAcceptance
              ? MODERATION_STATES.correctionPending
              : MODERATION_STATES.allowed,
          publicationState: PUBLICATION_STATES.pending,
          reviewStatus: uploadReviewStatus,
          ...moderatorLifecycleState,
          uploaderCorrectionResponse: FieldValue.delete(),
          correction: FieldValue.delete(),
          reviewDecisionMessagePublic: finalDecisionMessage,
          reviewDecisionReasons: decisionReasons,
          reviewDecisionAt: FieldValue.serverTimestamp(),
          publicationStatus: isApproved ? (requiresUploaderAcceptance ? 'needs_user_correction' : 'pending') : 'blocked',
          approvedAt: isApproved ? FieldValue.serverTimestamp() : FieldValue.delete(),
          reviewCaseId,
          correctedTaxonomy: (correctedThemes.length || correctedTriggers.length) ? { themes: correctedThemes, triggers: correctedTriggers } : FieldValue.delete(),
          moderatorDecision: {
            action: normalizedModeratorAction,
            reasonCode: normalizedReasonCode,
            correctedTaxonomy: { themes: correctedThemes, triggers: correctedTriggers },
            requiresUploaderAcceptance: normalizedModeratorAction === 'requestUserCorrection',
            finalPolicyOutcome: normalizedDecision === 'approved' ? 'allowed' : 'forbidden',
            decidedAt: FieldValue.serverTimestamp(),
            decidedBy: decoded.uid,
          },
          requiresUploaderAcceptance: normalizedModeratorAction === 'requestUserCorrection',
          previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(now),
        });
      }

      const reviewUpdate = {
        status: normalizedDecision,
        decisionMessagePublic: finalDecisionMessage,
        decisionReasons,
        moderatorNoteInternal: moderatorNoteInternal || null,
        decidedAt: FieldValue.serverTimestamp(),
        decidedByUid: decoded.uid,
        decidedByEmail: email,
        moderatorDecision: {
          action: normalizedModeratorAction,
          reasonCode: normalizedReasonCode,
          correctedTaxonomy: { themes: correctedThemes, triggers: correctedTriggers },
          requiresUploaderAcceptance: normalizedModeratorAction === 'requestUserCorrection',
          finalPolicyOutcome: normalizedDecision === 'approved' ? 'allowed' : 'forbidden',
          decidedAt: FieldValue.serverTimestamp(),
          decidedBy: decoded.uid,
        },
        userCorrectionStatus: FieldValue.delete(),
        userCorrectionRejectedAt: FieldValue.delete(),
        userCorrectionRejectedByUid: FieldValue.delete(),
        lock: FieldValue.delete(),
      };
      if (uploadId) {
        reviewUpdate.uploadId = uploadId;
      }
      if (reportPostId) {
        reviewUpdate.reportedPostId = reportPostId;
      }
      transaction.update(reviewRef, reviewUpdate);
      if (caseType === 'upload' && userId) {
        transaction.set(db.collection('userModeration').doc(userId), {
          openReviewCount: getOpenReviewCountAfterCaseExit({
            openReviewCount: decidingUserModerationData.openReviewCount,
            wasOpenUploadCase: true,
          }),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      const uploadFingerprints = uploadSnapshotData?.fingerprints || reviewSnapshotData?.reportedFingerprints || {};
      const uploadInputThemes = Array.isArray(uploadSnapshotData?.themes) ? uploadSnapshotData.themes : [];
      const uploadInputMakerTags = Array.isArray(uploadSnapshotData?.makerTags) ? uploadSnapshotData.makerTags : [];
      const moderationSignals = uploadSnapshotData?.moderationSignals || reviewSnapshotData?.moderationSignals || {};
      const aiResult = uploadSnapshotData?.aiResult || reviewSnapshotData?.aiResult || {};
      const correctionSnapshot = uploadSnapshotData?.correction || uploadSnapshotData?.postDraft?.correction || reviewSnapshotData?.uploadSnapshot?.correction || null;
      moderationExamplePayload = buildCommonModerationExample({
        uploadId: uploadId || null,
        reviewCaseId: reviewCaseId || null,
        uploaderUid: userId || null,
        fingerprints: {
          sha256: uploadFingerprints?.sha256 || null,
          dhash: uploadFingerprints?.dhash || null,
          dhashPrefix: uploadFingerprints?.dhashPrefix || null,
        },
        uploadData: uploadSnapshotData || {},
        reviewData: reviewSnapshotData || {},
        aiResult,
        moderationSignals,
        correctionSnapshot,
        decision: normalizedDecision,
        policyDecisionOutcome: normalizedDecision === 'approved' ? 'allowed' : 'forbidden',
        moderatorDecision: {
          action: normalizedModeratorAction,
          finalOutcome: normalizedDecision === 'approved' ? 'allowed' : 'forbidden',
          reasonCode: normalizedReasonCode,
          correctedTaxonomy: { themes: correctedThemes, triggers: correctedTriggers },
          notes: moderatorNoteInternal || null,
          decidedBy: decoded.uid,
          decidedAt: FieldValue.serverTimestamp(),
        },
        source: 'moderatorDecide',
        nowFactory: () => FieldValue.serverTimestamp(),
      });
      const moderationExampleId = `${reviewCaseId}_${normalizedAction}`;
      transaction.set(db.collection('moderationExamples').doc(moderationExampleId), moderationExamplePayload, { merge: true });
    });

    if (caseType === 'report' && normalizedDecision === 'approved' && reportPostId) {
      const reportedPostPath = reviewSnapshotData?.reportedPostPath || buildReportedPostPath(reportPostId);
      const deleteRef = reportedPostPath ? db.doc(reportedPostPath) : db.collection('posts').doc(reportPostId);
      try {
        await deleteRef.delete();
      } catch (error) {
        logger.error('Reported post delete mislukt.', error);
      }
    }

    if (caseType === 'report' && normalizedDecision === 'approved' && userId && reviewSnapshotData?.reportedFingerprints) {
      try {
        const moderation = await getUserModeration(userId);
        if (moderation) {
          await moderation.ref.set(
            {
              blockedFingerprints: FieldValue.arrayUnion({
                ...reviewSnapshotData.reportedFingerprints,
                reportedAt: FieldValue.serverTimestamp(),
                reviewCaseId,
              }),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (error) {
        logger.error('Blocked fingerprint opslaan mislukt.', error);
      }
    }

    const contributorUids = Array.isArray(reviewSnapshotData?.contributorUids)
      ? reviewSnapshotData.contributorUids
      : [];
    const recipientUids = [...new Set([userId, ...contributorUids].filter(Boolean))];
    if (recipientUids.length > 0) {
      const decisionMessage = createDecisionMessage({
        decision: normalizedDecision,
        decisionMessagePublic: finalDecisionMessage,
        decisionReasons,
        caseType,
        uploadId,
        reviewCaseId,
        reportedPostId: reportPostId,
        ownerUid: userId,
      });
      await Promise.all(
        recipientUids.map(async (recipientUid) => {
          const threadId = await ensureModerationThreadForUser(recipientUid);
          const threadRef = db.collection('threads').doc(threadId);
          const messageRef = threadRef.collection('messages').doc();
          await Promise.all([
            threadRef.set(
              {
                updatedAt: FieldValue.serverTimestamp(),
                lastMessageAt: FieldValue.serverTimestamp(),
                lastMessageText: finalDecisionMessage,
                lastSenderUid: 'system',
              },
              { merge: true }
            ),
            messageRef.set({
              ...decisionMessage,
              createdAt: FieldValue.serverTimestamp(),
            }),
            db.collection('users').doc(recipientUid).collection('threadIndex').doc(threadId).set(
              {
                lastMessageAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            ),
          ]);
        })
      );
    }

    res.status(200).json({ ok: true, reviewCaseId, uploadId, userId, reviewCase: reviewSnapshotData });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to decide review case' });
  }
});

export const moderatorQueueFreshEvaluation = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
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
    const initialCaseOwnerId = pickString(
      initialReviewCaseData?.userId,
      initialReviewCaseData?.uploaderUid,
      initialReviewCaseData?.ownerUid,
      initialReviewCaseData?.uploaderSnapshot?.uid,
    );
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

      const freshCaseOwnerId = pickString(
        freshReviewCaseData?.userId,
        freshReviewCaseData?.uploaderUid,
        freshReviewCaseData?.ownerUid,
        freshReviewCaseData?.uploaderSnapshot?.uid,
      );
      const freshReviewCaseUploadIds = resolveReviewCaseUploadIds(freshReviewCaseData);
      const initialUploadSetKey = [...new Set(initialReviewCaseUploadIds)].sort().join('\n');
      const freshUploadSetKey = [...new Set(freshReviewCaseUploadIds)].sort().join('\n');
      if (initialUploadSetKey !== freshUploadSetKey) {
        const error = new Error('Review case uploads changed while queuing fresh evaluation');
        error.status = 409;
        error.code = 'review_case_upload_changed';
        throw error;
      }
      if (initialCaseOwnerId !== freshCaseOwnerId) {
        const error = new Error('Review case owner changed while queuing fresh evaluation');
        error.status = 409;
        error.code = 'review_case_owner_changed';
        throw error;
      }
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
        freshCaseOwnerId,
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
          moderationState: MODERATION_STATES.superseded,
          publicationState: PUBLICATION_STATES.pending,
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

export const userModerationAction = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
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
      ? db.collection(isCodexDevUid(userId) ? 'codexDevPosts' : 'posts').doc(uploadId)
      : null;
    const draftRef = action === 'saveDraft'
      ? userRef.collection('drafts').doc()
      : null;
    const rejectedCorrectionReviewRef = action === 'rejectCorrection'
      ? db.collection('reviewCases').doc()
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
    if (action === 'saveDraft' && !canSaveDraftUpload(upload)) {
      res.status(409).json({ error: 'Upload is not approved for draft persistence' });
      return;
    }
    if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload')
      && !canManageApprovedUploadPrompt(upload)) {
      res.status(409).json({ error: 'Upload publication prompt is no longer actionable' });
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
    const publicationAuthorProfileRef = postRef && resolvedAuthorProfile && !resolvedAuthorProfile.isPersonal
      ? db.collection('profiles').doc(resolvedAuthorProfile.profileId)
      : null;

    await runUserModerationActionMutation({
      db,
      uid: userId,
      isKnownCodexDevActorUid,
      mutate: async (transaction) => {
        const [latestUploadSnap, latestMessageSnap, latestUserSnap, latestPostSnap, latestUserModerationSnap, latestAuthorProfileSnap] = await Promise.all([
          transaction.get(uploadRef),
          messageRef ? transaction.get(messageRef) : Promise.resolve(null),
          postRef ? transaction.get(userRef) : Promise.resolve(null),
          postRef ? transaction.get(postRef) : Promise.resolve(null),
          action === 'rejectCorrection'
            ? transaction.get(db.collection('userModeration').doc(userId))
            : Promise.resolve(null),
          publicationAuthorProfileRef ? transaction.get(publicationAuthorProfileRef) : Promise.resolve(null),
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
        if (publicationAuthorProfileRef) {
          resolvedAuthorProfile = resolveValidatedPublicationAuthorOrThrow(validateModerationPublicationAuthorProfile({
            userId,
            requestedProfileId: resolvedAuthorProfile?.profileId,
            profileExists: Boolean(latestAuthorProfileSnap?.exists),
            profileData: latestAuthorProfileSnap?.exists ? (latestAuthorProfileSnap.data() || {}) : null,
          }));
        }

        const latestPublicationLifecycle = resolveUploadPublicationState(latestUpload);
        if (postRef
          && latestPublicationLifecycle.valid
          && latestPublicationLifecycle.state === PUBLICATION_STATES.published
          && !latestPostSnap?.exists) {
          const error = new Error('Published post was deleted and cannot be recreated from stale upload state');
          error.status = 409;
          error.code = 'published_post_deleted';
          throw error;
        }
        if ((action === 'publishNow' || action === 'repairPublished') && !canPublishUpload(latestUpload)) {
          const error = new Error('Upload is not approved');
          error.status = 409;
          throw error;
        }
        if (action === 'saveDraft' && !canSaveDraftUpload(latestUpload)) {
          const error = new Error('Upload is not approved for draft persistence');
          error.status = 409;
          throw error;
        }
        if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload')
          && !canManageApprovedUploadPrompt(latestUpload)) {
          const error = new Error('Upload publication prompt is no longer actionable');
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
          let reviewReopenPlan = resolveCorrectionReviewReopenPlan({
            upload: latestUpload,
            userId,
            newReviewCaseId: action === 'rejectCorrection' ? (rejectedCorrectionReviewRef?.id || null) : null,
          });
          const acceptancePlanValidation = validateCorrectionAcceptancePlanProvenance({
            plan: reviewReopenPlan,
            action,
          });
          if (acceptancePlanValidation.acceptanceBlocked) {
            const error = new Error('Correction acceptance requires verifiable moderator provenance');
            error.status = 409;
            error.code = 'correction_provenance_missing';
            throw error;
          }
          let reviewCaseId = reviewReopenPlan.targetReviewCaseId;
          if (action === 'acceptCorrection'
            && reviewReopenPlan.createNewReviewCase === true
            && reviewReopenPlan.sourceReviewCaseId) {
            const sourceCorrectionCaseSnap = await transaction.get(
              db.collection('reviewCases').doc(reviewReopenPlan.sourceReviewCaseId)
            );
            const provenanceValidation = validateRoutedCorrectionAcceptanceProvenance({
              plan: reviewReopenPlan,
              action,
              persistedSourceCase: sourceCorrectionCaseSnap.exists ? (sourceCorrectionCaseSnap.data() || {}) : null,
              persistedSourceCaseExists: sourceCorrectionCaseSnap.exists,
              upload: latestUpload,
            });
            if (provenanceValidation.acceptanceBlocked) {
              const error = new Error('Correction request is no longer active');
              error.status = 409;
              error.code = provenanceValidation.correctionSuperseded
                ? 'correction_superseded'
                : 'correction_source_inactive';
              throw error;
            }
          }
          if (reviewCaseId && reviewReopenPlan.createNewReviewCase !== true) {
            const persistedCorrectionCaseSnap = await transaction.get(db.collection('reviewCases').doc(reviewCaseId));
            reviewReopenPlan = finalizeCorrectionReviewCasePlan({
              plan: reviewReopenPlan,
              action,
              userId,
              persistedCase: persistedCorrectionCaseSnap.exists ? (persistedCorrectionCaseSnap.data() || {}) : null,
              persistedCaseExists: persistedCorrectionCaseSnap.exists,
              newReviewCaseId: action === 'rejectCorrection' ? (rejectedCorrectionReviewRef?.id || null) : null,
              upload: latestUpload,
              uploadId,
            });
            reviewCaseId = reviewReopenPlan.targetReviewCaseId;
            if (reviewReopenPlan.correctionSuperseded || reviewReopenPlan.rejectionBlocked) {
              const error = new Error('Correction request was superseded by a newer moderator decision');
              error.status = 409;
              error.code = 'correction_superseded';
              throw error;
            }
            if (reviewReopenPlan.acceptanceBlocked) {
              const error = new Error('Correction request is no longer active');
              error.status = 409;
              error.code = 'correction_request_inactive';
              throw error;
            }
          }
          if (action === 'rejectCorrection') {
            const latestUserModerationData = latestUserModerationSnap?.exists
              ? (latestUserModerationSnap.data() || {})
              : {};
            const correctionReviewAccess = getReviewAccessDecision({
              reviewRightsLevel: latestUserModerationData.reviewRightsLevel,
              openReviewCount: latestUserModerationData.openReviewCount,
              cooldownUntil: resolveTimestamp(latestUserModerationData.cooldownUntil),
            });
            if (!correctionReviewAccess.allowed) {
              const error = new Error(correctionReviewAccess.message);
              error.status = correctionReviewAccess.status;
              error.code = correctionReviewAccess.code;
              throw error;
            }
          }
          const nextCorrection = {
            ...(latestUpload?.correction && typeof latestUpload.correction === 'object' ? latestUpload.correction : {}),
            suggestedThemes: correctedTaxonomy.themes,
            suggestedTriggers: correctedTaxonomy.triggers,
          };
          if (action === 'acceptCorrection') {
            nextCorrection.type = 'safeCorrection';
            nextCorrection.userAcceptedAt = FieldValue.serverTimestamp();
            nextCorrection.userRejectedAt = null;
            nextCorrection.requiresModeratorReview = false;
            nextCorrection.publishBlocked = false;
            nextCorrection.finalAcceptedThemes = correctedTaxonomy.themes;
            nextCorrection.finalAcceptedTriggers = correctedTaxonomy.triggers;
          } else {
            nextCorrection.type = 'reviewRequiredCorrection';
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
            reviewCaseId,
            reviewReopenPlan,
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
          const publishDecision = getServerPublicPostPublishDecision({
            user: latestUserSnap?.exists ? latestUserSnap.data() : null,
            tokenClaims: decoded,
          });
          if (!publishDecision.allowed) {
            const error = new Error(publishDecision.code);
            error.status = 403;
            error.code = publishDecision.code;
            throw error;
          }
          const submittedPostDraft = {
            ...(latestUpload?.postDraft || {}),
            ...(postDraftFromBody && typeof postDraftFromBody === 'object' ? postDraftFromBody : {}),
          };
          const boundDraftState = buildPersistedModerationDraftState({ upload: latestUpload, draft: submittedPostDraft });
          if (!boundDraftState.ok) {
            const error = new Error(boundDraftState.error);
            error.status = boundDraftState.status || 409;
            error.code = boundDraftState.code || 'moderated_image_missing';
            throw error;
          }
          const postDraft = applyAutomaticModeratorCorrectionToPostDraft({ upload: latestUpload, postDraft: boundDraftState.draft });
          const publicationTaxonomy = buildModeratedPublicationTaxonomy({ upload: latestUpload, postDraft });
          if (!publicationTaxonomy.ok) {
            const error = new Error(publicationTaxonomy.error);
            error.status = publicationTaxonomy.status || 409;
            error.code = publicationTaxonomy.code || 'moderated_taxonomy_mismatch';
            throw error;
          }
          const persistedConsentProof = buildPersistedPublicationConsentProof({ postDraft, userId });
          if (!persistedConsentProof.ok) {
            const error = new Error(persistedConsentProof.error);
            error.status = persistedConsentProof.status || 400;
            error.code = persistedConsentProof.code || 'upload_consent_invalid';
            throw error;
          }
          const normalizedImageUrl = resolveTrustedModeratedImageUrl(latestUpload);
          if (!normalizedImageUrl) {
            const error = new Error('Cannot publish upload without a trusted moderated image');
            error.status = 409;
            error.code = 'moderated_image_missing';
            throw error;
          }
          publicationPlan = {
            title: String(postDraft?.title || latestUpload?.title || latestUpload?.caption || '').trim(),
            description: String(postDraft?.description || postDraft?.caption || latestUpload?.description || latestUpload?.caption || '').trim(),
            imageUrl: normalizedImageUrl,
            styles: publicationTaxonomy.themes,
            makerTags: publicationTaxonomy.triggers,
            appliedTriggers: publicationTaxonomy.appliedTriggers,
            credits: persistedConsentProof.credits,
            contributorIds: persistedConsentProof.contributorIds,
            uploadConsent: persistedConsentProof.uploadConsent,
            consentAudit: persistedConsentProof.consentAudit,
            consentException: persistedConsentProof.consentException,
            imageMeta: sanitizePersistedPublicationImageMeta(postDraft?.imageMeta),
            correction: sanitizePersistedPublicationCorrection(latestUpload?.correction),
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
            previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(),
          }, { merge: true });
          if (messageRef) transaction.set(messageRef, { unread: false }, { merge: true });
        }

        if (action === 'discardApprovedUpload') {
          transaction.set(uploadRef, {
            publicationState: PUBLICATION_STATES.discarded,
            publicationStatus: 'discarded',
            publishStatus: 'discarded',
            discardedAt: FieldValue.serverTimestamp(),
            discardedByUid: userId,
            publicationPromptDismissedAt: FieldValue.serverTimestamp(),
            publicationPromptDismissedByUid: userId,
            previewRetentionExpiresAt: Timestamp.fromMillis(Date.now()),
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
          let acceptedCorrectionPostDraft = null;
          if (action === 'acceptCorrection') {
            const acceptedDraftState = buildPersistedModerationDraftState({
              upload: latestUpload,
              draft: {
                ...(latestUpload?.postDraft || {}),
                ...(postDraftFromBody && typeof postDraftFromBody === 'object' ? postDraftFromBody : {}),
                styles: correctionPlan.correctedTaxonomy.themes,
                makerTags: correctionPlan.correctedTaxonomy.triggers,
                appliedTriggers: deriveAcceptedCorrectionAppliedTriggers({
                  upload: latestUpload,
                  themes: correctionPlan.correctedTaxonomy.themes,
                  triggers: correctionPlan.correctedTaxonomy.triggers,
                }),
              },
            });
            if (!acceptedDraftState.ok) {
              const error = new Error(acceptedDraftState.error);
              error.status = acceptedDraftState.status || 409;
              error.code = acceptedDraftState.code || 'moderated_image_missing';
              throw error;
            }
            acceptedCorrectionPostDraft = acceptedDraftState.draft;
          }
          transaction.set(uploadRef, {
            correctedTaxonomy: correctionPlan.correctedTaxonomy,
            uploaderCorrectionResponse: action === 'acceptCorrection'
              ? { status: 'accepted', acceptedAt: FieldValue.serverTimestamp(), acceptedBy: userId }
              : { status: 'rejected', rejectedAt: FieldValue.serverTimestamp(), rejectedBy: userId },
            correction: correctionPlan.nextCorrection,
            moderationState: action === 'acceptCorrection'
              ? MODERATION_STATES.allowed
              : MODERATION_STATES.reviewPending,
            publicationState: PUBLICATION_STATES.pending,
            publicationStatus: action === 'acceptCorrection' ? 'correction_accepted' : 'user_disagreed',
            reviewStatus: action === 'acceptCorrection' ? 'approved' : 'inReview',
            requiresUploaderAcceptance: action !== 'acceptCorrection',
            previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(),
            ...(action === 'rejectCorrection' && correctionPlan.reviewCaseId ? { reviewCaseId: correctionPlan.reviewCaseId } : {}),
            ...(action === 'acceptCorrection' ? {
              ...buildAcceptedCorrectionModerationState(),
              postDraft: acceptedCorrectionPostDraft,
            } : {}),
          }, { merge: true });
          transaction.set(correctionPlan.moderationExampleRef, correctionPlan.moderationExamplePayload, { merge: true });
          if (action === 'rejectCorrection') {
            const correctionReviewCaseId = String(correctionPlan.reviewCaseId || '').trim();
            if (correctionReviewCaseId) {
              const reviewRef = db.collection('reviewCases').doc(correctionReviewCaseId);
              const reviewMutation = {
                caseType: 'upload',
                userId,
                status: 'inReview',
                decision: null,
                uploadId,
                linkedUploadIds: correctionPlan.reviewReopenPlan?.createNewReviewCase
                  ? [uploadId]
                  : FieldValue.arrayUnion(uploadId),
                reviewReason: 'uploaderRejectedCorrection',
                userCorrectionStatus: 'rejected',
                userCorrectionRejectedAt: FieldValue.serverTimestamp(),
                userCorrectionRejectedByUid: userId,
                correctedTaxonomy: correctionPlan.correctedTaxonomy,
                updatedAt: FieldValue.serverTimestamp(),
                lock: FieldValue.delete(),
              };
              if (correctionPlan.reviewReopenPlan?.createNewReviewCase) {
                transaction.create(reviewRef, {
                  ...reviewMutation,
                  fingerprints: latestUpload?.fingerprints ? [latestUpload.fingerprints] : [],
                  createdAt: FieldValue.serverTimestamp(),
                });
              } else {
                transaction.set(reviewRef, reviewMutation, { merge: true });
              }
              transaction.set(db.collection('userModeration').doc(userId), {
                openReviewCount: 1,
                updatedAt: FieldValue.serverTimestamp(),
              }, { merge: true });
            }
          }
        }

        if (publicationPlan) {
          if (!latestPostSnap?.exists) {
            transaction.create(postRef, {
              title: publicationPlan.title || 'Untitled',
              description: publicationPlan.description || '',
              imageUrl: publicationPlan.imageUrl,
              moderationUploadId: uploadId,
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
              sensitive: publicationPlan.appliedTriggers.length > 0,
              outcome: 'allowed',
              shouldReview: false,
              forbiddenReasons: [],
              reviewCaseId: latestUpload?.reviewCaseId || null,
              credits: publicationPlan.credits,
              contributorIds: publicationPlan.contributorIds,
              uploadConsent: publicationPlan.uploadConsent,
              consentAudit: publicationPlan.consentAudit,
              consentException: publicationPlan.consentException,
              ...(publicationPlan.imageMeta ? { imageMeta: publicationPlan.imageMeta } : {}),
              ...(publicationPlan.correction ? { correction: publicationPlan.correction } : {}),
              likes: 0,
              isChallenge: publicationPlan.isChallenge,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          transaction.set(uploadRef, {
            publicationState: PUBLICATION_STATES.published,
            publicationStatus: 'published',
            publishStatus: 'published',
            publishedAt: FieldValue.serverTimestamp(),
            postId: uploadId,
            previewRetentionExpiresAt: FieldValue.delete(),
            previewRetentionDeferredAt: FieldValue.delete(),
            previewRetentionDeferredReason: FieldValue.delete(),
            previewExpiryClaimId: FieldValue.delete(),
            draftId: FieldValue.delete(),
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
          transaction.set(uploadRef, {
            publicationState: PUBLICATION_STATES.draft,
            publicationStatus: 'draft',
            publishStatus: 'draft',
            draftId: draftRef.id,
            previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(),
          }, { merge: true });
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

    res.status(200).json({ ok: true, ...((action === 'publishNow' || action === 'repairPublished') ? { postId: uploadId } : {}) });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to perform action', ...(error.code ? { code: error.code } : {}) });
  }
});


export const getContributorByAliasCallable = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const type = request.data?.type === 'domain'
    ? 'domain'
    : (request.data?.type === 'email' ? 'email' : 'instagram');
  const value = normalizeContributorAliasValue(type, request.data?.value);
  if (!value) return null;

  const aliasId = makeContributorAliasId(type, value);
  const aliasSnap = await db.collection('contributorAliases').doc(aliasId).get();
  if (!aliasSnap.exists) return null;
  const aliasData = aliasSnap.data() || {};
  const contributorId = aliasData.contributorId || null;
  if (!contributorId) return null;
  const contributorSnap = await db.collection('contributors').doc(contributorId).get();
  if (!contributorSnap.exists) return null;

  return {
    alias: {
      id: type === 'email' ? null : aliasSnap.id,
      type: aliasData.type || type,
      contributorId,
    },
    contributor: toPublicContributor(contributorSnap.id, contributorSnap.data() || {}),
  };
});

export const createTemporaryContributor = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (isCodexDevForProductionDeny({ uid: request.auth.uid, ...(request.auth.token || {}) })) {
    throw new HttpsError('permission-denied', 'Codex Dev contributors are isolated');
  }
  if (await isKnownCodexDevActorUid({ db, uid: request.auth.uid })) {
    throw new HttpsError('permission-denied', 'Codex Dev contributors are isolated');
  }

  const displayName = toContributorString(request.data?.displayName).replace(/\s+/g, ' ').slice(0, 80);
  if (!displayName) {
    throw new HttpsError('invalid-argument', 'displayName is required');
  }

  const {
    aliases,
    normalizedInstagram,
    normalizedDomain,
    normalizedEmail,
  } = buildTemporaryContributorAliases({
    instagramHandle: request.data?.instagramHandle,
    website: request.data?.website,
    email: request.data?.email,
  });

  if (normalizedEmail && !isValidContributorEmail(normalizedEmail)) {
    throw new HttpsError('invalid-argument', 'Invalid email alias');
  }

  const contributorRef = db.collection('contributors').doc();
  const aliasRefs = aliases.map((alias) => ({
    ...alias,
    aliasId: makeContributorAliasId(alias.type, alias.value),
    ref: db.collection('contributorAliases').doc(makeContributorAliasId(alias.type, alias.value)),
  }));

  await db.runTransaction(async (transaction) => {
    if (await isKnownCodexDevActorUid({ db, uid: request.auth.uid, transaction })) {
      throw new HttpsError('permission-denied', 'Codex Dev contributors are isolated');
    }
    for (const alias of aliasRefs) {
      const existing = await transaction.get(alias.ref);
      if (existing.exists) {
        throw new HttpsError('already-exists', `Alias already claimed: ${alias.aliasId}`);
      }
    }

    transaction.set(contributorRef, {
      displayName,
      displayNameLower: displayName.toLowerCase(),
      instagramHandle: normalizedInstagram || null,
      website: normalizedDomain || null,
      hasEmail: Boolean(normalizedEmail),
      status: 'unclaimed',
      createdByUid: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (normalizedEmail) {
      transaction.set(getContributorContactRef(contributorRef.id), {
        email: normalizedEmail,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    aliasRefs.forEach((alias) => {
      transaction.set(alias.ref, {
        type: alias.type,
        value: alias.value,
        contributorId: contributorRef.id,
        createdByUid: request.auth.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  });

  return {
    contributorId: contributorRef.id,
    aliasIds: aliasRefs.filter((alias) => alias.type !== 'email').map((alias) => alias.aliasId),
    contributor: {
      id: contributorRef.id,
      displayName,
      instagramHandle: normalizedInstagram || null,
      website: normalizedDomain || null,
      hasEmail: Boolean(normalizedEmail),
      status: 'unclaimed',
    },
  };
});

export const createClaimInvite = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (isCodexDevForProductionDeny({ uid: request.auth.uid, ...(request.auth.token || {}) })) {
    throw new HttpsError('permission-denied', 'Codex Dev claim invites are isolated');
  }
  if (await isKnownCodexDevActorUid({ db, uid: request.auth.uid })) {
    throw new HttpsError('permission-denied', 'Codex Dev claim invites are isolated');
  }
  const contributorId = request.data?.contributorId || null;
  const postId = request.data?.postId || null;
  if (!contributorId) {
    throw new HttpsError('invalid-argument', 'contributorId is required');
  }

  const contributorSnap = await db.collection('contributors').doc(contributorId).get();
  if (!contributorSnap.exists) {
    throw new HttpsError('not-found', 'Contributor not found');
  }

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + claimInviteExpiryMs));
  const rateRef = db.collection('claimInviteRateLimits').doc(request.auth.uid);

  const inviteRef = db.collection('claimInvites').doc(token);
  await createClaimInviteAtomically({
    db,
    uid: request.auth.uid,
    rateRef,
    inviteRef,
    todayKey: getDateKey(),
    rateLimitPerDay: claimInviteRateLimitPerDay,
    serverTimestamp: FieldValue.serverTimestamp,
    createError: (code, message) => new HttpsError(code, message),
    inviteData: {
      contributorId,
      postId,
      createdByUid: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      usedAt: null,
      usedByUid: null,
    },
  });

  return { path: `/claim/${token}` };
});

export const getClaimInvitePreview = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const token = req.method === 'GET'
      ? String(req.query?.token || '')
      : String(parseJsonBody(req)?.token || '');
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    const inviteSnap = await db.collection('claimInvites').doc(token).get();
    if (!inviteSnap.exists) {
      res.status(404).json({ error: 'Invite not found' });
      return;
    }

    const inviteData = inviteSnap.data() || {};
    if (inviteData?.usedAt) {
      res.status(410).json({ error: 'Invite already used' });
      return;
    }
    const expiresAt = inviteData?.expiresAt instanceof Timestamp ? inviteData.expiresAt : null;
    if (!expiresAt || expiresAt.toMillis() <= Date.now()) {
      res.status(410).json({ error: 'Invite expired' });
      return;
    }

    const contributorId = inviteData?.contributorId || null;
    if (!contributorId) {
      res.status(404).json({ error: 'Contributor missing' });
      return;
    }

    const contributorSnap = await db.collection('contributors').doc(contributorId).get();
    if (!contributorSnap.exists) {
      res.status(404).json({ error: 'Contributor not found' });
      return;
    }

    const contributor = contributorSnap.data() || {};
    const availableProofMethods = [];
    if (contributor?.instagramHandle) availableProofMethods.push('instagram');
    const websiteAlias = await fetchContributorWebsiteAlias(contributorId);
    if (websiteAlias) availableProofMethods.push('website');
    const contactSnap = await getContributorContactRef(contributorId).get();
    const contact = contactSnap.exists ? (contactSnap.data() || {}) : {};
    const contributorEmail = String(contact?.email || '').trim().toLowerCase();
    if (contributorEmail) availableProofMethods.push('email');
    availableProofMethods.push('vouch');

    const hints = {};
    if (websiteAlias?.domain) hints.websiteDomain = websiteAlias.domain;
    const emailMasked = maskEmailHint(contributorEmail);
    if (emailMasked) hints.emailMasked = emailMasked;
    const instagramHandle = normalizeInstagramHint(contributor?.instagramHandle);
    if (instagramHandle) hints.instagramHandle = instagramHandle;

    res.status(200).json({
      ok: true,
      displayName: contributor?.displayName || 'Onbekende maker',
      contributorId,
      availableProofMethods,
      hints,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to load invite preview' });
  }
});

export const createClaimRequest = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)
      || await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev contributor claims are isolated.' });
      return;
    }
    const body = parseJsonBody(req);
    const contributorId = body?.contributorId || null;
    const inviteToken = body?.inviteToken || null;
    const mode = body?.mode === 'merge' ? 'merge' : 'link';
    const status = body?.status === 'needsModeration' ? 'needsModeration' : 'pending';
    const statusReason = status === 'needsModeration' ? (body?.statusReason || 'manual review requested') : null;
    if (!contributorId) {
      res.status(400).json({ error: 'contributorId is required' });
      return;
    }

    const profile = await fetchUserProfile(decoded.uid);
    if (!canCreateClaimRequest(profile)) {
      res.status(403).json({ error: 'ID check required to create claim request' });
      return;
    }

    const contributorSnap = await db.collection('contributors').doc(contributorId).get();
    if (!contributorSnap.exists) {
      res.status(404).json({ error: 'Contributor not found' });
      return;
    }

    const eligibleVoterUids = await buildEligibleVouchers({ contributorId, claimantUid: decoded.uid });
    const now = Date.now();
    const expiresAt = Timestamp.fromDate(new Date(now + claimTimeoutMs));
    const claimCode = generateClaimCode();
    const claimCodeExpiresAt = Timestamp.fromDate(new Date(now + claimCodeExpiryMs));
    const proofMethod = body?.method || 'vouch';

    const inviteRef = inviteToken ? db.collection('claimInvites').doc(inviteToken) : null;
    let requestId = null;
    await db.runTransaction(async (transaction) => {
      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {
        const error = new Error('Codex Dev contributor claims are isolated.');
        error.status = 403;
        throw error;
      }
      if (inviteRef) {
        const inviteSnap = await transaction.get(inviteRef);
        if (!inviteSnap.exists) {
          const error = new Error('Invite not found');
          error.status = 404;
          throw error;
        }
        const inviteData = inviteSnap.data() || {};
        if (inviteData?.usedAt) {
          const error = new Error('Invite already used');
          error.status = 410;
          throw error;
        }
        const inviteExpiresAt = inviteData?.expiresAt instanceof Timestamp ? inviteData.expiresAt : null;
        if (!inviteExpiresAt || inviteExpiresAt.toMillis() <= Date.now()) {
          const error = new Error('Invite expired');
          error.status = 410;
          throw error;
        }
        if (inviteData?.contributorId && inviteData.contributorId !== contributorId) {
          const error = new Error('Invite does not match contributor');
          error.status = 409;
          throw error;
        }
      }

      const requestRef = db.collection('claimRequests').doc();
      requestId = requestRef.id;
      transaction.set(requestRef, {
        contributorId,
        requestedByUid: decoded.uid,
        mode,
        proofMethod,
        claimCode,
        claimCodeExpiresAt,
        status,
        statusReason,
        yesCount: 0,
        noCount: 0,
        eligibleVoterUids,
        inviteToken: inviteToken || null,
        proofData: {
          screenshotVerified: false,
          emailVerified: false,
          websiteVerified: false,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt,
      });

      if (inviteRef) {
        transaction.update(inviteRef, {
          usedAt: FieldValue.serverTimestamp(),
          usedByUid: decoded.uid,
          usedRequestId: requestId,
        });
      }
    });

    res.status(200).json({
      ok: true,
      requestId,
      eligibleVoterUids,
      claimCode,
      claimCodeExpiresAt: claimCodeExpiresAt.toMillis(),
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to create claim request' });
  }
});

export const startEmailClaimProof = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (isCodexDevForProductionDeny({ uid: request.auth.uid, ...(request.auth.token || {}) })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
  if (await isKnownCodexDevActorUid({ db, uid: request.auth.uid })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
  const requestId = request.data?.requestId || null;
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'requestId is required');
  }

  const requestRef = db.collection('claimRequests').doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpsError('not-found', 'Claim request not found');
  }

  const requestData = requestSnap.data() || {};
  if (requestData?.requestedByUid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Not allowed to start email proof');
  }
  if (requestData?.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Claim request is not pending');
  }

  const contributorId = requestData?.contributorId || null;
  if (!contributorId) {
    throw new HttpsError('failed-precondition', 'Contributor missing');
  }
  const contributorSnap = await db.collection('contributors').doc(contributorId).get();
  if (!contributorSnap.exists) {
    throw new HttpsError('not-found', 'Contributor not found');
  }
  const contactSnap = await getContributorContactRef(contributorId).get();
  const contact = contactSnap.exists ? (contactSnap.data() || {}) : {};
  const email = String(contact?.email || '').trim().toLowerCase();
  if (!email) {
    throw new HttpsError('failed-precondition', 'No email alias available');
  }

  const token = crypto.randomBytes(18).toString('hex');
  const tokenHash = hashEmailProofToken(token);
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + emailProofExpiryMs));
  await db.runTransaction(async (transaction) => {
    const freshRequestSnap = await transaction.get(requestRef);
    if (!freshRequestSnap.exists) throw new HttpsError('not-found', 'Claim request not found');
    const freshData = freshRequestSnap.data() || {};
    if (freshData?.requestedByUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Not allowed to start email proof');
    if (await isKnownCodexDevActorUid({ db, uid: freshData.requestedByUid, transaction })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
    if (freshData?.status !== 'pending') throw new HttpsError('failed-precondition', 'Claim request is not pending');
    transaction.set(requestRef, {
    proofData: {
      email: {
        email,
        tokenHash,
        tokenExpiresAt: expiresAt,
        tokenCreatedAt: FieldValue.serverTimestamp(),
        lastCheckResult: 'pending',
        lastCheckedAt: null,
      },
      emailVerified: false,
      emailVerifiedAt: null,
    },
    updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return {
    token,
    emailMasked: maskEmailHint(email),
    expiresAt: expiresAt.toMillis(),
    path: `/claim-email?requestId=${requestId}&token=${token}`,
  };
});

export const startWebsiteClaimProof = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (isCodexDevForProductionDeny({ uid: request.auth.uid, ...(request.auth.token || {}) })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
  if (await isKnownCodexDevActorUid({ db, uid: request.auth.uid })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
  const requestId = request.data?.requestId || null;
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'requestId is required');
  }

  const requestRef = db.collection('claimRequests').doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpsError('not-found', 'Claim request not found');
  }

  const requestData = requestSnap.data() || {};
  if (requestData?.requestedByUid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Not allowed to start website proof');
  }
  if (requestData?.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Claim request is not pending');
  }
  const contributorId = requestData?.contributorId || null;
  const websiteAlias = await fetchContributorWebsiteAlias(contributorId);
  if (!websiteAlias?.domain) {
    throw new HttpsError('failed-precondition', 'No website alias available');
  }

  const token = crypto.randomBytes(18).toString('hex');
  const tokenHash = hashWebsiteProofToken(token);
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + websiteProofExpiryMs));
  await db.runTransaction(async (transaction) => {
    const freshRequestSnap = await transaction.get(requestRef);
    if (!freshRequestSnap.exists) throw new HttpsError('not-found', 'Claim request not found');
    const freshData = freshRequestSnap.data() || {};
    if (freshData?.requestedByUid !== request.auth.uid) throw new HttpsError('permission-denied', 'Not allowed to start website proof');
    if (await isKnownCodexDevActorUid({ db, uid: freshData.requestedByUid, transaction })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
    if (freshData?.status !== 'pending') throw new HttpsError('failed-precondition', 'Claim request is not pending');
    transaction.set(requestRef, {
    proofData: {
      website: {
        domain: websiteAlias.domain,
        aliasId: websiteAlias.aliasId,
        tokenHash,
        tokenExpiresAt: expiresAt,
        tokenCreatedAt: FieldValue.serverTimestamp(),
        verifyAttempts: 0,
        verifyWindowStart: FieldValue.serverTimestamp(),
      },
      websiteVerified: false,
      websiteVerifiedAt: null,
    },
    updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  const url = buildWebsiteClaimUrl(websiteAlias.domain);
  return {
    token,
    url,
    domain: websiteAlias.domain,
    expiresAt: expiresAt.toMillis(),
    instructions: `Plaats een tekstbestand op ${url} met exact deze token als inhoud.`,
  };
});

export const verifyEmailClaimProof = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (isCodexDevForProductionDeny({ uid: request.auth.uid, ...(request.auth.token || {}) })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
  const requestId = request.data?.requestId || null;
  const token = request.data?.token || null;
  if (!requestId || !token) {
    throw new HttpsError('invalid-argument', 'requestId and token are required');
  }

  const requestRef = db.collection('claimRequests').doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    throw new HttpsError('not-found', 'Claim request not found');
  }
  const requestData = requestSnap.data() || {};
  if (await isKnownCodexDevActorUid({ db, uid: requestData?.requestedByUid })) {
    throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
  }
  if (requestData?.requestedByUid !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Not allowed to verify email proof');
  }
  if (requestData?.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'Claim request is not pending');
  }

  const emailProof = requestData?.proofData?.email || null;
  if (!emailProof?.tokenHash || !emailProof?.tokenExpiresAt) {
    throw new HttpsError('failed-precondition', 'Email proof is not initialized');
  }
  const tokenHash = hashEmailProofToken(token);
  const expiresAtMs = emailProof.tokenExpiresAt?.toMillis
    ? emailProof.tokenExpiresAt.toMillis()
    : new Date(emailProof.tokenExpiresAt).getTime();
  const now = Date.now();

  const persistEmailProofFailure = async (updates) => db.runTransaction(async (transaction) => {
    const freshRequestSnap = await transaction.get(requestRef);
    if (!freshRequestSnap.exists) return false;
    const freshData = freshRequestSnap.data() || {};
    if (freshData?.requestedByUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Not allowed to verify email proof');
    }
    if (freshData?.status !== 'pending') return false;
    const freshEmailProof = freshData?.proofData?.email || null;
    if (!freshEmailProof?.tokenHash || freshEmailProof.tokenHash !== emailProof.tokenHash) return false;
    if (await isKnownCodexDevActorUid({ db, uid: freshData.requestedByUid, transaction })) {
      return false;
    }
    transaction.update(requestRef, updates);
    return true;
  });

  if (!expiresAtMs || Number.isNaN(expiresAtMs) || now > expiresAtMs) {
    await persistEmailProofFailure({
      'proofData.email.lastCheckedAt': FieldValue.serverTimestamp(),
      'proofData.email.lastCheckResult': 'expired',
      'proofData.emailVerified': false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError('failed-precondition', 'Email token is verlopen.');
  }

  if (tokenHash !== emailProof.tokenHash) {
    await persistEmailProofFailure({
      'proofData.email.lastCheckedAt': FieldValue.serverTimestamp(),
      'proofData.email.lastCheckResult': 'invalid',
      'proofData.emailVerified': false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError('failed-precondition', 'Email token is ongeldig.');
  }

  let resolvedStatus = 'pending';
  await db.runTransaction(async (transaction) => {
    const freshSnap = await transaction.get(requestRef);
    if (!freshSnap.exists) return;
    const data = freshSnap.data() || {};
    if (await isKnownCodexDevActorUid({ db, uid: data?.requestedByUid, transaction })) {
      throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
    }
    const updates = {
      'proofData.emailVerified': true,
      'proofData.emailVerifiedAt': FieldValue.serverTimestamp(),
      'proofData.email.lastCheckedAt': FieldValue.serverTimestamp(),
      'proofData.email.lastCheckResult': 'verified',
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data?.status !== 'pending') {
      transaction.update(requestRef, updates);
      resolvedStatus = data?.status || 'pending';
      return;
    }

    const yesCount = Number(data?.yesCount || 0);
    const noCount = Number(data?.noCount || 0);
    const mode = data?.mode === 'merge' ? 'merge' : 'link';
    if (yesCount >= 1 && noCount < 1 && mode === 'link') {
      const contributorId = data?.contributorId || null;
      const requestedByUid = data?.requestedByUid || null;
      if (contributorId && requestedByUid) {
        const contributorRef = db.collection('contributors').doc(contributorId);
        const claimantRef = db.collection('users').doc(requestedByUid);
        transaction.update(claimantRef, {
          contributorId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(contributorRef, {
          claimedByUid: requestedByUid,
          claimedAt: FieldValue.serverTimestamp(),
          status: 'claimed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(requestRef, {
          ...updates,
          status: 'approved',
          statusReason: null,
          approvedAt: FieldValue.serverTimestamp(),
        });
        resolvedStatus = 'approved';
        return;
      }
    }

    if (yesCount >= 1 && (noCount >= 1 || mode === 'merge')) {
      transaction.update(requestRef, {
        ...updates,
        status: 'needsModeration',
        statusReason: mode === 'merge' ? 'merge requested' : 'vouch conflict',
      });
      resolvedStatus = 'needsModeration';
      return;
    }

    transaction.update(requestRef, updates);
    resolvedStatus = 'pending';
  });

  return { ok: true, verified: true, status: resolvedStatus };
});

export const verifyWebsiteClaimProof = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }
  if (isCodexDevForProductionDeny({ uid: request.auth.uid, ...(request.auth.token || {}) })) throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
  const requestId = request.data?.requestId || null;
  if (!requestId) {
    throw new HttpsError('invalid-argument', 'requestId is required');
  }

  const requestRef = db.collection('claimRequests').doc(requestId);
  let proofPayload = null;
  await db.runTransaction(async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) {
      throw new HttpsError('not-found', 'Claim request not found');
    }
    const data = requestSnap.data() || {};
    if (await isKnownCodexDevActorUid({ db, uid: data?.requestedByUid, transaction })) {
      throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
    }
    if (data?.requestedByUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Not allowed to verify website proof');
    }
    if (data?.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Claim request is not pending');
    }
    const websiteProof = data?.proofData?.website || null;
    if (!websiteProof?.domain || !websiteProof?.tokenHash || !websiteProof?.tokenExpiresAt) {
      throw new HttpsError('failed-precondition', 'Website proof is not initialized');
    }
    const now = Date.now();
    const windowStart = websiteProof.verifyWindowStart?.toDate?.().getTime() || 0;
    const windowExpired = !windowStart || now - windowStart > websiteProofVerifyWindowMs;
    const attempts = windowExpired ? 0 : Number(websiteProof.verifyAttempts || 0);
    if (attempts >= websiteProofVerifyLimit) {
      throw new HttpsError('resource-exhausted', 'Too many verification attempts');
    }
    const nextWindowStart = windowExpired ? now : windowStart;
    transaction.update(requestRef, {
      'proofData.website.verifyAttempts': attempts + 1,
      'proofData.website.verifyWindowStart': Timestamp.fromDate(new Date(nextWindowStart)),
      'proofData.website.lastVerifyAttemptAt': FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    proofPayload = {
      domain: websiteProof.domain,
      tokenHash: websiteProof.tokenHash,
      tokenExpiresAt: websiteProof.tokenExpiresAt,
    };
  });

  if (!proofPayload) {
    throw new HttpsError('failed-precondition', 'Website proof is not initialized');
  }

  const persistWebsiteProofFailure = async (updates) => db.runTransaction(async (transaction) => {
    const freshRequestSnap = await transaction.get(requestRef);
    if (!freshRequestSnap.exists) return false;
    const freshData = freshRequestSnap.data() || {};
    if (freshData?.requestedByUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'Not allowed to verify website proof');
    }
    if (freshData?.status !== 'pending') return false;
    if (await isKnownCodexDevActorUid({ db, uid: freshData.requestedByUid, transaction })) {
      return false;
    }
    transaction.update(requestRef, updates);
    return true;
  });

  const url = buildWebsiteClaimUrl(proofPayload.domain);
  let responseBody = '';
  try {
    responseBody = await fetchWebsiteClaimText({
      hostname: proofPayload.domain,
      url,
      timeoutMs: websiteProofFetchTimeoutMs,
      maxBytes: websiteProofMaxBytes,
      maxRedirects: websiteProofMaxRedirects,
    });
  } catch (error) {
    await persistWebsiteProofFailure({
      'proofData.website.lastCheckedAt': FieldValue.serverTimestamp(),
      'proofData.website.lastCheckResult': 'fetch_failed',
      'proofData.website.lastCheckMessage': error?.message || 'Fetch failed',
      updatedAt: FieldValue.serverTimestamp(),
    });
    throw new HttpsError('failed-precondition', 'Website verificatie mislukt.');
  }

  const now = Date.now();
  const expiresAtMs = proofPayload.tokenExpiresAt?.toMillis ? proofPayload.tokenExpiresAt.toMillis() : null;
  const tokenCheck = checkWebsiteClaimToken({
    tokenHash: proofPayload.tokenHash,
    tokenExpiresAtMs: expiresAtMs,
    responseBody,
    now,
  });

  if (!tokenCheck.ok) {
    await persistWebsiteProofFailure({
      'proofData.website.lastCheckedAt': FieldValue.serverTimestamp(),
      'proofData.website.lastCheckResult': tokenCheck.reason || 'invalid',
      'proofData.website.lastCheckPreview': String(responseBody || '').trim().slice(0, 200),
      'proofData.websiteVerified': false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const errorMessage = tokenCheck.reason === 'expired'
      ? 'Website token is verlopen.'
      : 'Website token niet gevonden.';
    throw new HttpsError('failed-precondition', errorMessage);
  }

  let resolvedStatus = 'pending';
  await db.runTransaction(async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists) return;
    const data = requestSnap.data() || {};
    if (await isKnownCodexDevActorUid({ db, uid: data?.requestedByUid, transaction })) {
      throw new HttpsError('permission-denied', 'Codex Dev contributor claims are isolated');
    }
    const updates = {
      'proofData.websiteVerified': true,
      'proofData.websiteVerifiedAt': FieldValue.serverTimestamp(),
      'proofData.website.lastCheckedAt': FieldValue.serverTimestamp(),
      'proofData.website.lastCheckResult': 'verified',
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data?.status !== 'pending') {
      transaction.update(requestRef, updates);
      resolvedStatus = data?.status || 'pending';
      return;
    }

    const yesCount = Number(data?.yesCount || 0);
    const noCount = Number(data?.noCount || 0);
    const mode = data?.mode === 'merge' ? 'merge' : 'link';
    if (yesCount >= 1 && noCount < 1 && mode === 'link') {
      const contributorId = data?.contributorId || null;
      const requestedByUid = data?.requestedByUid || null;
      if (contributorId && requestedByUid) {
        const contributorRef = db.collection('contributors').doc(contributorId);
        const claimantRef = db.collection('users').doc(requestedByUid);
        transaction.update(claimantRef, {
          contributorId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(contributorRef, {
          claimedByUid: requestedByUid,
          claimedAt: FieldValue.serverTimestamp(),
          status: 'claimed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(requestRef, {
          ...updates,
          status: 'approved',
          statusReason: null,
          approvedAt: FieldValue.serverTimestamp(),
        });
        resolvedStatus = 'approved';
        return;
      }
    }

    if (yesCount >= 1 && (noCount >= 1 || mode === 'merge')) {
      transaction.update(requestRef, {
        ...updates,
        status: 'needsModeration',
        statusReason: mode === 'merge' ? 'merge requested' : 'vouch conflict',
      });
      resolvedStatus = 'needsModeration';
      return;
    }

    transaction.update(requestRef, updates);
    resolvedStatus = 'pending';
  });

  return { ok: true, verified: true, status: resolvedStatus };
});

export const mergeContributors = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    const { email } = await ensureModerator(decoded);
    const body = parseJsonBody(req);
    const primaryContributorId = body?.primaryContributorId || null;
    const secondaryContributorId = body?.secondaryContributorId || null;
    const result = await mergeContributorsInternal({
      primaryContributorId,
      secondaryContributorId,
      moderatorEmail: email,
      source: 'manual',
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to merge contributors' });
  }
});

export const moderatorApproveClaimRequest = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    const { email } = await ensureModerator(decoded);
    const body = parseJsonBody(req);
    const requestId = body?.requestId || null;
    const primaryOverride = body?.primaryContributorId || null;
    const secondaryOverride = body?.secondaryContributorId || null;

    if (!requestId) {
      res.status(400).json({ error: 'requestId is required' });
      return;
    }

    const requestRef = db.collection('claimRequests').doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      res.status(404).json({ error: 'Claim request not found' });
      return;
    }

    const requestData = requestSnap.data() || {};
    const mode = requestData?.mode === 'merge' ? 'merge' : 'link';
    const requestedByUid = requestData?.requestedByUid || null;
    const contributorId = primaryOverride || requestData?.contributorId || null;

    if (await isKnownCodexDevActorUid({ db, uid: requestedByUid })) {
      res.status(403).json({ error: 'Codex Dev contributor claims are isolated.' });
      return;
    }

    if (!requestedByUid || !contributorId) {
      res.status(400).json({ error: 'Claim request missing contributor or requester' });
      return;
    }

    if (requestData?.status === 'approved') {
      res.status(409).json({ error: 'Claim request already approved' });
      return;
    }

    if (mode === 'merge') {
      const requesterProfile = await fetchUserProfile(requestedByUid);
      const secondaryContributorId = secondaryOverride || requesterProfile?.contributorId || null;
      if (!secondaryContributorId) {
        res.status(400).json({ error: 'Secondary contributor is required for merge' });
        return;
      }
      const mergeFenceToken = crypto.randomUUID();
      await acquireCodexDevMergeFence({ db, uid: requestedByUid, token: mergeFenceToken });
      try {
        const mergeResult = await mergeContributorsInternal({
          primaryContributorId: contributorId,
          secondaryContributorId,
          moderatorEmail: email,
          source: 'claimRequest',
          denyActorUid: requestedByUid,
          mergeFenceToken,
        });
        await db.runTransaction(async (transaction) => {
          const freshRequestSnap = await transaction.get(requestRef);
          if (!freshRequestSnap.exists) {
            const error = new Error('Claim request disappeared during contributor merge.');
            error.status = 409;
            throw error;
          }
          const freshRequestedByUid = freshRequestSnap.data()?.requestedByUid || null;
          const fenceValidation = await assertMergeActorAllowed({
            transaction,
            denyActorUid: freshRequestedByUid,
            mergeFenceToken,
          });
          queueCodexDevMergeFenceRenewal({ transaction, validation: fenceValidation, mutationCommitted: true });
          transaction.set(db.collection('users').doc(freshRequestedByUid), {
            contributorId,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          transaction.set(requestRef, {
            status: 'approved',
            statusReason: null,
            approvedAt: FieldValue.serverTimestamp(),
            approvedByEmail: email,
            primaryContributorId: contributorId,
            secondaryContributorId,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        await releaseCodexDevMergeFence({ db, uid: requestedByUid, token: mergeFenceToken });
        res.status(200).json({ ok: true, status: 'approved', merge: mergeResult });
        return;
      } catch (error) {
        try {
          await releaseCodexDevMergeFenceIfUnmutated({ db, uid: requestedByUid, token: mergeFenceToken });
        } catch (releaseError) {
          logger.error('Failed to inspect merge fence after claim merge failure', {
            requestId,
            error: releaseError?.message || String(releaseError),
          });
        }
        throw error;
      }
    }

    await db.runTransaction(async (transaction) => {
      const freshRequestSnap = await transaction.get(requestRef);
      if (!freshRequestSnap.exists) return;
      const freshRequestedByUid = freshRequestSnap.data()?.requestedByUid || null;
      if (await isKnownCodexDevActorUid({ db, uid: freshRequestedByUid, transaction })) {
        const error = new Error('Codex Dev contributor claims are isolated.');
        error.status = 403;
        throw error;
      }
      const contributorRef = db.collection('contributors').doc(contributorId);
      const claimantRef = db.collection('users').doc(freshRequestedByUid);
      const contributorSnap = await transaction.get(contributorRef);
      if (!contributorSnap.exists) {
        const error = new Error('Contributor not found');
        error.status = 404;
        throw error;
      }
      transaction.update(claimantRef, {
        contributorId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(contributorRef, {
        claimedByUid: freshRequestedByUid,
        claimedAt: FieldValue.serverTimestamp(),
        status: 'claimed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(requestRef, {
        status: 'approved',
        statusReason: null,
        approvedAt: FieldValue.serverTimestamp(),
        approvedByEmail: email,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    res.status(200).json({ ok: true, status: 'approved' });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to approve claim request' });
  }
});

export const getVouchRequests = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)) {
      res.status(403).json({ error: 'Codex Dev contributor claims are isolated.' });
      return;
    }
    if (await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev contributor claims are isolated.' });
      return;
    }
    const snapshot = await db.collection('claimRequests')
      .where('status', '==', 'pending')
      .where('eligibleVoterUids', 'array-contains', decoded.uid)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const requests = await Promise.all(snapshot.docs.map(async (docSnap) => {
      const data = docSnap.data();
      const contributorId = data?.contributorId || null;
      let contributorName = null;
      if (contributorId) {
        const contributorSnap = await db.collection('contributors').doc(contributorId).get();
        contributorName = contributorSnap.exists ? (contributorSnap.data()?.displayName || null) : null;
      }
      return {
        id: docSnap.id,
        contributorId,
        contributorName,
        requestedByUid: data?.requestedByUid || null,
        mode: data?.mode || 'link',
        status: data?.status || 'pending',
        yesCount: data?.yesCount || 0,
        noCount: data?.noCount || 0,
        createdAt: data?.createdAt || null,
      };
    }));

    res.status(200).json({ ok: true, requests });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to fetch vouch requests' });
  }
});

export const cleanupCodexTestData = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyToken(req);
    await ensureModerator(decoded);

    const body = parseJsonBody(req) || {};
    const dryRun = body?.dryRun !== false;
    const confirm = String(body?.confirm || '');
    const targetUid = resolveCodexDevUid();

    if (!dryRun && confirm !== targetUid) {
      res.status(400).json({ error: `confirm must equal ${targetUid} for execute mode` });
      return;
    }

    const deleteInBatches = async (refs = []) => {
      if (dryRun || refs.length === 0) return { deleted: 0, failed: [] };
      let deleted = 0;
      const failed = [];
      const chunkSize = 400;

      for (let i = 0; i < refs.length; i += chunkSize) {
        const chunk = refs.slice(i, i + chunkSize);
        const batch = db.batch();
        chunk.forEach((ref) => batch.delete(ref));
        try {
          await batch.commit();
          deleted += chunk.length;
        } catch (error) {
          chunk.forEach((ref) => failed.push({ path: ref.path, error: error?.message || String(error) }));
        }
      }

      return { deleted, failed };
    };

    const [
      postsByAuthorIdSnap,
      postsByAuthorUidSnap,
      codexDevPostsSnap,
      uploadsSnap,
      commentsSnap,
      likesSnap,
      followsSnap,
    ] = await Promise.all([
      db.collection('posts').where('authorId', '==', targetUid).get(),
      db.collection('posts').where('authorUid', '==', targetUid).get(),
      db.collection('codexDevPosts').where('authorId', '==', targetUid).get(),
      db.collection('uploads').where('userId', '==', targetUid).get(),
      db.collectionGroup('comments').where('authorId', '==', targetUid).get(),
      db.collectionGroup('likes').get(),
      db.collection('users').doc(targetUid).collection('following').get(),
    ]);

    const postsById = new Map();
    postsByAuthorIdSnap.docs.forEach((docSnap) => {
      postsById.set(docSnap.id, docSnap);
    });
    postsByAuthorUidSnap.docs.forEach((docSnap) => {
      postsById.set(docSnap.id, docSnap);
    });
    const postDocs = Array.from(postsById.values());

    const codexUploadIds = new Set(uploadsSnap.docs.map((docSnap) => docSnap.id));
    const reviewCasesByUserSnap = await db
      .collection('reviewCases')
      .where('caseType', '==', 'upload')
      .where('userId', '==', targetUid)
      .get();

    const reviewCaseDocs = reviewCasesByUserSnap.docs.filter((docSnap) => {
      const data = docSnap.data() || {};
      const uploadId = data?.uploadId || null;
      const linkedUploadIds = Array.isArray(data?.linkedUploadIds) ? data.linkedUploadIds : [];
      if (uploadId && codexUploadIds.has(uploadId)) return true;
      return linkedUploadIds.some((id) => codexUploadIds.has(id));
    });

    const likesRefs = likesSnap.docs
      .filter((docSnap) => docSnap.id === targetUid)
      .map((docSnap) => docSnap.ref);
    const commentsRefs = commentsSnap.docs.map((docSnap) => docSnap.ref);
    const followsRefs = followsSnap.docs.map((docSnap) => docSnap.ref);
    const postsRefs = postDocs.map((docSnap) => docSnap.ref);
    const reviewCaseRefs = reviewCaseDocs.map((docSnap) => docSnap.ref);
    const uploadsRefs = uploadsSnap.docs.map((docSnap) => docSnap.ref);

    const summary = {
      targetUid,
      mode: dryRun ? 'dryRun' : 'execute',
      counts: {
        likes: likesRefs.length,
        comments: commentsRefs.length,
        follows: followsRefs.length,
        posts: postsRefs.length,
        codexDevPosts: codexDevPostsSnap.size,
        reviewCases: reviewCaseRefs.length,
        uploads: uploadsRefs.length,
      },
      samples: {
        likes: likesRefs.slice(0, 20).map((ref) => ref.path),
        comments: commentsRefs.slice(0, 20).map((ref) => ref.path),
        follows: followsRefs.slice(0, 20).map((ref) => ref.path),
        posts: postsRefs.slice(0, 20).map((ref) => ref.path),
        codexDevPosts: codexDevPostsSnap.docs.slice(0, 20).map((docSnap) => docSnap.ref.path),
        reviewCases: reviewCaseRefs.slice(0, 20).map((ref) => ref.path),
        uploads: uploadsRefs.slice(0, 20).map((ref) => ref.path),
      },
      guard: {
        moderatorEmail: decoded?.email || null,
      },
      order: ['likes', 'comments', 'follows', 'posts', 'codexDevPosts', 'reviewCases', 'uploads'],
    };

    if (dryRun) {
      res.status(200).json({ ok: true, ...summary });
      return;
    }

    const failures = [];
    const deletedCounts = {};

    const likeResult = await deleteInBatches(likesRefs);
    deletedCounts.likes = likeResult.deleted;
    failures.push(...likeResult.failed);

    const commentResult = await deleteInBatches(commentsRefs);
    deletedCounts.comments = commentResult.deleted;
    failures.push(...commentResult.failed);

    const followResult = await deleteInBatches(followsRefs);
    deletedCounts.follows = followResult.deleted;
    failures.push(...followResult.failed);

    const postResult = await deleteInBatches(postsRefs);
    deletedCounts.posts = postResult.deleted;
    failures.push(...postResult.failed);

    const codexDevPostResult = await cleanupCodexDevPostTrees({ db, postDocs: codexDevPostsSnap.docs, dryRun });
    deletedCounts.codexDevPosts = codexDevPostResult.deleted;
    failures.push(...codexDevPostResult.failed);

    const reviewCaseResult = await deleteInBatches(reviewCaseRefs);
    deletedCounts.reviewCases = reviewCaseResult.deleted;
    failures.push(...reviewCaseResult.failed);

    const uploadResult = await deleteInBatches(uploadsRefs);
    deletedCounts.uploads = uploadResult.deleted;
    failures.push(...uploadResult.failed);

    res.status(200).json({
      ok: failures.length === 0,
      ...summary,
      deletedCounts,
      failed: failures,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to cleanup codex test data' });
  }
});

export const submitClaimVouch = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    if (isCodexDevForProductionDeny(decoded)) {
      res.status(403).json({ error: 'Codex Dev contributor claims are isolated.' });
      return;
    }
    if (await isKnownCodexDevActorUid({ db, uid: decoded.uid })) {
      res.status(403).json({ error: 'Codex Dev contributor claims are isolated.' });
      return;
    }
    const body = parseJsonBody(req);
    const requestId = body?.requestId || null;
    const vote = claimVoteOptions.includes(body?.vote) ? body.vote : null;
    if (!requestId || !vote) {
      res.status(400).json({ error: 'requestId and vote are required' });
      return;
    }

    const requestRef = db.collection('claimRequests').doc(requestId);
    const voteRef = db.collection('claimVouches').doc(requestId).collection('votes').doc(decoded.uid);
    let responsePayload = { ok: true };

    await db.runTransaction(async (transaction) => {
      if (await isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })) {
        const error = new Error('Codex Dev contributor claims are isolated.');
        error.status = 403;
        throw error;
      }
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) {
        const error = new Error('Claim request not found');
        error.status = 404;
        throw error;
      }
      const data = requestSnap.data();
      if (await isKnownCodexDevActorUid({ db, uid: data?.requestedByUid, transaction })) {
        const error = new Error('Codex Dev contributor claims are isolated.');
        error.status = 403;
        throw error;
      }
      if (!claimStatuses.includes(data?.status)) {
        const error = new Error('Invalid claim request status');
        error.status = 400;
        throw error;
      }
      if (data.status !== 'pending') {
        const error = new Error('Claim request is not pending');
        error.status = 409;
        throw error;
      }
      if (!Array.isArray(data?.eligibleVoterUids) || !data.eligibleVoterUids.includes(decoded.uid)) {
        const error = new Error('Not eligible to vouch');
        error.status = 403;
        throw error;
      }

      const createdAt = data?.createdAt?.toDate ? data.createdAt.toDate() : null;
      if (createdAt && Date.now() - createdAt.getTime() > claimTimeoutMs) {
        transaction.update(requestRef, {
          status: 'needsModeration',
          statusReason: 'vouch timeout',
          updatedAt: FieldValue.serverTimestamp(),
        });
        const error = new Error('Claim request expired');
        error.status = 409;
        throw error;
      }

      const existingVote = await transaction.get(voteRef);
      if (existingVote.exists) {
        const error = new Error('Already voted');
        error.status = 409;
        throw error;
      }

      const yesCount = Number(data?.yesCount || 0) + (vote === 'yes' ? 1 : 0);
      const noCount = Number(data?.noCount || 0) + (vote === 'no' ? 1 : 0);

      transaction.set(voteRef, {
        vote,
        voterUid: decoded.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(requestRef, {
        yesCount,
        noCount,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (yesCount >= 1 && noCount >= 1) {
        transaction.update(requestRef, {
          status: 'needsModeration',
          statusReason: 'vouch conflict',
          updatedAt: FieldValue.serverTimestamp(),
        });
        responsePayload = { ok: true, status: 'needsModeration', reason: 'vouch conflict' };
        return;
      }

      if (yesCount >= 1) {
        const mode = data?.mode === 'merge' ? 'merge' : 'link';
        const screenshotVerified = Boolean(data?.proofData?.screenshotVerified);
        const websiteVerified = Boolean(data?.proofData?.websiteVerified);
        const proofVerified = screenshotVerified || websiteVerified;
        if (!proofVerified) {
          transaction.update(requestRef, {
            status: 'needsModeration',
            statusReason: 'proof required',
            updatedAt: FieldValue.serverTimestamp(),
          });
          responsePayload = { ok: true, status: 'needsModeration', reason: 'proof required' };
          return;
        }

        if (mode === 'merge') {
          transaction.update(requestRef, {
            status: 'needsModeration',
            statusReason: 'merge requested',
            updatedAt: FieldValue.serverTimestamp(),
          });
          responsePayload = { ok: true, status: 'needsModeration', reason: 'merge requested' };
          return;
        }

        const contributorId = data?.contributorId || null;
        const requestedByUid = data?.requestedByUid || null;
        if (!contributorId || !requestedByUid) {
          const error = new Error('Claim request missing contributor or requester');
          error.status = 400;
          throw error;
        }
        const contributorRef = db.collection('contributors').doc(contributorId);
        const claimantRef = db.collection('users').doc(requestedByUid);
        transaction.update(claimantRef, {
          contributorId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(contributorRef, {
          claimedByUid: requestedByUid,
          claimedAt: FieldValue.serverTimestamp(),
          status: 'claimed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(requestRef, {
          status: 'approved',
          statusReason: null,
          approvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        responsePayload = { ok: true, status: 'approved' };
      }
    });

    res.status(200).json(responsePayload);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to submit vouch' });
  }
});

export const expireClaimRequests = onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const decoded = await verifyToken(req);
    await ensureModerator(decoded);
    const cutoff = Timestamp.fromDate(new Date(Date.now() - claimTimeoutMs));
    const snapshot = await db.collection('claimRequests')
      .where('status', '==', 'pending')
      .where('createdAt', '<=', cutoff)
      .get();

    if (snapshot.empty) {
      res.status(200).json({ ok: true, updated: 0 });
      return;
    }

    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        status: 'needsModeration',
        statusReason: 'vouch timeout',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();

    res.status(200).json({ ok: true, updated: snapshot.size });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to expire claim requests' });
  }
});

export const verifyClaimProofScreenshot = onObjectFinalized({ region: 'europe-west4' }, async (event) => {
  const object = event.data;
  const name = object?.name || '';
  if (!name.startsWith('claimProofs/')) return;
  const parts = name.split('/');
  if (parts.length < 3) return;
  const requestId = parts[1];
  const uidSegment = parts[2];
  if (!requestId || !uidSegment) return;
  const bucketName = object?.bucket;
  if (!bucketName) return;

  const requestRef = db.collection('claimRequests').doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    logger.warn('Claim proof upload without request', { requestId, name });
    return;
  }

  const requestData = requestSnap.data() || {};
  if (await isKnownCodexDevActorUid({ db, uid: requestData?.requestedByUid })) {
    logger.warn('Ignoring Codex Dev claim proof upload', { requestId });
    return;
  }
  const claimCode = requestData?.claimCode ? String(requestData.claimCode) : null;
  const claimCodeExpiresAt = requestData?.claimCodeExpiresAt instanceof Timestamp
    ? requestData.claimCodeExpiresAt
    : null;
  const contributorId = requestData?.contributorId || null;

  let extractedText = '';
  try {
    const [result] = await visionClient.textDetection({
      image: { source: { imageUri: `gs://${bucketName}/${name}` } },
    });
    extractedText = result?.fullTextAnnotation?.text || '';
  } catch (error) {
    logger.error('OCR failed for claim proof', { error, name });
  }

  const normalizedText = extractedText.toLowerCase();
  const codeMatch = claimCode ? normalizedText.includes(claimCode.toLowerCase()) : false;
  let handleMatch = true;
  let handleChecked = false;
  if (contributorId) {
    const contributorSnap = await db.collection('contributors').doc(contributorId).get();
    if (contributorSnap.exists) {
      const contributor = contributorSnap.data() || {};
      const instagramHandle = contributor?.instagramHandle ? String(contributor.instagramHandle) : '';
      if (instagramHandle) {
        handleChecked = true;
        const normalizedHandle = instagramHandle.replace(/^@+/, '').toLowerCase();
        handleMatch = normalizedText.includes(normalizedHandle);
      }
    }
  }

  const isWithinExpiry = Boolean(claimCodeExpiresAt && claimCodeExpiresAt.toMillis() >= Date.now());
  const screenshotVerified = Boolean(codeMatch && handleMatch && isWithinExpiry);

  await db.runTransaction(async (transaction) => {
    const freshSnap = await transaction.get(requestRef);
    if (!freshSnap.exists) return;
    const data = freshSnap.data() || {};
    if (await isKnownCodexDevActorUid({ db, uid: data?.requestedByUid, transaction })) {
      logger.warn('Ignoring newly registered Codex Dev claim proof upload', { requestId });
      return;
    }
    transaction.set(requestRef, {
      proofData: {
        screenshotVerified,
        screenshotVerifiedAt: FieldValue.serverTimestamp(),
        screenshotStoragePath: name,
        screenshotClaimCodeMatched: codeMatch,
        screenshotHandleMatched: handleMatch,
        screenshotHandleChecked: handleChecked,
        screenshotExpired: !isWithinExpiry,
        screenshotTextPreview: extractedText.slice(0, 300),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const shouldAutoResolve = data?.status === 'pending' && Number(data?.yesCount || 0) >= 1;
    if (!shouldAutoResolve) return;
    const mode = data?.mode === 'merge' ? 'merge' : 'link';
    if (screenshotVerified && mode === 'link' && Number(data?.noCount || 0) < 1) {
        const contributorIdInner = data?.contributorId || null;
        const requestedByUid = data?.requestedByUid || null;
        if (!contributorIdInner || !requestedByUid) return;
        const contributorRef = db.collection('contributors').doc(contributorIdInner);
        const claimantRef = db.collection('users').doc(requestedByUid);
        transaction.update(claimantRef, {
          contributorId: contributorIdInner,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(contributorRef, {
          claimedByUid: requestedByUid,
          claimedAt: FieldValue.serverTimestamp(),
          status: 'claimed',
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(requestRef, {
          status: 'approved',
          statusReason: null,
          approvedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
    } else {
      transaction.set(requestRef, {
        status: 'needsModeration',
        statusReason: screenshotVerified ? 'manual review required' : 'screenshot required',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  try {
    const retentionDate = new Date(Date.now() + claimProofRetentionMs);
    await admin.storage().bucket(bucketName).file(name).setMetadata({
      customTime: retentionDate.toISOString(),
      metadata: {
        cleanupAfter: retentionDate.toISOString(),
        cleanupReason: 'claimProofRetention',
      },
    });
  } catch (error) {
    logger.error('Failed to set claim proof retention metadata', { error, name });
  }
});

export const onFollowingCreated = onDocumentCreated({
  document: 'users/{uid}/following/{targetUid}',
  region: 'europe-west4',
}, async (event) => {
  const { uid, targetUid } = event.params;
  const relationRef = event.data?.ref;

  if (!relationRef) {
    logger.info('Skipping following create: missing relation ref.', { uid, targetUid });
    return;
  }

  if (uid === targetUid) {
    logger.info('Deleting invalid self-fan relation.', { uid, targetUid });
    await relationRef.delete();
    return;
  }

  const eventRelationData = event.data?.data() || {};
  if (eventRelationData.targetUid && eventRelationData.targetUid !== targetUid) {
    logger.info('Normalizing following create: targetUid mismatch.', {
      uid,
      targetUid,
      bodyTargetUid: eventRelationData.targetUid,
    });
  }

  const result = await applyFollowingCreatedCounters({
    db,
    relationRef,
    uid,
    targetUid,
    fieldValue: FieldValue,
  });
  if (result.status === 'rejected-unavailable') {
    logger.info('Deleting following relation for unavailable personal profile.', {
      uid,
      targetUid,
      fanAvailable: result.fanAvailable,
      targetAvailable: result.targetAvailable,
    });
  }
});

const claimExpiredModerationPreview = async ({ uploadRef, nowMs = Date.now() } = {}) => {
  let result = { action: 'skip', reason: 'not_due' };
  await db.runTransaction(async (transaction) => {
    const uploadSnap = await transaction.get(uploadRef);
    if (!uploadSnap.exists) {
      result = { action: 'skip', reason: 'upload_missing' };
      return;
    }

    const uploadData = uploadSnap.data() || {};
    const retentionExpiry = resolveTimestamp(uploadData?.previewRetentionExpiresAt);
    if (!retentionExpiry || retentionExpiry.getTime() > nowMs) {
      result = { action: 'skip', reason: 'not_due' };
      return;
    }

    const productionPostSnap = await transaction.get(db.collection('posts').doc(uploadRef.id));
    const codexDevPostSnap = await transaction.get(db.collection('codexDevPosts').doc(uploadRef.id));

    const ownerUid = String(uploadData?.userId || uploadData?.uploaderUid || uploadData?.ownerUid || uploadData?.userUid || '').trim();
    const reviewCaseStatuses = [];
    const operationalReviewCaseId = getOperationalModerationPreviewReviewCaseId(uploadData);
    if (operationalReviewCaseId) {
      const reviewCaseSnap = await transaction.get(db.collection('reviewCases').doc(operationalReviewCaseId));
      if (reviewCaseSnap.exists && isOperationalModerationPreviewReviewCase({
        uploadId: uploadRef.id,
        uploadData,
        reviewCaseData: reviewCaseSnap.data() || {},
      })) {
        reviewCaseStatuses.push(String(reviewCaseSnap.data()?.status || '').trim());
      }
    }

    const publicationLifecycle = resolveUploadPublicationState(uploadData);
    const publicationStatus = publicationLifecycle.valid ? publicationLifecycle.state : null;
    const draftId = String(uploadData?.draftId || '').trim();
    let draftExists = false;
    let draftMatchesUpload = false;
    if (publicationStatus === PUBLICATION_STATES.draft
      && ownerUid
      && !ownerUid.includes('/')
      && draftId
      && !draftId.includes('/')) {
      const draftSnap = await transaction.get(db.collection('users').doc(ownerUid).collection('drafts').doc(draftId));
      draftExists = draftSnap.exists;
      draftMatchesUpload = draftSnap.exists
        && String(draftSnap.data()?.uploadId || '').trim() === uploadRef.id;
    }

    const decision = getModerationPreviewRetentionDecision({
      uploadData,
      productionPostExists: productionPostSnap.exists,
      codexDevPostExists: codexDevPostSnap.exists,
      reviewCaseStatuses,
      draftExists,
      draftMatchesUpload,
    });

    if (decision.action === 'clear_retention' || decision.action === 'preserve') {
      transaction.set(uploadRef, {
        previewRetentionExpiresAt: FieldValue.delete(),
        previewRetentionDeferredAt: FieldValue.delete(),
        previewRetentionDeferredReason: FieldValue.delete(),
      }, { merge: true });
      result = decision;
      return;
    }

    if (decision.action === 'defer') {
      transaction.set(uploadRef, {
        previewRetentionExpiresAt: buildModerationPreviewRetentionExpiry(nowMs),
        previewRetentionDeferredAt: FieldValue.serverTimestamp(),
        previewRetentionDeferredReason: decision.reason,
      }, { merge: true });
      result = decision;
      return;
    }

    if (decision.action !== 'expire') {
      result = { action: 'skip', reason: 'unsupported_retention_decision' };
      return;
    }

    const claimId = crypto.randomUUID();
    const reviewStatus = String(uploadData?.reviewStatus || '').trim();
    transaction.set(uploadRef, {
      publicationState: PUBLICATION_STATES.expired,
      publicationStatus: 'expired',
      publishStatus: 'expired',
      previewExpiryClaimId: claimId,
      previewExpiryClaimedAt: FieldValue.serverTimestamp(),
      previewExpiryReason: decision.reason,
      previewExpiredFromPublicationStatus: String(uploadData?.publicationStatus || uploadData?.publishStatus || publicationStatus || '').trim() || null,
      previewExpiredFromReviewStatus: reviewStatus || null,
      previewRetentionDeferredAt: FieldValue.delete(),
      previewRetentionDeferredReason: FieldValue.delete(),
      previewRetentionExpiresAt: FieldValue.delete(),
      mediaState: 'cleanup_pending',
      mediaCleanupAfter: Timestamp.fromMillis(Number(nowMs) + moderationPreviewCleanupRetryMs),
      mediaCleanupReason: 'retention_elapsed',
    }, { merge: true });
    result = {
      ...decision,
      claimId,
      uploadData,
    };
  });
  return result;
};

const finalizeExpiredModerationPreviewClaim = async ({ uploadRef, claimId, cleaned = false } = {}) => {
  await db.runTransaction(async (transaction) => {
    const uploadSnap = await transaction.get(uploadRef);
    if (!uploadSnap.exists) return;
    const uploadData = uploadSnap.data() || {};
    if (String(uploadData?.previewExpiryClaimId || '').trim() !== String(claimId || '').trim()) return;

    transaction.set(uploadRef, {
      ...(cleaned ? {
        imageUrl: FieldValue.delete(),
        previewUrl: FieldValue.delete(),
        imageRef: FieldValue.delete(),
        storagePath: FieldValue.delete(),
        mediaState: 'deleted',
        mediaCleanupAfter: FieldValue.delete(),
        mediaCleanupReason: FieldValue.delete(),
        mediaCleanupClaimId: FieldValue.delete(),
        mediaCleanupClaimedAt: FieldValue.delete(),
        previewCleanedAt: FieldValue.serverTimestamp(),
        previewExpiredAt: FieldValue.serverTimestamp(),
      } : {}),
      previewRetentionExpiresAt: FieldValue.delete(),
      previewExpiryClaimId: FieldValue.delete(),
    }, { merge: true });
  });
};

const restorePublishedModerationPreviewClaim = async ({ uploadRef, claimId } = {}) => {
  await db.runTransaction(async (transaction) => {
    const uploadSnap = await transaction.get(uploadRef);
    if (!uploadSnap.exists) return;
    const uploadData = uploadSnap.data() || {};
    if (String(uploadData?.previewExpiryClaimId || '').trim() !== String(claimId || '').trim()) return;

    transaction.set(uploadRef, {
      publicationState: PUBLICATION_STATES.published,
      publicationStatus: 'published',
      publishStatus: 'published',
      postId: uploadRef.id,
      mediaState: 'ready',
      mediaCleanupAfter: FieldValue.delete(),
      mediaCleanupReason: FieldValue.delete(),
      mediaCleanupClaimId: FieldValue.delete(),
      mediaCleanupClaimedAt: FieldValue.delete(),
      previewRetentionExpiresAt: FieldValue.delete(),
      previewExpiryClaimId: FieldValue.delete(),
      previewExpiryRaceRecoveredAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
};

const processExpiredModerationPreview = async ({ uploadRef, nowMs = Date.now() } = {}) => {
  const claim = await claimExpiredModerationPreview({ uploadRef, nowMs });
  if (claim.action !== 'expire') return claim;

  const cleanup = await cleanupModerationPreviewForUpload({
    uploadId: uploadRef.id,
    uploadData: claim.uploadData,
  });
  if (cleanup.deleted || cleanup.reason === 'no_owned_preview') {
    await finalizeExpiredModerationPreviewClaim({ uploadRef, claimId: claim.claimId, cleaned: true });
    return { action: 'expired', reason: claim.reason, storagePath: cleanup.storagePath };
  }

  if (cleanup.reason === 'published_media_still_referenced') {
    await restorePublishedModerationPreviewClaim({ uploadRef, claimId: claim.claimId });
    return { action: 'preserve', reason: cleanup.reason, storagePath: cleanup.storagePath };
  }

  await finalizeExpiredModerationPreviewClaim({ uploadRef, claimId: claim.claimId, cleaned: false });
  return { action: 'clear_retention', reason: cleanup.reason || 'preview_missing' };
};

const claimPendingModerationPreviewMedia = async ({ uploadRef, nowMs = Date.now() } = {}) => {
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
          publicationState: PUBLICATION_STATES.discarded,
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

export const cleanupExpiredModerationPreviews = onSchedule({
  schedule: 'every 6 hours',
  region: 'europe-west4',
  timeoutSeconds: 300,
}, async () => {
  const now = Timestamp.now();
  const snapshot = await db.collection('uploads')
    .where('previewRetentionExpiresAt', '<=', now)
    .orderBy('previewRetentionExpiresAt', 'asc')
    .limit(moderationPreviewGcBatchSize)
    .get();

  const summary = {
    scanned: snapshot.size,
    expired: 0,
    deferred: 0,
    preserved: 0,
    cleared: 0,
    skipped: 0,
    failed: 0,
  };

  for (const docSnap of snapshot.docs) {
    try {
      const result = await processExpiredModerationPreview({
        uploadRef: docSnap.ref,
        nowMs: now.toMillis(),
      });
      if (result.action === 'expired') summary.expired += 1;
      else if (result.action === 'defer') summary.deferred += 1;
      else if (result.action === 'preserve') summary.preserved += 1;
      else if (result.action === 'clear_retention') summary.cleared += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error('Expired moderation preview cleanup failed.', {
        uploadId: docSnap.id,
        error: error?.message || String(error),
      });
    }
  }

  const pendingMediaSnapshot = await db.collection('uploads')
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

  logger.info('Moderation preview retention cleanup completed.', summary);
});

const cleanupModerationPreviewForUpload = async ({ uploadId, uploadData = {} } = {}) => {
  const normalizedUploadId = String(uploadId || '').trim();
  const storagePath = resolveOwnedModerationPreviewStoragePath(uploadData);
  if (!normalizedUploadId || !storagePath) return { deleted: false, reason: 'no_owned_preview' };

  const [productionPostSnap, codexDevPostSnap] = await Promise.all([
    db.collection('posts').doc(normalizedUploadId).get(),
    db.collection('codexDevPosts').doc(normalizedUploadId).get(),
  ]);
  if (productionPostSnap.exists || codexDevPostSnap.exists) {
    return { deleted: false, reason: 'published_media_still_referenced', storagePath };
  }

  await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
  return { deleted: true, storagePath };
};

const finalizeDeletedPublishedPostMedia = async ({ postId, postData = {} } = {}) => {
  const normalizedPostId = String(postId || '').trim();
  if (!normalizedPostId) return { cleaned: false, reason: 'missing_post_id' };

  const uploadRef = db.collection('uploads').doc(normalizedPostId);
  const uploadSnap = await uploadRef.get();
  if (!uploadSnap.exists) return { cleaned: false, reason: 'upload_missing' };
  const uploadData = uploadSnap.data() || {};
  const decision = getDeletedPublishedPostCleanupDecision({
    postId: normalizedPostId,
    postData,
    uploadExists: uploadSnap.exists,
    uploadData,
  });
  if (!decision.ok) return { cleaned: false, reason: decision.reason };

  let cleanup = null;
  try {
    cleanup = await cleanupModerationPreviewForUpload({ uploadId: normalizedPostId, uploadData });
  } catch (error) {
    try {
      await uploadRef.set({
        publicationState: PUBLICATION_STATES.discarded,
        publicationStatus: 'deleted_pending_cleanup',
        publishStatus: 'deleted_pending_cleanup',
        deletedPostAt: FieldValue.serverTimestamp(),
        previewCleanupRetryScheduledAt: FieldValue.serverTimestamp(),
        mediaState: 'cleanup_pending',
        mediaCleanupAfter: Timestamp.fromMillis(Date.now()),
        mediaCleanupReason: 'deleted_post_cleanup_failed',
        previewRetentionExpiresAt: FieldValue.delete(),
      }, { merge: true });
    } catch (scheduleError) {
      logger.error('Deleted published preview retry scheduling failed.', {
        postId: normalizedPostId,
        error: scheduleError?.message || String(scheduleError),
      });
    }
    throw error;
  }

  if (!cleanup.deleted && cleanup.reason !== 'no_owned_preview') {
    return { cleaned: false, reason: cleanup.reason };
  }

  await uploadRef.set({
    publicationState: PUBLICATION_STATES.discarded,
    publicationStatus: 'deleted',
    publishStatus: 'deleted',
    deletedPostAt: FieldValue.serverTimestamp(),
    imageUrl: FieldValue.delete(),
    previewUrl: FieldValue.delete(),
    imageRef: FieldValue.delete(),
    storagePath: FieldValue.delete(),
    mediaState: 'deleted',
    mediaCleanupAfter: FieldValue.delete(),
    mediaCleanupReason: FieldValue.delete(),
    mediaCleanupClaimId: FieldValue.delete(),
    mediaCleanupClaimedAt: FieldValue.delete(),
    previewCleanedAt: FieldValue.serverTimestamp(),
    previewRetentionExpiresAt: FieldValue.delete(),
    previewExpiryClaimId: FieldValue.delete(),
  }, { merge: true });
  return {
    cleaned: true,
    ...(cleanup.storagePath ? { storagePath: cleanup.storagePath } : {}),
    ...(cleanup.reason ? { reason: cleanup.reason } : {}),
  };
};

export const onModerationUploadDeleted = onDocumentDeleted({
  document: 'uploads/{uploadId}',
  region: 'europe-west4',
  retry: true,
}, async (event) => {
  const uploadData = event.data?.data?.() || {};
  try {
    await cleanupModerationPreviewForUpload({ uploadId: event.params.uploadId, uploadData });
  } catch (error) {
    logger.error('Deleted moderation upload preview cleanup failed.', {
      uploadId: event.params.uploadId,
      error: error?.message || String(error),
    });
    throw error;
  }
});

export const onModerationUploadDiscarded = onDocumentUpdated({
  document: 'uploads/{uploadId}',
  region: 'europe-west4',
  retry: true,
}, async (event) => {
  const before = event.data?.before?.data?.() || {};
  const after = event.data?.after?.data?.() || {};
  const beforePublication = resolveUploadPublicationState(before);
  const afterPublication = resolveUploadPublicationState(after);
  const afterMediaState = String(after?.mediaState || '').trim();
  if (!afterPublication.valid || afterPublication.state !== PUBLICATION_STATES.discarded) return;
  if (beforePublication.valid && beforePublication.state === PUBLICATION_STATES.discarded) return;
  // User-discard cleanup should only claim media that is still ready (or a
  // legacy upload without mediaState). Post-deletion cleanup failures already
  // use cleanup_pending and must stay on the upload-owned retry path.
  if (afterMediaState && afterMediaState !== 'ready') return;

  const cleanup = await cleanupModerationPreviewForUpload({
    uploadId: event.params.uploadId,
    uploadData: after,
  });
  if (!cleanup.deleted) return;

  await event.data.after.ref.set({
    imageUrl: FieldValue.delete(),
    previewUrl: FieldValue.delete(),
    imageRef: FieldValue.delete(),
    storagePath: FieldValue.delete(),
    mediaState: 'deleted',
    mediaCleanupAfter: FieldValue.delete(),
    mediaCleanupReason: FieldValue.delete(),
    mediaCleanupClaimId: FieldValue.delete(),
    mediaCleanupClaimedAt: FieldValue.delete(),
    previewCleanedAt: FieldValue.serverTimestamp(),
    previewRetentionExpiresAt: FieldValue.delete(),
    previewExpiryClaimId: FieldValue.delete(),
  }, { merge: true });
});

export const onProductionPostDeleted = onDocumentDeleted({
  document: 'posts/{postId}',
  region: 'europe-west4',
  retry: true,
}, async (event) => {
  await finalizeDeletedPublishedPostMedia({
    postId: event.params.postId,
    postData: event.data?.data?.() || {},
  });
});

export const onCodexDevPostDeleted = onDocumentDeleted({
  document: 'codexDevPosts/{postId}',
  region: 'europe-west4',
  retry: true,
}, async (event) => {
  await finalizeDeletedPublishedPostMedia({
    postId: event.params.postId,
    postData: event.data?.data?.() || {},
  });
});

export const onFollowingDeleted = onDocumentDeleted({
  document: 'users/{uid}/following/{targetUid}',
  region: 'europe-west4',
}, async (event) => {
  const { uid, targetUid } = event.params;

  if (uid === targetUid) {
    logger.info('Skipping following delete: self-fan relation.', { uid, targetUid });
    return;
  }

  const relationData = event.data?.data() || {};
  if (relationData.targetUid && relationData.targetUid !== targetUid) {
    logger.info('Continuing following delete with route params after targetUid mismatch.', {
      uid,
      targetUid,
      bodyTargetUid: relationData.targetUid,
    });
  }

  await applyFollowingDeletedCounters({
    db,
    relationData,
    uid,
    targetUid,
    fieldValue: FieldValue,
  });
});

export const config = {
  runtime: 'nodejs18',
};

export const markSupportThreadReadForModerator = createMarkSupportThreadReadForModerator({ db, verifyToken, ensureModerator, parseJsonBody });

export { ensureSupportThread, ensureModerationThread } from "./supportChat.js";
export { createDiditSession, refreshDiditSession, diditWebhook };
export { deleteOnboardingAccount } from "./accountLifecycle.js";
