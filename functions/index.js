import crypto from 'crypto';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { VertexAI } from '@google-cloud/vertexai';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
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
import { normalizeModeratorDecisionAction, validateCorrectedTaxonomyForAction } from './moderatorDecision.js';
import { validateUploaderCorrectionAction } from './uploaderCorrection.js';
import { canPublishUpload, getUserPublicPostPublishDecision, requiresMessageIdForAction } from './userModerationActionPolicy.js';
import { buildCommonModerationExample } from './moderationExampleBuilder.js';
import {
  fetchModerationExamplesForFingerprints,
  resolveEffectiveUploadId,
  resolveModerationExampleFingerprints,
  resolveModerationSourceFinalOutcome,
  resolveReviewCaseUploadIds,
} from './moderationExamplesLookup.js';
import { composeModerationPolicyResult } from './moderationPolicy.js';
import {
  getCodexDevLoginDecision,
  getCodexDevLoginDiagnostics,
  isValidCodexDevLoginSecret,
  shouldExposeCodexDevLoginDiagnostics,
} from './codexDevLogin.js';
import {
  CODEX_DEV_ACTOR,
  buildCodexDevPrivateProfile,
  isCodexDevToken,
  isCodexDevUid,
  resolveCodexDevUid,
} from './codexDevIdentity.js';
import { createMarkSupportThreadReadForModerator } from './supportThreadRead.js';
import { isAvailablePersonalPublicProfile } from './publicProfileAvailability.js';
import { applyFollowingCreatedCounters, applyFollowingDeletedCounters } from './followCounters.js';
import { resetPersonalOnboardingAtomically } from './publicProfileUnpublish.js';
import { isUploadReusableForActor, selectNearReusableUpload } from './uploadReuseIsolation.js';

const suggestThreshold = 0.45;
const forbiddenThreshold = 0.7;
const mediumLogThreshold = 0.55;
const codexDevLoginSecret = defineSecret('CODEX_DEV_LOGIN_SECRET');

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


const MANAGED_EXTERNAL_PROFILE_TYPES = new Set(['company', 'agency', 'collective']);

const resolveAuthorProfileForUid = async (userId, requestedProfileId) => {
  const ownerUid = String(userId || '').trim();
  const profileId = String(requestedProfileId || '').trim() || ownerUid;
  if (!ownerUid || profileId === ownerUid) {
    return { profileId: ownerUid, ownerUid, isPersonal: true };
  }

  const profileSnap = await db.collection('profiles').doc(profileId).get();
  if (!profileSnap.exists) {
    const error = new Error('Het gekozen actieve profiel bestaat niet of is niet beschikbaar.');
    error.status = 400;
    throw error;
  }
  const profile = profileSnap.data() || {};
  if (profile.ownerUid !== ownerUid) {
    const error = new Error('Je kunt alleen publiceren namens een profiel dat je beheert.');
    error.status = 403;
    throw error;
  }
  if (profile.status !== 'active' || !MANAGED_EXTERNAL_PROFILE_TYPES.has(profile.type)) {
    const error = new Error('Dit actieve profiel is niet beschikbaar om mee te publiceren.');
    error.status = 400;
    throw error;
  }
  return {
    profileId,
    ownerUid,
    isPersonal: false,
    displayName: String(profile.displayName || '').trim(),
    type: profile.type,
  };
};

const dataUrlPattern = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

const needlesKeywords = ['needle', 'syringe', 'injection', 'injections', 'hypodermic', 'vaccination'];
const spidersKeywords = ['spider', 'spiders', 'insect', 'insects', 'bug', 'bugs', 'beetle', 'mosquito', 'cockroach', 'ant', 'fly'];
const VISION_DIAGNOSTIC_ONLY_TRIGGERS = new Set(['spidersInsects', 'needlesInjections']);
const dhashPrefixLength = 4;
const dhashThreshold = Number.parseInt(process.env.DHASH_HAMMING_THRESHOLD || '8', 10);
const freshEvaluationReservationMs = Number.parseInt(process.env.FRESH_EVAL_RESERVATION_MS || '120000', 10);
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
  'wrong_theme_or_label',
  'unclear_ai_result',
]);
const MODERATION_EXAMPLE_REASON_CODES_BY_ACTION = {
  approve: new Set(['allowed_art_nude', 'allowed_boudoir', 'allowed_non_sensitive', 'wrong_theme_or_label']),
  reject: new Set(['forbidden_explicit_sexual', 'forbidden_non_consensual_context', 'wrong_theme_or_label']),
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

const updatePostsForContributorMerge = async (primaryContributorId, secondaryContributorId) => {
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
    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => {
      const { changed, updates } = buildContributorMergePostUpdate(docSnap.data(), primaryContributorId, secondaryContributorId);
      if (!changed) return;
      batch.update(docSnap.ref, updates);
      updatedPosts += 1;
    });
    await batch.commit();
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    hasMore = snapshot.size === 200;
  }
  return updatedPosts;
};

const moveContributorAliases = async (primaryContributorId, secondaryContributorId) => {
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
    const batch = db.batch();
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      if (data?.contributorId !== secondaryContributorId) {
        skippedAliases += 1;
        return;
      }
      batch.update(docSnap.ref, { contributorId: primaryContributorId });
      movedAliases += 1;
    });
    await batch.commit();
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

  const updatedPosts = await updatePostsForContributorMerge(primaryContributorId, secondaryContributorId);
  const aliasResult = await moveContributorAliases(primaryContributorId, secondaryContributorId);

  await secondaryRef.set(
    {
      status: 'merged',
      mergedInto: primaryContributorId,
      mergedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

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

const extractStoragePathFromFirebaseUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const objectPath = parsed.pathname.match(/\/o\/(.+)$/)?.[1];
    if (!objectPath) return null;
    return decodeURIComponent(objectPath);
  } catch (_error) {
    return null;
  }
};

const persistModerationPreview = async ({ buffer, mimeType, userId }) => {
  if (!buffer || !mimeType) return null;
  const bucket = admin.storage().bucket();
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const objectId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const storagePath = `moderation-previews/${userId || 'anonymous'}/${objectId}.${extension}`;
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
  const snapshot = await db
    .collection('reviewCases')
    .where('userId', '==', userId)
    .where('status', '==', 'inReview')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() };
};

const findExactUpload = async (sha256, { isCodexActor = false } = {}) => {
  const snapshot = await db.collection('uploads').where('fingerprints.sha256', '==', sha256).limit(25).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs.find((candidate) => isUploadReusableForActor(candidate.data(), isCodexActor));
  if (!doc) return null;
  return { id: doc.id, data: doc.data() };
};

const FINAL_MODERATOR_ACTIONS = new Set(['approve', 'reject']);

const getModerationExampleDecisionTimeMs = (exampleData = {}) => {
  const decidedAt = resolveTimestamp(exampleData?.moderatorDecision?.decidedAt);
  if (decidedAt) return decidedAt.getTime();
  const createdAt = resolveTimestamp(exampleData?.provenance?.createdAt);
  if (createdAt) return createdAt.getTime();
  return 0;
};

const findExactModerationExample = async (sha256) => {
  if (!sha256) return null;
  const snapshot = await db.collection('moderationExamples').where('fingerprints.sha256', '==', sha256).limit(25).get();
  if (snapshot.empty) return null;
  const ranked = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .sort((a, b) => {
      const aAction = String(a?.data?.moderatorDecision?.action || '');
      const bAction = String(b?.data?.moderatorDecision?.action || '');
      const aFinal = FINAL_MODERATOR_ACTIONS.has(aAction) ? 1 : 0;
      const bFinal = FINAL_MODERATOR_ACTIONS.has(bAction) ? 1 : 0;
      if (aFinal !== bFinal) return bFinal - aFinal;
      const timeDiff = getModerationExampleDecisionTimeMs(b.data) - getModerationExampleDecisionTimeMs(a.data);
      if (timeDiff !== 0) return timeDiff;
      return String(a.id).localeCompare(String(b.id));
    });
  return ranked[0] || null;
};

const findNearDuplicateUpload = async ({ dhash, dhashPrefix }, { isCodexActor = false } = {}) => {
  if (!dhash) return null;
  const snapshot = await db
    .collection('uploads')
    .where('fingerprints.dhashPrefix', '==', dhashPrefix)
    .limit(25)
    .get();
  if (snapshot.empty) return null;
  return selectNearReusableUpload({
    uploads: snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    isCodexActor,
    distanceFor: (candidate) => hammingDistance(dhash, candidate?.fingerprints?.dhash),
    threshold: dhashThreshold,
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

const matchesFingerprintEntry = (fingerprints, candidate) => {
  if (!fingerprints || !candidate) return false;
  if (candidate?.sha256 && candidate.sha256 === fingerprints.sha256) {
    return true;
  }
  if (!fingerprints.dhash || !fingerprints.dhashPrefix) return false;
  if (candidate?.dhashPrefix !== fingerprints.dhashPrefix) return false;
  if (!candidate?.dhash) return false;
  const distance = hammingDistance(fingerprints.dhash, candidate.dhash);
  return distance <= dhashThreshold;
};

const reserveFreshEvaluationOverride = async ({ userModerationRef, fingerprints }) => {
  if (!userModerationRef || !fingerprints) return null;
  const requestId = crypto.randomUUID();
  let reservation = null;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userModerationRef);
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    const overrides = Array.isArray(data.freshEvaluationOverrides)
      ? data.freshEvaluationOverrides
      : [];
    const now = Date.now();
    const matchIndex = overrides.findIndex((item) => {
      if (!matchesFingerprintEntry(fingerprints, item)) return false;
      const expiresAtMs = Number(item?.reservationExpiresAtMs || 0);
      const isReserved = Boolean(item?.reservationRequestId) && expiresAtMs > now;
      return !isReserved;
    });
    if (matchIndex === -1) return;
    const nextOverrides = overrides.map((item, index) => {
      if (index !== matchIndex) return item;
      return {
        ...item,
        reservationRequestId: requestId,
        reservationReservedAtMs: now,
        reservationExpiresAtMs: now + freshEvaluationReservationMs,
      };
    });
    transaction.set(
      userModerationRef,
      {
        freshEvaluationOverrides: nextOverrides,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    reservation = { requestId };
  });
  return reservation;
};

const consumeFreshEvaluationOverride = async ({ userModerationRef, fingerprints, reservationRequestId }) => {
  if (!userModerationRef || !fingerprints || !reservationRequestId) return false;
  let consumed = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userModerationRef);
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    const overrides = Array.isArray(data.freshEvaluationOverrides)
      ? data.freshEvaluationOverrides
      : [];
    const matchIndex = overrides.findIndex((item) => (
      matchesFingerprintEntry(fingerprints, item)
      && item?.reservationRequestId === reservationRequestId
    ));
    if (matchIndex === -1) return;
    const nextOverrides = overrides.filter((_, index) => index !== matchIndex);
    transaction.set(
      userModerationRef,
      {
        freshEvaluationOverrides: nextOverrides,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    consumed = true;
  });
  return consumed;
};

const releaseFreshEvaluationOverrideReservation = async ({ userModerationRef, fingerprints, reservationRequestId }) => {
  if (!userModerationRef || !fingerprints || !reservationRequestId) return false;
  let released = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userModerationRef);
    if (!snapshot.exists) return;
    const data = snapshot.data() || {};
    const overrides = Array.isArray(data.freshEvaluationOverrides)
      ? data.freshEvaluationOverrides
      : [];
    const matchIndex = overrides.findIndex((item) => (
      matchesFingerprintEntry(fingerprints, item)
      && item?.reservationRequestId === reservationRequestId
    ));
    if (matchIndex === -1) return;
    const nextOverrides = overrides.map((item, index) => {
      if (index !== matchIndex) return item;
      const { reservationRequestId: _a, reservationReservedAtMs: _b, reservationExpiresAtMs: _c, ...rest } = item;
      return rest;
    });
    transaction.set(
      userModerationRef,
      {
        freshEvaluationOverrides: nextOverrides,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    released = true;
  });
  return released;
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
  const isCodexActor = isCodexDevUid(userId);
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

  let overrideReservation = null;
  try {
    overrideReservation = await reserveFreshEvaluationOverride({
      userModerationRef: userModeration?.ref,
      fingerprints,
    });
  } catch (error) {
    logger.error('Fresh evaluation override reserve mislukt.', error);
  }
  const skipUploadReuse = Boolean(overrideReservation);

  try {
    matchedModerationExample = isCodexActor ? null : await findExactModerationExample(fingerprints.sha256);

    if (!skipUploadReuse) {
      matchedUpload = await findExactUpload(fingerprints.sha256, { isCodexActor });
      if (matchedUpload) {
        matchedFingerprintType = 'sha256';
      }
      if (!matchedUpload) {
        matchedUpload = await findNearDuplicateUpload(fingerprints, { isCodexActor });
        if (matchedUpload) {
          matchedFingerprintType = 'dhash';
        }
      }
    }

  let cachedResult = null;
  const previousExampleAction = String(matchedModerationExample?.data?.moderatorDecision?.action || '');
  const previousExampleIsFinalDecision = FINAL_MODERATOR_ACTIONS.has(previousExampleAction);
  const shouldRouteByPreviousExample = Boolean(matchedModerationExample?.id) && previousExampleIsFinalDecision && !skipUploadReuse;
  if (matchedUpload?.data) {
    cachedResult = {
      outcome: matchedUpload.data.outcome,
      appliedTriggers: matchedUpload.data.appliedTriggers || [],
      suggestedTriggers: matchedUpload.data.suggestedTriggers || [],
      forbiddenReasons: matchedUpload.data.forbiddenReasons || [],
      reviewCaseId: matchedUpload.data.reviewCaseId || null,
    };
  }

  const normalizedMakerTags = normalizeMakerTags(makerTags);
  const normalizedThemes = normalizeThemes(themes);
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
  let geminiDiagnostics = buildGeminiDiagnostics();
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
      const geminiClassifierResult = await runGeminiClassifier(parsed);
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
      if (geminiResult?.forbiddenReasons?.length) {
        geminiResult.forbiddenReasons.forEach((reason) => {
          if (typeof reason === 'string' && reason.trim()) {
            const normalizedReason = reason.trim();
            const lowerReason = normalizedReason.toLowerCase();
            const trigger = (lowerReason.includes('sexual') || lowerReason.includes('porn') || lowerReason.includes('penetration') || lowerReason.includes('masturbation'))
              ? INTERNAL_SEXUAL_EXPLICIT_TRIGGER
              : 'gemini';
            forbiddenReasons.push({ trigger, reason: normalizedReason, score: 1 });
          }
        });
      }

      geminiAdultDecision = normalizeAdultDecision(geminiResult?.adultDecision);
      geminiSexualExplicitConfidence = Number(geminiResult?.sexualExplicitConfidence) || 0;
      geminiDebug = {
        ...geminiDebug,
        normalizedAdultDecision: geminiAdultDecision,
        normalizedSexualExplicitConfidence: geminiSexualExplicitConfidence,
      };
      explicitDecisionBranchHit = geminiAdultDecision === 'explicit';
      if (explicitDecisionBranchHit && geminiSexualExplicitConfidence >= forbiddenThreshold) {
        forbiddenReasons.push({
          trigger: INTERNAL_SEXUAL_EXPLICIT_TRIGGER,
          reason: 'Gemini explicit adult decision',
          score: geminiSexualExplicitConfidence,
        });
        explicitDecisionAddedForbiddenReason = true;
      }
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
  let reviewCaseId = policyResult.reviewCaseId;
  let uploadId = null;
  let canRequestReview = false;
  let openReviewCase = null;
  let inCooldown = false;
  let reviewCreated = false;

  if (userId && finalForbiddenReasons.length > 0) {
    try {
      userModeration = await getUserModeration(userId);
      const cooldownUntil = resolveTimestamp(userModeration?.data?.cooldownUntil);
      if (cooldownUntil && cooldownUntil.getTime() > Date.now()) {
        inCooldown = true;
      }
      openReviewCase = await findOpenReviewCase(userId);
      if (openReviewCase) {
        reviewCaseId = openReviewCase.id;
      }
      if (!reviewCaseId && !openReviewCase && !inCooldown) {
        const rightsLevel = Number(userModeration?.data?.reviewRightsLevel ?? 1);
        const openCount = Number(userModeration?.data?.openReviewCount ?? 0);
        if (rightsLevel > 0 && openCount < 1) {
          const uploaderSnapshot = await getUploaderSnapshotFromPublicProfile(userId, { uid: userId });
          const reviewRef = await db.collection('reviewCases').add({
            caseType: 'upload',
            userId,
            status: 'inReview',
            decision: null,
            fingerprints: [fingerprints],
            linkedUploadIds: [],
            reviewReason: 'forbiddenOutcomeAutoReview',
            ...(uploaderSnapshot ? { uploaderSnapshot } : {}),
            aiSummary: buildAiSummary({
              classification: null,
              shouldReview: null,
              forbiddenReasons: finalForbiddenReasons,
              appliedTriggers: finalAppliedTriggers,
              suggestedTriggers: finalSuggestedTriggers,
              userSelectedTaxonomy: {
                themes: normalizedThemes,
                triggers: normalizedMakerTags,
              },
              aiSuggestedTaxonomy: {
                triggers: finalSuggestedTriggers,
              },
              aiSafetySignals,
              aiVisionLabels,
              policyAppliedTriggers: finalPolicyAppliedTriggers,
              moderationSignals: policyResult.moderationSignals,
            }),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          reviewCaseId = reviewRef.id;
          reviewCreated = true;
          await userModeration.ref.set({ openReviewCount: 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      }
    } catch (error) {
      logger.error('User moderation check mislukt.', error);
    }
  }

  canRequestReview = finalForbiddenReasons.length > 0 && !inCooldown && !openReviewCase && !reviewCreated;

  const previousModeratorExample = policyResult.previousModeratorExample;
  const effectiveShouldReview = policyResult.shouldReview;
  const outcome = policyResult.outcome;
  const requiredThemes = policyResult.requiredThemes;
  const autoAppliedTriggers = policyResult.autoAppliedTriggers;
  const classification = policyResult.classification;
  const userMessage = classification === 'disallowed_sexual_explicit'
    ? 'Deze publicatie is geblokkeerd: Pornografisch / Seksueel expliciet.'
    : requiredThemes.length > 0
      ? 'Deze content is toegestaan, maar voeg eerst het thema Art Nude toe voordat je publiceert.'
      : effectiveShouldReview
        ? 'Deze content lijkt toegestaan, maar is borderline expliciet. Vraag een review aan als je twijfelt.'
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
    requiredThemes,
    autoAppliedTriggers,
    shouldReview: effectiveShouldReview,
    userMessage,
    moderationSignals: policyResult.moderationSignals,
    geminiDiagnostics,
    userSelectedTaxonomy: policyResult.userSelectedTaxonomy,
    aiSuggestedTaxonomy: policyResult.aiSuggestedTaxonomy,
    aiSafetySignals,
    aiVisionLabels,
    policyAppliedTriggers: finalPolicyAppliedTriggers,
  };

  let persistedPreview = null;
  let previewField = null;
  try {
    const matchedPreviewUrl = String(
      matchedUpload?.data?.previewUrl
      || matchedUpload?.data?.imageUrl
      || matchedUpload?.data?.postDraft?.imageUrl
      || ''
    ).trim();

    if (matchedPreviewUrl) {
      const matchedStoragePath = matchedUpload?.data?.storagePath
        || matchedUpload?.data?.imageRef
        || extractStoragePathFromFirebaseUrl(matchedPreviewUrl)
        || null;
      persistedPreview = {
        imageUrl: matchedPreviewUrl,
        previewUrl: matchedPreviewUrl,
        storagePath: matchedStoragePath,
        imageRef: matchedStoragePath,
      };
      previewField = matchedUpload?.data?.previewUrl
        ? 'previewUrl'
        : matchedUpload?.data?.imageUrl
          ? 'imageUrl'
          : 'postDraft.imageUrl';
    } else {
      persistedPreview = await persistModerationPreview({
        buffer: parsed.buffer,
        mimeType: parsed.mimeType,
        userId,
      });
      if (persistedPreview?.imageUrl) {
        persistedPreview.previewUrl = persistedPreview.imageUrl;
        previewField = 'imageUrl';
      }
    }

    const uploadPayload = {
      userId: userId || null,
      uploaderUid: userId || null,
      ...(isCodexDevUid(userId) ? { testActor: CODEX_DEV_ACTOR } : {}),
      outcome,
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
      fingerprints,
      matchedUploadId: matchedUpload?.id || null,
      ...(persistedPreview?.imageUrl ? { imageUrl: persistedPreview.imageUrl } : {}),
      ...(persistedPreview?.previewUrl ? { previewUrl: persistedPreview.previewUrl } : {}),
      ...(persistedPreview?.imageRef ? { imageRef: persistedPreview.imageRef } : {}),
      ...(persistedPreview?.storagePath ? { storagePath: persistedPreview.storagePath } : {}),
      createdAt: FieldValue.serverTimestamp(),
    };
    const uploadRef = await db.collection('uploads').add(uploadPayload);
    uploadId = uploadRef.id;

    if (process.env.NODE_ENV === 'development') {
      logger.debug('Moderation preview linked to upload', {
        uploadId,
        reviewCaseId: reviewCaseId || null,
        previewField,
      });
    }
  } catch (error) {
    logger.error('Upload opslaan mislukt.', error);
  }

  if (reviewCaseId && uploadId) {
    try {
      const uploaderSnapshot = await getUploaderSnapshotFromPublicProfile(userId, { uid: userId });
      await db.collection('reviewCases').doc(reviewCaseId).set(
        {
          linkedUploadIds: FieldValue.arrayUnion(uploadId),
          fingerprints: FieldValue.arrayUnion(fingerprints),
          reviewReason: 'forbiddenOutcomeAutoReview',
          ...(uploaderSnapshot ? { uploaderSnapshot } : {}),
          aiSummary: buildAiSummary({
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
          }),
          previousModeratorExample,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      logger.error('Review case koppelen mislukt.', error);
    }
  }

  response.uploadId = uploadId;
  response.previewField = previewField;

  if (includeDebug) {
    response.debug = {
      path: blockedByReport
        ? 'blockedFingerprint'
        : skipUploadReuse
          ? 'freshEvaluationOverrideUsed'
          : matchedFingerprintType === 'sha256'
            ? 'exactReuse'
            : matchedFingerprintType === 'dhash'
              ? 'nearReuse'
              : 'none',
      matchedUploadId: matchedUpload?.id || null,
      matchedModerationExampleId: matchedModerationExample?.id || null,
      matchedFingerprintType,
      forbiddenTriggerKeys: finalForbiddenReasons.map((reason) => reason?.trigger).filter(Boolean),
      suggestedTriggerKeys: finalSuggestedTriggers.map((item) => item?.trigger).filter(Boolean),
      geminiDebug: {
        ...geminiDebug,
        geminiAttempted,
        geminiFailed,
      },
      geminiDiagnostics,
    };
  }

  if (skipUploadReuse) {
    try {
      await consumeFreshEvaluationOverride({
        userModerationRef: userModeration?.ref,
        fingerprints,
        reservationRequestId: overrideReservation?.requestId,
      });
    } catch (error) {
      logger.error('Fresh evaluation override consume mislukt.', error);
    }
  }

  res.status(200).json(response);
  } catch (error) {
    if (skipUploadReuse) {
      try {
        await releaseFreshEvaluationOverrideReservation({
          userModerationRef: userModeration?.ref,
          fingerprints,
          reservationRequestId: overrideReservation?.requestId,
        });
      } catch (releaseError) {
        logger.error('Fresh evaluation override release mislukt.', releaseError);
      }
    }
    logger.error('moderateImage fout.', error);
    res.status(500).json({ error: 'Moderatie mislukt.' });
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
    if (isCodexDevToken(decoded) || isCodexDevUid(recipientUid)) {
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
    let createdCanonicalThread = false;
    try {
      await canonicalRef.create({
        type: 'dm',
        participantUids: [decoded.uid, recipientUid],
        dmKey,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageText: '',
        lastSenderUid: decoded.uid,
      });
      createdCanonicalThread = true;
    } catch (error) {
      const errorCode = error?.code;
      const alreadyExists = errorCode === 6 || errorCode === 'already-exists' || errorCode === 'ALREADY_EXISTS';
      if (!alreadyExists) throw error;
    }

    if (!createdCanonicalThread) {
      const postCreateSnap = await canonicalRef.get();
      const postCreateData = postCreateSnap.exists ? (postCreateSnap.data() || {}) : null;
      const postCreateParticipants = Array.isArray(postCreateData?.participantUids)
        ? [...postCreateData.participantUids].sort()
        : [];
      const canonicalValid = Boolean(
        postCreateData
        && postCreateData?.type === 'dm'
        && arraysEqual(postCreateParticipants, participantPair)
      );
      if (canonicalValid) {
        res.status(200).json({ threadId: canonicalThreadId });
        return;
      }
      const conflictError = new Error('Canonical DM thread id conflict');
      conflictError.status = 409;
      throw conflictError;
    }

    const threadId = canonicalThreadId;

    await Promise.all([
      db.collection('users').doc(decoded.uid).collection('threadIndex').doc(threadId).set(
        {
          threadId,
          pinned: false,
          hidden: false,
          displayTitle: senderTitle,
          lastMessageAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
      db.collection('users').doc(recipientUid).collection('threadIndex').doc(threadId).set(
        {
          threadId,
          pinned: false,
          hidden: false,
          displayTitle: recipientTitle,
          lastMessageAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);

    res.status(200).json({ threadId });
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
    if (threadData?.type !== 'dm') {
      res.status(400).json({ error: 'Only DM threads can be archived' });
      return;
    }
    const participants = Array.isArray(threadData?.participantUids) ? threadData.participantUids : [];
    if (!participants.includes(decoded.uid)) {
      res.status(403).json({ error: 'Not a participant' });
      return;
    }

    const indexRef = db.collection('users').doc(decoded.uid).collection('threadIndex').doc(threadId);
    const indexSnap = await indexRef.get();
    if (indexSnap.exists) {
      await indexRef.set({ hidden: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    res.status(200).json({ ok: true, threadId, indexFound: indexSnap.exists });
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

    const messagesRef = threadRef.collection('messages');
    let keptIntroRef = null;
    let hasMoreMessages = true;
    while (hasMoreMessages) {
      const snapshot = await messagesRef.limit(400).get();
      if (snapshot.empty) {
        hasMoreMessages = false;
        continue;
      }
      const batch = db.batch();
      let deletesInRound = 0;
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const isSystemIntro = data?.senderRole === 'system' && SUPPORT_INTRO_TEXTS.includes(data?.text || '');
        if (isSystemIntro) {
          if (!keptIntroRef) {
            keptIntroRef = docSnap.ref;
            return;
          }
          if (keptIntroRef.path === docSnap.ref.path) {
            return;
          }
        }
        batch.delete(docSnap.ref);
        deletesInRound += 1;
      });
      if (deletesInRound > 0) {
        await batch.commit();
      }
      hasMoreMessages = deletesInRound > 0 && snapshot.size === 400;
    }

    if (!keptIntroRef) {
      await messagesRef.add({
        text: SUPPORT_INTRO_MESSAGE,
        type: 'system',
        senderRole: 'system',
        senderUid: null,
        senderId: 'system',
        senderLabel: 'Artes Moderatie',
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await threadRef.set({
      type: 'support',
      title: 'Artes Moderatie',
      threadKey: threadData?.threadKey || threadId,
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
    }, { merge: true });

    const indexRef = db.collection('users').doc(userUid).collection('threadIndex').doc(threadId);
    await indexRef.set({
      threadId,
      type: 'support',
      threadType: 'support',
      pinned: true,
      hidden: false,
      displayTitle: 'Artes Moderatie',
      lastMessageAt: FieldValue.serverTimestamp(),
    }, { merge: true });

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
    const participants = Array.isArray(threadData?.participantUids) ? threadData.participantUids : [];
    if (!participants.includes(decoded.uid)) {
      res.status(403).json({ error: 'Not a participant' });
      return;
    }

    const publicUsers = await Promise.all(participants.map((uid) => fetchPublicUser(uid)));
    const messageRef = threadRef.collection('messages').doc();
    const now = FieldValue.serverTimestamp();

    await Promise.all([
      messageRef.set({
        senderId: decoded.uid,
        senderUid: decoded.uid,
        senderRole: 'user',
        text,
        type: 'text',
        createdAt: now,
      }),
      threadRef.set(
        {
          updatedAt: now,
          lastMessageAt: now,
          lastMessageText: text,
          lastSenderUid: decoded.uid,
        },
        { merge: true }
      ),
      ...participants.map((uid, index) => {
        const otherIndex = participants[0] === uid ? 1 : 0;
        const otherPublic = publicUsers[otherIndex] || null;
        return db.collection('users').doc(uid).collection('threadIndex').doc(threadId).set(
          {
            threadId,
            pinned: false,
            hidden: false,
            displayTitle: resolveDisplayTitle(otherPublic),
            lastMessageAt: now,
          },
          { merge: true }
        );
      }),
    ]);

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

    await threadRef.set(
      {
        hasUserMessage: true,
        userMaySend: false,
        userCanSend: false,
        userMessageAllowance: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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

    const reviewRef = await db.collection('reviewCases').add({
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
    if (isCodexDevToken(decoded)) {
      res.status(403).json({ error: 'Codex Dev review cases are isolated.' });
      return;
    }
    const body = parseJsonBody(req);
    const uploadId = String(body?.uploadId || '').trim();
    if (!uploadId) {
      res.status(400).json({ error: 'uploadId is required' });
      return;
    }

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
    const postDraft = postDraftInput
      ? {
          title: String(postDraftInput.title || '').trim(),
          description: String(postDraftInput.description || postDraftInput.caption || '').trim(),
          imageUrl: String(postDraftInput.imageUrl || '').trim(),
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
        }
      : null;

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
      const openCasesSnapshot = await db
        .collection('reviewCases')
        .where('userId', '==', decoded.uid)
        .where('status', '==', 'inReview')
        .limit(20)
        .get();
      existingCase = openCasesSnapshot.docs
        .map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }))
        .find(({ data }) => {
          if (data.caseType && data.caseType !== 'upload') return false;
          if (data.uploadId === uploadId) return true;
          return Array.isArray(data.linkedUploadIds) && data.linkedUploadIds.includes(uploadId);
        }) || null;
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

    let reviewCaseId = existingCase?.id || null;
    let created = false;

    if (!reviewCaseId) {
      const reviewRef = await db.collection('reviewCases').add({
        caseType: 'upload',
        status: 'inReview',
        decision: null,
        userId: decoded.uid,
        ...(uploaderSnapshot ? { uploaderSnapshot } : {}),
        reviewReason: 'manualUserReviewRequest',
        aiSummary,
        ...(isCodexDevUid(decoded.uid) ? { testActor: CODEX_DEV_ACTOR } : {}),
        uploadId,
        linkedUploadIds: [uploadId],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      reviewCaseId = reviewRef.id;
      created = true;
    }

    await uploadRef.set(
      {
        ...(isCodexDevUid(decoded.uid) ? { testActor: CODEX_DEV_ACTOR } : {}),
        reviewCaseId,
        reviewStatus: 'inReview',
        reviewRequestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(postDraft ? { postDraft } : {}),
      },
      { merge: true }
    );

    await db.collection('reviewCases').doc(reviewCaseId).set(
      {
        ...(isCodexDevUid(decoded.uid) ? { testActor: CODEX_DEV_ACTOR } : {}),
        uploadId,
        linkedUploadIds: FieldValue.arrayUnion(uploadId),
        ...(uploaderSnapshot ? { uploaderSnapshot } : {}),
        reviewReason: 'manualUserReviewRequest',
        aiSummary,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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
        transaction.update(uploadRef, {
          reviewStatus: uploadReviewStatus,
          reviewDecisionMessagePublic: finalDecisionMessage,
          reviewDecisionReasons: decisionReasons,
          reviewDecisionAt: FieldValue.serverTimestamp(),
          publicationStatus: isApproved ? (requiresUploaderAcceptance ? 'needs_user_correction' : 'pending') : 'blocked',
          approvedAt: isApproved ? FieldValue.serverTimestamp() : FieldValue.delete(),
          reviewCaseId,
          correctedTaxonomy: (correctedThemes.length || correctedTriggers.length) ? { themes: correctedThemes, triggers: correctedTriggers } : FieldValue.delete(),
          requiresUploaderAcceptance: normalizedModeratorAction === 'requestUserCorrection',
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
        lock: FieldValue.delete(),
      };
      if (uploadId) {
        reviewUpdate.uploadId = uploadId;
      }
      if (reportPostId) {
        reviewUpdate.reportedPostId = reportPostId;
      }
      transaction.update(reviewRef, reviewUpdate);

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
    if (!MODERATION_EXAMPLE_REASON_CODES.has(reasonCode)) {
      res.status(400).json({ error: 'Invalid reasonCode' });
      return;
    }
    if (!MODERATION_EXAMPLE_REASON_CODES_BY_ACTION.queueFreshEvaluation.has(reasonCode)) {
      res.status(400).json({ error: 'Invalid reasonCode for action queueFreshEvaluation' });
      return;
    }

    const pickFingerprint = (value) => {
      if (!value || typeof value !== 'object') return null;
      const sha256 = typeof value.sha256 === 'string' ? value.sha256.trim() : '';
      const dhash = typeof value.dhash === 'string' ? value.dhash.trim() : '';
      const dhashPrefix = typeof value.dhashPrefix === 'string' ? value.dhashPrefix.trim() : '';
      if (!sha256 || !dhash || !dhashPrefix) return null;
      return { sha256, dhash, dhashPrefix };
    };

    const pickString = (...values) => {
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    };

    const pickFingerprintFromCandidates = (...candidates) => {
      for (const candidate of candidates) {
        const entry = pickFingerprint(candidate);
        if (entry) return entry;
      }
      return null;
    };

    const reviewCaseRef = db.collection('reviewCases').doc(reviewCaseId);
    const reviewCaseSnapshot = await reviewCaseRef.get();
    if (!reviewCaseSnapshot.exists) {
      res.status(404).json({ error: 'Review case not found' });
      return;
    }

    const reviewCaseData = reviewCaseSnapshot.data() || {};
    const effectiveUploadId = String(
      uploadIdFromBody
      || reviewCaseData.uploadId
      || (Array.isArray(reviewCaseData.linkedUploadIds) ? reviewCaseData.linkedUploadIds[0] : '')
      || ''
    ).trim() || null;

    const alreadyFinal = reviewCaseData.status === 'freshEvalQueued' || reviewCaseData.status === 'closedNoFingerprint';

    let uploadSnapshot = null;
    let uploadData = {};
    let uploadFound = false;
    if (effectiveUploadId) {
      uploadSnapshot = await db.collection('uploads').doc(effectiveUploadId).get();
      uploadFound = uploadSnapshot.exists;
      uploadData = uploadFound ? (uploadSnapshot.data() || {}) : {};
    }

    const userId = pickString(
      reviewCaseData?.userId,
      reviewCaseData?.uploaderUid,
      reviewCaseData?.ownerUid,
      reviewCaseData?.uploaderSnapshot?.uid,
      reviewCaseData?.uploadSnapshot?.userId,
      reviewCaseData?.uploadSnapshot?.ownerUid,
      uploadData?.userId,
      uploadData?.ownerUid
    );
    const fingerprints = pickFingerprintFromCandidates(
      reviewCaseData?.fingerprints,
      reviewCaseData?.fingerprint,
      {
        sha256: reviewCaseData?.sha256,
        dhash: reviewCaseData?.dhash,
        dhashPrefix: reviewCaseData?.dhashPrefix,
      },
      reviewCaseData?.uploadSnapshot?.fingerprints,
      reviewCaseData?.uploadSnapshot?.metadata?.fingerprints,
      uploadData?.fingerprints,
      uploadData?.metadata?.fingerprints
    );

    const moderation = userId ? await getUserModeration(userId) : null;
    const existingOverrides = Array.isArray(moderation?.data?.freshEvaluationOverrides)
      ? moderation.data.freshEvaluationOverrides
      : [];
    const alreadyQueued = fingerprints
      ? existingOverrides.some((item) => matchesFingerprintEntry(fingerprints, item))
      : false;
    const shouldQueueFingerprintOverride = Boolean(fingerprints) && !alreadyQueued && Boolean(moderation?.ref);

    if (shouldQueueFingerprintOverride) {
      await moderation.ref.set(
        {
          freshEvaluationOverrides: FieldValue.arrayUnion({
            sha256: fingerprints.sha256,
            dhash: fingerprints.dhash,
            dhashPrefix: fingerprints.dhashPrefix,
            uploadId: effectiveUploadId,
            reviewCaseId,
            createdByUid: decoded.uid,
            createdAtMs: Date.now(),
          }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const fingerprintQueued = shouldQueueFingerprintOverride || alreadyQueued;
    const queueMode = fingerprintQueued ? 'fingerprintOverride' : 'closeOnlyNoFingerprint';
    const nextStatus = fingerprintQueued ? 'freshEvalQueued' : 'closedNoFingerprint';

    if (!alreadyFinal || reviewCaseData.status !== nextStatus) {
      await reviewCaseRef.set(
        {
          status: nextStatus,
          queueExitReason: 'reEvaluateOnNextUpload',
          queuedFreshEvaluationAt: FieldValue.serverTimestamp(),
          queuedFreshEvaluationBy: decoded.uid,
          queuedFreshEvaluationByUid: decoded.uid,
          queueReasonCode: reasonCode,
          fingerprintQueued,
          queueFreshEvaluationMode: queueMode,
          lock: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    if (effectiveUploadId && uploadFound) {
      await db.collection('uploads').doc(effectiveUploadId).set(
        {
          reviewStatus: nextStatus,
          queueExitReason: 'reEvaluateOnNextUpload',
          queuedFreshEvaluationAt: FieldValue.serverTimestamp(),
          queuedFreshEvaluationBy: decoded.uid,
          queuedFreshEvaluationByUid: decoded.uid,
          queueReasonCode: reasonCode,
          queueFreshEvaluationMode: queueMode,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    if (reviewCaseId || effectiveUploadId) {
      const moderationExampleId = `${reviewCaseId || effectiveUploadId}_queueFreshEvaluation`;
      const aiResult = uploadData?.aiResult || reviewCaseData?.uploadSnapshot?.aiResult || {};
      const moderationSignals = uploadData?.moderationSignals || reviewCaseData?.uploadSnapshot?.moderationSignals || {};
      const correctionSnapshot = uploadData?.correction || uploadData?.postDraft?.correction || reviewCaseData?.uploadSnapshot?.correction || null;
      try {
        const queueExamplePayload = buildCommonModerationExample({
          uploadId: effectiveUploadId,
          reviewCaseId,
          uploaderUid: userId || null,
          fingerprints: fingerprints ? { ...fingerprints } : null,
          uploadData,
          reviewData: reviewCaseData,
          aiResult,
          moderationSignals,
          correctionSnapshot,
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
          source: 'moderatorQueueFreshEvaluation',
          nowFactory: () => FieldValue.serverTimestamp(),
        });
        await db.collection('moderationExamples').doc(moderationExampleId).set(queueExamplePayload, { merge: true });
      } catch (exampleError) {
        logger.warn('moderatorQueueFreshEvaluation: moderationExample write skipped', {
          reviewCaseId,
          uploadId: effectiveUploadId,
          error: exampleError?.message || String(exampleError),
        });
      }
    }

    res.status(200).json({
      ok: true,
      reviewCaseId,
      uploadId: effectiveUploadId,
      uploadFound,
      uploadUpdateSkipped: Boolean(effectiveUploadId) && !uploadFound,
      fingerprintQueued,
      queueFreshEvaluationMode: queueMode,
      status: nextStatus,
      message: queueMode === 'fingerprintOverride'
        ? 'Fresh evaluation queued for next matching upload.'
        : 'Case removed from active review; no fingerprint override created.',
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to queue fresh evaluation override' });
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
    if (!uploadId || !action || (requiresMessageIdForAction(action) && !messageId)) {
      res.status(400).json({ error: 'uploadId and action are required (messageId required for this action)' });
      return;
    }
    if (!['publishNow', 'saveDraft', 'dismiss', 'repairPublished', 'acceptCorrection', 'rejectCorrection', 'markPublicationPromptOpened', 'discardApprovedUpload'].includes(action)) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }
    const userId = decoded.uid;
    const threadId = `support_${userId}`;
    const threadRef = db.collection('threads').doc(threadId);
    const messageRef = action === 'repairPublished' || !messageId ? null : threadRef.collection('messages').doc(messageId);
    const uploadRef = db.collection('uploads').doc(uploadId);

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
    const upload = uploadSnap.data();
    const uploadOwnerId = upload?.userId || upload?.ownerUid || upload?.userUid || null;
    if (uploadOwnerId !== userId) {
      res.status(403).json({ error: 'Not authorized for this action' });
      return;
    }
    if (messageRef && message?.metadata?.uploadId !== uploadId) {
      res.status(403).json({ error: 'Not authorized for this action' });
      return;
    }

    const isApprovedOrLegacyPublished = canPublishUpload(upload);
    if ((action === 'publishNow' || action === 'repairPublished') && !isApprovedOrLegacyPublished) {
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
    const currentPublicationStatus = String(upload?.publicationStatus || upload?.publishStatus || '').trim();
    if ((action === 'markPublicationPromptOpened' || action === 'discardApprovedUpload') && currentPublicationStatus === 'published') {
      res.status(409).json({ error: 'Upload is already published' });
      return;
    }

    if (action === 'markPublicationPromptOpened') {
      await uploadRef.set({
        publicationPromptOpenedAt: FieldValue.serverTimestamp(),
        publicationPromptOpenedByUid: userId,
        publicationPromptDismissedAt: FieldValue.serverTimestamp(),
        publicationPromptDismissedByUid: userId,
      }, { merge: true });

      if (messageRef) {
        await messageRef.set({ unread: false }, { merge: true });
      }
    }

    if (action === 'discardApprovedUpload') {
      await db.runTransaction(async (transaction) => {
        const latestUploadSnap = await transaction.get(uploadRef);
        if (!latestUploadSnap.exists) {
          const error = new Error('Upload not found');
          error.status = 404;
          throw error;
        }
        const latestUpload = latestUploadSnap.data() || {};
        const latestOwnerId = latestUpload?.userId || latestUpload?.ownerUid || latestUpload?.userUid || null;
        if (latestOwnerId !== userId) {
          const error = new Error('Not authorized for this action');
          error.status = 403;
          throw error;
        }
        if (String(latestUpload?.publicationStatus || latestUpload?.publishStatus || '').trim() === 'published') {
          const error = new Error('Upload is already published');
          error.status = 409;
          throw error;
        }
        if (latestUpload?.reviewStatus !== 'approved') {
          const error = new Error('Upload is not approved');
          error.status = 409;
          throw error;
        }

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
      });

      if (messageRef) {
        await messageRef.set({
          unread: false,
          resolved: true,
          resolvedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }

    if (action === 'acceptCorrection' || action === 'rejectCorrection') {
      const validation = validateUploaderCorrectionAction({ action, upload, userId });
      if (!validation.ok) {
        res.status(validation.status || 400).json({ error: validation.error });
        return;
      }
      const { correctedTaxonomy } = validation;
      const reviewCaseId = upload?.reviewCaseId || null;
      const moderationExampleId = `${reviewCaseId || uploadId}_uploaderCorrection`;
      const nextCorrection = {
        ...(upload?.correction && typeof upload.correction === 'object' ? upload.correction : {}),
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

      await uploadRef.set({
        correctedTaxonomy,
        uploaderCorrectionResponse: action === 'acceptCorrection'
          ? { status: 'accepted', acceptedAt: FieldValue.serverTimestamp(), acceptedBy: userId }
          : { status: 'rejected', rejectedAt: FieldValue.serverTimestamp(), rejectedBy: userId },
        correction: nextCorrection,
        publicationStatus: action === 'acceptCorrection' ? 'correction_accepted' : 'user_disagreed',
        reviewStatus: action === 'acceptCorrection' ? 'approved' : 'needs_user_correction',
        requiresUploaderAcceptance: action === 'acceptCorrection' ? false : true,
        ...(action === 'acceptCorrection' ? {
          postDraft: {
            ...(upload?.postDraft || {}),
            styles: correctedTaxonomy.themes,
            makerTags: correctedTaxonomy.triggers,
            appliedTriggers: correctedTaxonomy.triggers,
          },
        } : {}),
      }, { merge: true });

      const correctionActionName = action === 'acceptCorrection' ? 'acceptCorrection' : 'rejectCorrection';
      const correctionExamplePayload = buildCommonModerationExample({
        source: 'userModerationAction',
        uploadId,
        reviewCaseId,
        postId: uploadId,
        uploaderUid: userId,
        fingerprints: upload?.fingerprints || null,
        uploadData: upload || {},
        reviewData: {},
        aiResult: upload?.aiResult || {},
        moderationSignals: upload?.moderationSignals || {},
        correctionSnapshot: {
          originalSelectedThemes: Array.isArray(upload?.postDraft?.styles) ? upload.postDraft.styles : [],
          originalSelectedTriggers: Array.isArray(upload?.postDraft?.makerTags) ? upload.postDraft.makerTags : [],
          finalAcceptedThemes: action === 'acceptCorrection' ? correctedTaxonomy.themes : [],
          finalAcceptedTriggers: action === 'acceptCorrection' ? correctedTaxonomy.triggers : [],
        },
        decision: null,
        policyDecisionOutcome: upload?.aiResult?.outcome || null,
        moderatorDecision: {
          action: correctionActionName,
          priorAction: upload?.moderatorDecision?.action || null,
          reasonCode: upload?.moderatorDecision?.reasonCode || null,
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
      });

      await db.collection('moderationExamples').doc(moderationExampleId).set(correctionExamplePayload, { merge: true });
    }

    if (action === 'publishNow' || action === 'repairPublished') {
      const postDraft = {
        ...(upload?.postDraft || {}),
        ...(postDraftFromBody && typeof postDraftFromBody === 'object' ? postDraftFromBody : {}),
      };
      const normalizedTitle = String(postDraft?.title || upload?.title || upload?.caption || '').trim();
      const normalizedDescription = String(postDraft?.description || postDraft?.caption || upload?.description || upload?.caption || '').trim();
      const normalizedImageUrl = String(postDraft?.imageUrl || upload?.imageUrl || upload?.imageRef || '').trim();
      const normalizedStyles = Array.isArray(postDraft?.styles)
        ? postDraft.styles.filter(Boolean)
        : Array.isArray(postDraft?.themes)
          ? postDraft.themes.filter(Boolean)
          : [];
      const normalizedMakerTags = Array.isArray(postDraft?.makerTags)
        ? postDraft.makerTags.filter(Boolean)
        : Array.isArray(upload?.makerTags)
          ? upload.makerTags.filter(Boolean)
          : [];
      const normalizedAppliedTriggers = Array.isArray(postDraft?.appliedTriggers)
        ? postDraft.appliedTriggers.filter(Boolean)
        : Array.isArray(upload?.appliedTriggers)
          ? upload.appliedTriggers.filter(Boolean)
          : [];
      const normalizedCredits = Array.isArray(postDraft?.credits)
        ? postDraft.credits.filter(Boolean)
        : Array.isArray(postDraft?.contributors)
          ? postDraft.contributors.filter(Boolean)
          : [];
      const requestedAuthorProfileId = postDraft?.authorProfileId || upload?.postDraft?.authorProfileId || upload?.authorProfileId || userId;
      const resolvedAuthorProfile = await resolveAuthorProfileForUid(userId, requestedAuthorProfileId);
      const normalizedAuthorName = String(postDraft?.authorName || resolvedAuthorProfile.displayName || upload?.authorName || '').trim();
      const normalizedAuthorRole = String(postDraft?.authorRole || upload?.authorRole || '').trim();
      const normalizedIsChallenge = Boolean(postDraft?.isChallenge || upload?.isChallenge);

      if (!normalizedImageUrl) {
        res.status(400).json({ error: 'Cannot publish upload without imageUrl' });
        return;
      }

      await db.runTransaction(async (transaction) => {
        const postRef = db.collection(isCodexDevUid(userId) ? 'codexDevPosts' : 'posts').doc(uploadId);
        const userRef = db.collection('users').doc(userId);
        const latestUserSnap = await transaction.get(userRef);
        const publishDecision = getUserPublicPostPublishDecision(latestUserSnap.exists ? latestUserSnap.data() : null);
        if (!publishDecision.allowed) {
          const error = new Error(publishDecision.code);
          error.status = 403;
          error.code = publishDecision.code;
          throw error;
        }
        const latestUploadSnap = await transaction.get(uploadRef);
        if (!latestUploadSnap.exists) {
          const error = new Error('Upload not found');
          error.status = 404;
          throw error;
        }
        const latestUpload = latestUploadSnap.data() || {};
        const latestOwnerId = latestUpload?.userId || latestUpload?.ownerUid || latestUpload?.userUid || null;
        if (latestOwnerId !== userId) {
          const error = new Error('Not authorized for this action');
          error.status = 403;
          throw error;
        }
        const latestApprovedOrLegacyPublished = canPublishUpload(latestUpload);
        if (!latestApprovedOrLegacyPublished) {
          const error = new Error('Upload is not approved');
          error.status = 409;
          throw error;
        }

        const postSnap = await transaction.get(postRef);
        if (!postSnap.exists) {
          transaction.create(postRef, {
            title: normalizedTitle || 'Untitled',
            description: normalizedDescription || '',
            imageUrl: normalizedImageUrl,
            authorId: userId,
            authorUid: userId,
            authorProfileId: resolvedAuthorProfile.profileId,
            authorOwnerUid: userId,
            authorName: normalizedAuthorName || null,
            authorRole: normalizedAuthorRole || null,
            styles: normalizedStyles,
            makerTags: normalizedMakerTags,
            appliedTriggers: normalizedAppliedTriggers,
            triggers: normalizedAppliedTriggers,
            outcome: latestUpload?.outcome || 'allowed',
            forbiddenReasons: Array.isArray(latestUpload?.forbiddenReasons) ? latestUpload.forbiddenReasons : [],
            reviewCaseId: latestUpload?.reviewCaseId || null,
            credits: normalizedCredits,
            likes: 0,
            isChallenge: normalizedIsChallenge,
            ...(isCodexDevUid(userId) ? { testActor: CODEX_DEV_ACTOR } : {}),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        transaction.set(
          uploadRef,
          {
            ...(isCodexDevUid(userId) ? { testActor: CODEX_DEV_ACTOR } : {}),
            publicationStatus: 'published',
            publishedAt: FieldValue.serverTimestamp(),
            postId: uploadId,
          },
          { merge: true }
        );
      });

      if (messageRef) {
        await messageRef.set(
          {
            unread: false,
            resolved: true,
            resolvedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    if (action === 'saveDraft') {
      const draftRef = db.collection('users').doc(userId).collection('drafts').doc();
      await Promise.all([
        draftRef.set({
          uploadId,
          storagePath: upload?.storagePath || null,
          imageRef: upload?.imageRef || null,
          caption: upload?.caption || null,
          tags: upload?.tags || null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          status: 'draft',
        }),
        uploadRef.set({ publicationStatus: 'draft' }, { merge: true }),
        messageRef.set(
          {
            unread: false,
            resolved: true,
            resolvedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        ),
      ]);
    }

    if (action === 'dismiss') {
      await messageRef.set({ unread: false }, { merge: true });
    }

    await threadRef.set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    res.status(200).json({ ok: true });
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

  await db.runTransaction(async (transaction) => {
    const rateSnap = await transaction.get(rateRef);
    const todayKey = getDateKey();
    const rateData = rateSnap.exists ? rateSnap.data() : null;
    const currentCount = rateData?.date === todayKey ? Number(rateData?.count || 0) : 0;
    if (currentCount >= claimInviteRateLimitPerDay) {
      throw new HttpsError('resource-exhausted', 'Daily invite limit reached');
    }
    transaction.set(rateRef, {
      date: todayKey,
      count: currentCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const inviteRef = db.collection('claimInvites').doc(token);
    transaction.set(inviteRef, {
      contributorId,
      postId,
      createdByUid: request.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      usedAt: null,
      usedByUid: null,
    });
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
  await requestRef.set({
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
  await requestRef.set({
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

  if (!expiresAtMs || Number.isNaN(expiresAtMs) || now > expiresAtMs) {
    await requestRef.set({
      proofData: {
        email: {
          lastCheckedAt: FieldValue.serverTimestamp(),
          lastCheckResult: 'expired',
        },
        emailVerified: false,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new HttpsError('failed-precondition', 'Email token is verlopen.');
  }

  if (tokenHash !== emailProof.tokenHash) {
    await requestRef.set({
      proofData: {
        email: {
          lastCheckedAt: FieldValue.serverTimestamp(),
          lastCheckResult: 'invalid',
        },
        emailVerified: false,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw new HttpsError('failed-precondition', 'Email token is ongeldig.');
  }

  let resolvedStatus = 'pending';
  await db.runTransaction(async (transaction) => {
    const freshSnap = await transaction.get(requestRef);
    if (!freshSnap.exists) return;
    const data = freshSnap.data() || {};
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
    await requestRef.set({
      proofData: {
        website: {
          lastCheckedAt: FieldValue.serverTimestamp(),
          lastCheckResult: 'fetch_failed',
          lastCheckMessage: error?.message || 'Fetch failed',
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
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
    await requestRef.set({
      proofData: {
        website: {
          lastCheckedAt: FieldValue.serverTimestamp(),
          lastCheckResult: tokenCheck.reason || 'invalid',
          lastCheckPreview: String(responseBody || '').trim().slice(0, 200),
        },
        websiteVerified: false,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
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
      const mergeResult = await mergeContributorsInternal({
        primaryContributorId: contributorId,
        secondaryContributorId,
        moderatorEmail: email,
        source: 'claimRequest',
      });
      await db.collection('users').doc(requestedByUid).set(
        {
          contributorId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await requestRef.set(
        {
          status: 'approved',
          statusReason: null,
          approvedAt: FieldValue.serverTimestamp(),
          approvedByEmail: email,
          primaryContributorId: contributorId,
          secondaryContributorId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      res.status(200).json({ ok: true, status: 'approved', merge: mergeResult });
      return;
    }

    await db.runTransaction(async (transaction) => {
      const contributorRef = db.collection('contributors').doc(contributorId);
      const claimantRef = db.collection('users').doc(requestedByUid);
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
        claimedByUid: requestedByUid,
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
      uploadsSnap,
      commentsSnap,
      likesSnap,
      followsSnap,
    ] = await Promise.all([
      db.collection('posts').where('authorId', '==', targetUid).get(),
      db.collection('posts').where('authorUid', '==', targetUid).get(),
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
        reviewCases: reviewCaseRefs.length,
        uploads: uploadsRefs.length,
      },
      samples: {
        likes: likesRefs.slice(0, 20).map((ref) => ref.path),
        comments: commentsRefs.slice(0, 20).map((ref) => ref.path),
        follows: followsRefs.slice(0, 20).map((ref) => ref.path),
        posts: postsRefs.slice(0, 20).map((ref) => ref.path),
        reviewCases: reviewCaseRefs.slice(0, 20).map((ref) => ref.path),
        uploads: uploadsRefs.slice(0, 20).map((ref) => ref.path),
      },
      guard: {
        moderatorEmail: decoded?.email || null,
      },
      order: ['likes', 'comments', 'follows', 'posts', 'reviewCases', 'uploads'],
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
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists) {
        const error = new Error('Claim request not found');
        error.status = 404;
        throw error;
      }
      const data = requestSnap.data();
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

  await requestRef.set({
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

  const shouldAutoResolve = requestData?.status === 'pending' && Number(requestData?.yesCount || 0) >= 1;
  if (shouldAutoResolve) {
    const mode = requestData?.mode === 'merge' ? 'merge' : 'link';
    if (screenshotVerified && mode === 'link' && Number(requestData?.noCount || 0) < 1) {
      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(requestRef);
        if (!freshSnap.exists) return;
        const data = freshSnap.data() || {};
        if (data?.status !== 'pending') return;
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
      });
    } else {
      await requestRef.set({
        status: 'needsModeration',
        statusReason: screenshotVerified ? 'manual review required' : 'screenshot required',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

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
    
