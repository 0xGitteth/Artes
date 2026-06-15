import crypto from 'crypto';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

/**
 * Didit v2 base
 * Docs and examples use v2:
 * - POST  https://verification.didit.me/v2/session/
 * - GET   https://verification.didit.me/v2/session/{sessionId}/decision/
 */
const DIDIT_API_BASE = process.env.DIDIT_API_BASE_URL || 'https://verification.didit.me/v2';
const DIDIT_ASSUME_ADULT_ON_VERIFIED = String(process.env.DIDIT_ASSUME_ADULT_ON_VERIFIED || '').trim().toLowerCase() === 'true';
const DIDIT_ONBOARDING_STEP = 2;
const UNDERAGE_POST_OWNER_FIELDS = ['authorId', 'authorUid', 'authorOwnerUid', 'ownerUid', 'userId', 'uploaderUid', 'createdByUid'];
const UNDERAGE_BATCH_LIMIT = 450;
const UNDERAGE_PROFILE_BATCH_LIMIT = 450;

const getDiditHeaders = () => {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'Missing DIDIT_API_KEY');
  }
  return {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
  };
};

const normalizeStatus = (status) => String(status || '').trim().toLowerCase();
const normalizeReason = (reason) => {
  if (reason == null) return null;
  if (typeof reason === 'string') {
    const trimmed = reason.trim();
    return trimmed || null;
  }
  try {
    return JSON.stringify(reason);
  } catch (error) {
    return String(reason);
  }
};

export const createUnderagePublicProfilePatch = (now = FieldValue.serverTimestamp()) => ({
  hidden: true,
  status: 'inactive',
  visibility: 'private',
  publicVisibility: 'private',
  deactivatedReason: 'underage',
  deactivatedAt: now,
  updatedAt: now,
  username: FieldValue.delete(),
  displayName: FieldValue.delete(),
  displayNameLower: FieldValue.delete(),
  photoURL: FieldValue.delete(),
  avatar: FieldValue.delete(),
  bio: FieldValue.delete(),
  headerImage: FieldValue.delete(),
  roles: [],
  themes: [],
  quickProfilePostIds: [],
});

// Recovery policy: public profiles/posts hidden for a confirmed-underage downgrade are
// not automatically restored after a later adult approval; require admin/manual review.
export const createUnderagePostPatch = (now = FieldValue.serverTimestamp()) => ({
  hidden: true,
  visibility: 'private',
  status: 'inactive',
  deactivatedReason: 'underage',
  deactivatedAt: now,
  updatedAt: now,
  title: FieldValue.delete(),
  description: FieldValue.delete(),
  imageUrl: FieldValue.delete(),
  imageRef: FieldValue.delete(),
  storagePath: FieldValue.delete(),
  authorName: FieldValue.delete(),
  authorRole: FieldValue.delete(),
  credits: [],
  styles: [],
  makerTags: [],
  appliedTriggers: [],
  triggers: [],
});

export const createUnderageManagedProfilePatch = (now = FieldValue.serverTimestamp()) => ({
  status: 'inactive',
  hidden: true,
  visibility: 'private',
  deactivatedReason: 'underage',
  deactivatedAt: now,
  updatedAt: now,
});

const commitUnderagePostBatches = async (postRefs, now) => {
  for (let index = 0; index < postRefs.length; index += UNDERAGE_BATCH_LIMIT) {
    const batch = db.batch();
    postRefs.slice(index, index + UNDERAGE_BATCH_LIMIT).forEach((postRef) => {
      batch.set(postRef, createUnderagePostPatch(now), { merge: true });
    });
    await batch.commit();
  }
};

const hidePublicPostsForUnderageUser = async (uid, now) => {
  const postRefsByPath = new Map();
  await Promise.all(UNDERAGE_POST_OWNER_FIELDS.map(async (field) => {
    const snapshot = await db.collection('posts').where(field, '==', uid).get();
    snapshot.docs.forEach((postDoc) => {
      postRefsByPath.set(postDoc.ref.path, postDoc.ref);
    });
  }));
  await commitUnderagePostBatches([...postRefsByPath.values()], now);
  return postRefsByPath.size;
};

const hideManagedProfilesForUnderageUser = async (uid, now) => {
  const snapshot = await db.collection('profiles').where('ownerUid', '==', uid).get();
  const profileRefs = snapshot.docs.map((profileDoc) => profileDoc.ref);
  for (let index = 0; index < profileRefs.length; index += UNDERAGE_PROFILE_BATCH_LIMIT) {
    const batch = db.batch();
    profileRefs.slice(index, index + UNDERAGE_PROFILE_BATCH_LIMIT).forEach((profileRef) => {
      batch.set(profileRef, createUnderageManagedProfilePatch(now), { merge: true });
    });
    await batch.commit();
  }
  return profileRefs.length;
};

const calculateAgeFromDob = (dobValue) => {
  if (!dobValue) return null;
  const date = new Date(dobValue);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) {
    age -= 1;
  }
  return age;
};

export const parseDiditAge = (value) => {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const firstFiniteAge = (values) => values
  .map((value) => parseDiditAge(value))
  .find((value) => Number.isFinite(value));

const firstCalculatedDobAge = (values) => values
  .map((value) => calculateAgeFromDob(value))
  .find((value) => Number.isFinite(value));

const arrayItems = (...values) => values.flatMap((value) => (Array.isArray(value) ? value : []));

export const resolveDiditAge = (session, payload = session) => {
  const directAge = firstFiniteAge([
    session?.age,
    session?.subject?.age,
    session?.person?.age,
    session?.result?.age,
    session?.verification?.age,
    session?.data?.age,
    payload?.age,
    payload?.subject?.age,
    payload?.person?.age,
    payload?.result?.age,
    payload?.verification?.age,
    payload?.data?.age,
  ]);
  if (Number.isFinite(directAge)) return directAge;

  const directDobAge = firstCalculatedDobAge([
    session?.dateOfBirth,
    session?.date_of_birth,
    session?.document?.dateOfBirth,
    session?.document?.date_of_birth,
    session?.person?.dateOfBirth,
    session?.person?.date_of_birth,
    session?.data?.dateOfBirth,
    session?.data?.date_of_birth,
    payload?.dateOfBirth,
    payload?.date_of_birth,
    payload?.document?.dateOfBirth,
    payload?.document?.date_of_birth,
    payload?.person?.dateOfBirth,
    payload?.person?.date_of_birth,
    payload?.data?.dateOfBirth,
    payload?.data?.date_of_birth,
  ]);
  if (Number.isFinite(directDobAge)) return directDobAge;

  const featureItems = arrayItems(
    session?.id_verifications,
    session?.idVerifications,
    session?.verification?.id_verifications,
    session?.verification?.idVerifications,
    session?.data?.id_verifications,
    session?.data?.idVerifications,
    session?.features,
    session?.checks,
    session?.documents,
    session?.verification?.features,
    session?.verification?.checks,
    session?.verification?.documents,
    session?.result?.features,
    session?.result?.checks,
    session?.result?.documents,
    session?.data?.features,
    session?.data?.checks,
    session?.data?.documents,
    payload?.id_verifications,
    payload?.idVerifications,
    payload?.verification?.id_verifications,
    payload?.verification?.idVerifications,
    payload?.data?.id_verifications,
    payload?.data?.idVerifications,
    payload?.features,
    payload?.checks,
    payload?.documents,
    payload?.verification?.features,
    payload?.verification?.checks,
    payload?.verification?.documents,
    payload?.result?.features,
    payload?.result?.checks,
    payload?.result?.documents,
    payload?.data?.features,
    payload?.data?.checks,
    payload?.data?.documents,
  );

  const featureAge = firstFiniteAge(featureItems.flatMap((item) => [
    item?.age,
    item?.subject?.age,
    item?.person?.age,
    item?.result?.age,
    item?.document?.age,
    item?.data?.age,
  ]));
  if (Number.isFinite(featureAge)) return featureAge;

  return firstCalculatedDobAge(featureItems.flatMap((item) => [
    item?.dateOfBirth,
    item?.date_of_birth,
    item?.subject?.dateOfBirth,
    item?.subject?.date_of_birth,
    item?.person?.dateOfBirth,
    item?.person?.date_of_birth,
    item?.document?.dateOfBirth,
    item?.document?.date_of_birth,
    item?.data?.dateOfBirth,
    item?.data?.date_of_birth,
  ])) ?? null;
};

const resolveDiditReference = (payload) =>
  payload?.reference ||
  payload?.vendor_data ||
  payload?.session?.reference ||
  payload?.session?.vendor_data ||
  payload?.data?.reference ||
  payload?.data?.vendor_data ||
  payload?.session?.metadata?.uid ||
  payload?.session?.metadata?.reference ||
  payload?.metadata?.uid ||
  payload?.metadata?.reference ||
  payload?.data?.metadata?.uid ||
  payload?.data?.metadata?.reference;

const resolveDiditSession = (payload) => payload?.session || payload?.data || payload;

export const normalizeDiditStatus = (payload) => {
  const primitiveStatus = (path, value) => {
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [path, value];
    }
    return null;
  };
  const statusCandidates = [
    primitiveStatus('payload.status', payload?.status),
    primitiveStatus('payload.session.status', payload?.session?.status),
    primitiveStatus('payload.verification.status', payload?.verification?.status),
    primitiveStatus('payload.data.status', payload?.data?.status),
    primitiveStatus('payload.decision.status', payload?.decision?.status),
    primitiveStatus('payload.result.status', payload?.result?.status),
    primitiveStatus('payload.kyc.status', payload?.kyc?.status),
    primitiveStatus('payload.workflow.status', payload?.workflow?.status),
    primitiveStatus('payload.event.status', payload?.event?.status),
    primitiveStatus('payload.review.status', payload?.review?.status),
    primitiveStatus('payload.session.result.status', payload?.session?.result?.status),
    primitiveStatus('payload.decision', payload?.decision),
    primitiveStatus('payload.result', payload?.result),
  ].filter(Boolean);

  const match = statusCandidates.find(([, value]) => String(value).trim() !== '');
  const raw = match ? match[1] : null;
  const status = normalizeStatus(String(raw).replace(/\s+/g, '_'));

  const mapped = {
    approved: 'approved', verified: 'approved', completed: 'approved', success: 'approved',
    review: 'in_review', manual_review: 'in_review', in_review: 'in_review',
    pending: 'in_progress', processing: 'in_progress', in_progress: 'in_progress',
    started: 'started', initiated: 'started', created: 'started',
    rejected: 'declined', declined: 'declined', denied: 'declined', failed: 'declined',
    expired: 'expired', abandoned: 'abandoned', cancelled: 'abandoned', canceled: 'abandoned',
    not_started: 'not_started',
  };

  return {
    status: mapped[status] || 'error',
    rawStatusPath: match ? match[0] : null,
    rawStatusValueSafe: raw == null ? null : String(raw).slice(0, 120),
  };
};




const normalizeOrigin = (value) => {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const origin = parsed.origin.toLowerCase().replace(/\/$/, '');
    return origin === 'null' ? null : origin;
  } catch (error) {
    return null;
  }
};

const isAllowedDiditOrigin = (origin, allowedOrigins) => {
  if (!origin || !allowedOrigins.has(origin)) return false;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && parsed.hostname === 'localhost';
  } catch (error) {
    return false;
  }
};

const resolveAllowedDiditOrigins = (appBaseOrigin) => {
  const configuredOrigins = String(process.env.DIDIT_ALLOWED_RETURN_ORIGINS || '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return new Set(configuredOrigins);
  }

  const fallback = [appBaseOrigin];
  if (process.env.NODE_ENV !== 'production') {
    fallback.push('http://localhost:5173');
  }
  return new Set(fallback.filter(Boolean));
};

const resolveDiditReason = (payload) => {
  const session = resolveDiditSession(payload);
  return normalizeReason(
    session?.reason ||
    session?.status_reason ||
    session?.decision?.reason ||
    payload?.reason ||
    payload?.status_reason ||
    payload?.decision?.reason ||
    null
  );
};

const resolveDiditSessionId = (payload) => {
  const session = resolveDiditSession(payload);
  return session?.id || session?.session_id || payload?.sessionId || payload?.session_id || null;
};

export const resolveDiditAdultDecision = (status, age) => {
  const normalizedStatus = normalizeStatus(status);
  const resolvedAge = parseDiditAge(age);
  const ageIsNumber = Number.isFinite(resolvedAge);
  const isApproved = normalizedStatus === 'approved';
  const assumeAdultOnVerified = isApproved && !ageIsNumber && DIDIT_ASSUME_ADULT_ON_VERIFIED;
  const isAdult = isApproved && (ageIsNumber ? resolvedAge >= 18 : assumeAdultOnVerified) ? true : null;
  return {
    normalizedStatus,
    age: ageIsNumber ? resolvedAge : null,
    ageIsNumber,
    assumeAdultOnVerified,
    isAdult,
  };
};

export const resolveDiditPersistenceDecision = ({ status, age, alreadyApproved = false } = {}) => {
  const adultDecision = resolveDiditAdultDecision(status, age);
  const { normalizedStatus, ageIsNumber, age: resolvedAge, isAdult } = adultDecision;
  const isApprovedAdult = normalizedStatus === 'approved' && isAdult === true;
  const candidateStatus = normalizedStatus === 'approved' && !isApprovedAdult
    ? ageIsNumber && resolvedAge < 18
      ? 'underage'
      : 'age_unverified'
    : normalizedStatus;
  const isConfirmedUnderage = normalizedStatus === 'approved' && ageIsNumber && resolvedAge < 18;
  const updateMode = alreadyApproved && !isApprovedAdult
    ? isConfirmedUnderage
      ? 'downgrade_underage'
      : 'diagnostics_only'
    : isApprovedAdult
      ? 'approve_adult'
      : 'sync_status';

  return {
    normalizedStatus,
    persistedStatus: updateMode === 'diagnostics_only' ? null : candidateStatus,
    candidateStatus,
    isApprovedAdult,
    isAdult: isAdult === true,
    adultDecision,
    updateMode,
    shouldClearAdultVerification: updateMode === 'downgrade_underage',
    shouldResetOnboarding: updateMode === 'downgrade_underage',
    onboardingStep: updateMode === 'downgrade_underage' ? DIDIT_ONBOARDING_STEP : null,
  };
};

const toSafeDiditErrorBody = (data) => {
  if (data == null) return null;
  if (typeof data === 'string') return data.slice(0, 2000);
  try {
    return JSON.stringify(data).slice(0, 2000);
  } catch (error) {
    return String(data).slice(0, 2000);
  }
};

const STATUS_PRIORITY = {
  approved: 0,
  in_review: 1,
  in_progress: 2,
  started: 2,
  declined: 3,
  expired: 4,
  abandoned: 4,
  error: 5,
  not_started: 6,
};

const getStatusPriority = (status) => STATUS_PRIORITY[status] ?? 99;
const sessionSuffix = (sessionId) => (sessionId ? String(sessionId).slice(-8) : null);

const selectBestCandidate = (candidates) => {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  return [...candidates].sort((a, b) => {
    const p = getStatusPriority(a.status) - getStatusPriority(b.status);
    if (p !== 0) return p;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  })[0];
};

const fetchDiditDecisionForSession = async (sessionId) => {
  const response = await fetch(`${DIDIT_API_BASE}/session/${sessionId}/decision/`, { headers: getDiditHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error('Didit session retrieve failed');
    err.httpStatus = response.status;
    err.safeBody = toSafeDiditErrorBody(data);
    throw err;
  }
  const normalized = normalizeDiditStatus(data);
  const session = resolveDiditSession(data);
  const reference = resolveDiditReference(data);
  return {
    sessionId,
    status: normalized.status,
    age: resolveDiditAge(session, data),
    reason: resolveDiditReason(data),
    reference,
    rawStatusPath: normalized.rawStatusPath,
    rawStatusValueSafe: normalized.rawStatusValueSafe,
    createdAt: session?.created_at || session?.createdAt || data?.created_at || data?.createdAt || null,
    verificationUrl: session?.url || session?.verificationUrl || session?.verification_url || null,
  };
};

const applyDiditStatusToUser = async ({ uid, sessionId, status, age, reason, source, verificationUrl = null, diagnostics = {} }) => {
  if (!uid) {
    throw new Error('Missing uid for idv update');
  }

  const userRef = db.collection('users').doc(uid);
  const now = FieldValue.serverTimestamp();
  const existingUserSnapshot = await userRef.get();
  const alreadyApproved = existingUserSnapshot.exists
    && existingUserSnapshot.get('ageVerified') === true
    && existingUserSnapshot.get('isAdult') === true;
  const persistenceDecision = resolveDiditPersistenceDecision({ status, age, alreadyApproved });
  const { normalizedStatus, persistedStatus, candidateStatus, isApprovedAdult, adultDecision, updateMode, shouldClearAdultVerification, shouldResetOnboarding, onboardingStep } = persistenceDecision;
  const { age: resolvedAge, ageIsNumber, assumeAdultOnVerified, isAdult } = adultDecision;
  const normalizedReason = normalizeReason(reason);

  const diditPayload = {
    status: persistedStatus || candidateStatus,
    sessionId: sessionId || null,
    reason: normalizedReason,
    verificationUrl: verificationUrl || null,
    lastSource: source || 'unknown',
    lastSyncedAt: now,
    lastSyncSource: source || 'unknown',
    lastSyncAttemptAt: now,
    lastRawStatusPath: diagnostics.rawStatusPath || null,
    lastRawStatusValueSafe: diagnostics.rawStatusValueSafe || null,
    lastSelectedSessionIdSuffix: sessionId ? String(sessionId).slice(-8) : null,
    lastMatchedSessionCount: Number.isFinite(Number(diagnostics.matchedSessionCount)) ? Number(diagnostics.matchedSessionCount) : null,
    lastMatchedApprovedCount: Number.isFinite(Number(diagnostics.matchedApprovedCount)) ? Number(diagnostics.matchedApprovedCount) : null,
    lastReferenceMatch: diagnostics.referenceMatch === true,
    lastResolvedAge: ageIsNumber ? resolvedAge : null,
    lastAgeIsNumber: ageIsNumber,
    lastAssumeAdultOnVerified: assumeAdultOnVerified,
  };

  const existingStepRaw = existingUserSnapshot.exists ? existingUserSnapshot.get('onboardingStep') : null;
  const existingStep = Number.isFinite(Number(existingStepRaw)) ? Number(existingStepRaw) : 0;

  if (isApprovedAdult) {
    const approvedStep = Math.max(existingStep, 3);
    await userRef.set(
      {
        ageVerified: true,
        isAdult: true,
        ageVerifiedAt: now,
        onboardingStep: approvedStep,
        didit: diditPayload,
        idv: diditPayload,
        ageVerificationSource: 'didit',
      },
      { merge: true }
    );
  } else if (shouldClearAdultVerification) {
    const publicUserRef = db.collection('publicUsers').doc(uid);
    const publicUserSnapshot = await publicUserRef.get();
    await userRef.set(
      {
        ageVerified: false,
        isAdult: false,
        onboardingComplete: false,
        onboardingStep: DIDIT_ONBOARDING_STEP,
        didit: diditPayload,
        idv: diditPayload,
        ageVerificationSource: 'didit',
      },
      { merge: true }
    );
    if (publicUserSnapshot.exists) {
      await publicUserRef.set(createUnderagePublicProfilePatch(now), { merge: true });
    }
    await hidePublicPostsForUnderageUser(uid, now);
    await hideManagedProfilesForUnderageUser(uid, now);
  } else if (alreadyApproved) {
    await userRef.set(
      {
        didit: {
          lastSyncAttemptAt: now,
          lastSyncSource: source || 'unknown',
          lastRawStatusPath: diagnostics.rawStatusPath || null,
          lastRawStatusValueSafe: diagnostics.rawStatusValueSafe || null,
          lastSelectedSessionIdSuffix: sessionSuffix(sessionId),
          lastMatchedSessionCount: Number.isFinite(Number(diagnostics.matchedSessionCount)) ? Number(diagnostics.matchedSessionCount) : null,
          lastMatchedApprovedCount: Number.isFinite(Number(diagnostics.matchedApprovedCount)) ? Number(diagnostics.matchedApprovedCount) : null,
          lastReferenceMatch: diagnostics.referenceMatch === true,
          lastResolvedAge: ageIsNumber ? resolvedAge : null,
          lastAgeIsNumber: ageIsNumber,
          lastAssumeAdultOnVerified: assumeAdultOnVerified,
          lastSyncErrorCode: diagnostics.errorCode || null,
          lastSyncErrorSafeMessage: diagnostics.errorSafeMessage || null,
        },
      },
      { merge: true }
    );
  } else {
    await userRef.set(
      {
        didit: diditPayload,
        idv: diditPayload,
      },
      { merge: true }
    );
  }

  if (isApprovedAdult || shouldClearAdultVerification) {
    try {
      const existingClaims = shouldClearAdultVerification
        ? (await admin.auth().getUser(uid)).customClaims || {}
        : {};
      await admin.auth().setCustomUserClaims(uid, {
        ...existingClaims,
        idvVerified: isApprovedAdult,
        isAdult: isApprovedAdult && isAdult === true,
      });
    } catch (error) {
      logger.warn('Failed to update custom claims for Didit status', {
        uid,
        error: error?.message,
      });
    }
  }

  const existingPersistedStatus = existingUserSnapshot.exists
    ? existingUserSnapshot.get('didit.status') || existingUserSnapshot.get('idv.status') || null
    : null;
  return {
    status: updateMode === 'diagnostics_only' ? existingPersistedStatus || 'approved' : persistedStatus,
    normalizedStatus,
    candidateStatus,
    isAdult: isAdult === true,
    adultDecision,
    updateMode,
    shouldClearAdultVerification,
    shouldResetOnboarding,
    onboardingStep,
  };
};

const reconcileDiditSessionsForUid = async (uid) => {
  // Didit list/search endpoint is not available in current integration.
  return {
    available: false,
    sessions: [],
    diagnostics: {
      errorCode: 'didit_uid_reconcile_unavailable',
      errorSafeMessage: 'Didit API uid-based list/search endpoint unavailable in this integration.',
    },
  };
};

export const createDiditSession = onCall(
  {
    region: 'europe-west4',
    // Cloud Functions v2 only exposes secret-backed env vars when attached here.
    secrets: ['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID'],
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const workflowId = process.env.DIDIT_WORKFLOW_ID;
    const appBaseUrl = process.env.APP_BASE_URL || 'https://artes.app';

    if (!workflowId) {
      logger.error('Didit configuration missing', { missing: 'DIDIT_WORKFLOW_ID' });
      throw new HttpsError('failed-precondition', 'Verificatie is tijdelijk niet beschikbaar');
    }
    if (!process.env.APP_BASE_URL) {
      logger.warn('APP_BASE_URL is not configured, using default for Didit callback', {
        fallback: 'https://artes.app',
      });
    }
    const existingUser = await db.collection('users').doc(request.auth.uid).get();
    if (existingUser.exists && existingUser.get('ageVerified') === true && existingUser.get('isAdult') === true) {
      return { status: 'approved', ageVerified: true, sessionId: existingUser.get('didit.sessionId') || null, verificationUrl: null };
    }
    const reconciled = await reconcileDiditSessionsForUid(request.auth.uid);
    const bestReconciled = selectBestCandidate(reconciled.sessions || []);
    if (bestReconciled?.status === 'approved') {
      const appliedStatus = await applyDiditStatusToUser({
        uid: request.auth.uid,
        sessionId: bestReconciled.sessionId,
        status: 'approved',
        age: bestReconciled.age,
        reason: bestReconciled.reason,
        source: 'create_preflight_reconcile',
        diagnostics: {
          rawStatusPath: bestReconciled.rawStatusPath,
          rawStatusValueSafe: bestReconciled.rawStatusValueSafe,
          matchedSessionCount: reconciled.sessions.length,
          matchedApprovedCount: reconciled.sessions.filter((s) => s.status === 'approved').length,
          referenceMatch: true,
        },
      });
      if (appliedStatus.ageVerified === true && appliedStatus.isAdult === true) {
        return { status: 'approved', ageVerified: true, isAdult: true, sessionId: bestReconciled.sessionId, verificationUrl: null };
      }
    }

    const appBaseOrigin = normalizeOrigin(appBaseUrl);
    if (!appBaseOrigin) {
      throw new HttpsError('failed-precondition', 'Invalid APP_BASE_URL');
    }

    const requestedOrigin = normalizeOrigin(request.data?.returnToOrigin);
    const allowedOrigins = resolveAllowedDiditOrigins(appBaseOrigin);
    const finalBaseOrigin = isAllowedDiditOrigin(requestedOrigin, allowedOrigins)
      ? requestedOrigin
      : appBaseOrigin;

    const redirectUrl = `${finalBaseOrigin.replace(/\/$/, '')}/onboarding?step=2&diditReturn=1`;

  // Didit v2 verwacht workflow_id + callback + vendor_data (je eigen user id) + metadata.
    const payload = {
      workflow_id: workflowId,
      callback: redirectUrl,
      vendor_data: request.auth.uid,
      metadata: {
        uid: request.auth.uid,
      },
    };

    logger.info('Creating Didit session', {
      uid: request.auth.uid,
      hasWorkflowId: Boolean(workflowId),
      finalBaseOrigin,
    });

    let response;
    try {
      response = await fetch(`${DIDIT_API_BASE}/session/`, {
        method: 'POST',
        headers: getDiditHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (error) {
      logger.error('Didit session create fetch failed', { error: error?.message });
      throw new HttpsError('unavailable', 'Failed to reach Didit');
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.error('Didit session create failed', {
        status: response.status,
        body: toSafeDiditErrorBody(data),
        uid: request.auth.uid,
      });
      const detail =
        data?.detail ||
        data?.message ||
        data?.error ||
        'Didit session create failed';
      throw new HttpsError('permission-denied', detail);
    }

    const sessionId = data?.session_id || data?.sessionId || data?.id || null;
    const verificationUrl = data?.url || data?.verificationUrl || data?.verification_url || null;

    await db.collection('users').doc(request.auth.uid).set({
      didit: {
        status: 'started',
        sessionId,
        verificationUrl,
        callback: redirectUrl,
        workflowId,
        lastSyncSource: 'create-session',
        lastSyncAttemptAt: FieldValue.serverTimestamp(),
      },
      idv: {
        status: 'started',
        sessionId,
        verificationUrl,
      },
    }, { merge: true });

    logger.info('Didit session created', {
      uid: request.auth.uid,
      sessionId,
    });

    return { sessionId, verificationUrl };
  }
);

export const refreshDiditVerificationStatus = onCall({ region: 'europe-west4', secrets: ['DIDIT_API_KEY', 'DIDIT_ASSUME_ADULT_ON_VERIFIED'] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const userRef = db.collection('users').doc(request.auth.uid);
  const userSnap = await userRef.get();
  const storedSessionId = userSnap.get('didit.sessionId') || userSnap.get('idv.sessionId') || null;
  const requestedSessionId = request.data?.sessionId || null;
  if (!storedSessionId && !requestedSessionId) {
    throw new HttpsError('invalid-argument', 'Missing sessionId');
  }
  const candidateSessionIds = [...new Set([storedSessionId, requestedSessionId].filter(Boolean))];
  const candidates = [];
  let lastSyncErrorCode = null;
  for (const candidateSessionId of candidateSessionIds) {
    const decision = await fetchDiditDecisionForSession(candidateSessionId).catch((error) => {
      logger.warn('Didit candidate poll failed', { sessionIdSuffix: sessionSuffix(candidateSessionId), error: error?.message, httpStatus: error?.httpStatus || null });
      lastSyncErrorCode = error?.code || error?.httpStatus || 'decision_fetch_failed';
      return null;
    });
    if (!decision) continue;
    const hasReference = Boolean(decision.reference);
    const referenceMatches = decision.reference === request.auth.uid;
    const isStoredCandidate = candidateSessionId === storedSessionId;
    const isRequestedOnlyCandidate =
      candidateSessionId === requestedSessionId && candidateSessionId !== storedSessionId;

    if (isRequestedOnlyCandidate && !referenceMatches) {
      throw new HttpsError('permission-denied', 'Requested session ownership could not be proven');
    }

    if (isStoredCandidate && hasReference && !referenceMatches) {
      logger.warn('Didit stored candidate ownership mismatch', {
        uid: request.auth.uid,
        sessionIdSuffix: sessionSuffix(candidateSessionId),
      });
      continue;
    }

    if (!isStoredCandidate && !isRequestedOnlyCandidate) {
      continue;
    }

    candidates.push({
      ...decision,
      ownershipMode: referenceMatches ? 'didit_reference' : 'stored_trusted',
    });
  }
  const reconciled = await reconcileDiditSessionsForUid(request.auth.uid);
  const allCandidates = [...candidates, ...(reconciled.sessions || [])];
  const selected = selectBestCandidate(allCandidates);
  if (!selected) {
    lastSyncErrorCode = lastSyncErrorCode || (reconciled.available ? null : reconciled.diagnostics.errorCode) || 'no_candidate';
    throw new HttpsError('failed-precondition', 'Geen eigendom-gevalideerde Didit sessie gevonden');
  }

  const result = await applyDiditStatusToUser({
    uid: request.auth.uid,
    sessionId: selected.sessionId,
    status: selected.status,
    age: selected.age,
    reason: selected.reason,
    source: selected.status === 'approved' ? 'refresh_reconcile' : 'poll',
    verificationUrl: selected.verificationUrl || null,
    diagnostics: {
      rawStatusPath: selected.rawStatusPath,
      rawStatusValueSafe: selected.rawStatusValueSafe,
      matchedSessionCount: allCandidates.length,
      matchedApprovedCount: allCandidates.filter((s) => s.status === 'approved').length,
      referenceMatch: selected.reference === request.auth.uid,
      ownershipMode: selected.ownershipMode || (selected.reference === request.auth.uid ? 'didit_reference' : 'stored_trusted'),
      lastSyncErrorCode,
      errorCode: reconciled.available ? null : reconciled.diagnostics.errorCode,
      errorSafeMessage: reconciled.available ? null : reconciled.diagnostics.errorSafeMessage,
    },
  });

  return {
    status: result.status,
    isAdult: result.isAdult,
    sessionId: selected.sessionId,
  };
});

export const refreshDiditSession = refreshDiditVerificationStatus;

const safeEqualHex = (a, b) => {
  if (!a || !b) return false;
  const left = String(a).trim().toLowerCase();
  const right = String(b).trim().toLowerCase();
  if (!/^[a-f0-9]+$/.test(left) || !/^[a-f0-9]+$/.test(right) || left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
  } catch (error) {
    return false;
  }
};

const sortJsonKeysRecursively = (value) => {
  if (Array.isArray(value)) return value.map((item) => sortJsonKeysRecursively(item));
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortJsonKeysRecursively(value[key]);
        return acc;
      }, {});
  }
  return value;
};

const computeDiditSignatureV2FromPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return JSON.stringify(sortJsonKeysRecursively(payload));
};

const verifyDiditWebhookSignature = (req, payload) => {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (!secret) {
    if (!isProd) {
      logger.warn('Didit webhook secret missing; rejecting in non-production too');
    } else {
      logger.error('Didit webhook secret missing in production');
    }
    return { ok: false, reason: 'missing_secret' };
  }

  const signatureV2 = req.get('x-signature-v2');
  const signatureSimple = req.get('x-signature-simple');
  const signatureRaw = req.get('x-signature');
  const timestampHeader = req.get('x-timestamp');
  const rawBodyBuffer = Buffer.isBuffer(req.rawBody) ? req.rawBody : null;

  if (signatureV2) {
    const canonicalPayload = computeDiditSignatureV2FromPayload(payload);
    const signedInput = canonicalPayload ? `${timestampHeader || ''}.${canonicalPayload}` : null;
    if (signedInput) {
      const expectedV2 = crypto.createHmac('sha256', secret).update(signedInput).digest('hex');
      const normalizedV2 = String(signatureV2).replace(/^sha256=/i, '');
      if (safeEqualHex(expectedV2, normalizedV2)) return { ok: true, mode: 'v2' };
    }
  }

  if (signatureV2 && rawBodyBuffer && timestampHeader) {
    const rawPayload = rawBodyBuffer.toString('utf8');
    const expectedV2Raw = crypto.createHmac('sha256', secret).update(`${timestampHeader}.${rawPayload}`).digest('hex');
    const normalizedV2Raw = String(signatureV2).replace(/^sha256=/i, '');
    if (safeEqualHex(expectedV2Raw, normalizedV2Raw)) return { ok: true, mode: 'v2_raw_fallback' };
  }

  if (signatureSimple) {
    const rawSessionId = payload?.session_id;
    const rawStatus = payload?.status;
    const rawWebhookType = payload?.webhook_type;
    const rawTimestamp = timestampHeader || payload?.timestamp;
    if (rawSessionId != null && rawStatus != null && rawWebhookType != null && rawTimestamp != null) {
      const messageCurrent = `${rawTimestamp}:${rawSessionId}:${rawStatus}:${rawWebhookType}`;
      const expectedSimpleCurrent = crypto.createHmac('sha256', secret).update(messageCurrent).digest('hex');
      const normalizedSimple = String(signatureSimple).replace(/^sha256=/i, '');
      if (safeEqualHex(expectedSimpleCurrent, normalizedSimple)) return { ok: true, mode: 'simple_current_docs' };
    }

    const rawCreatedAt = payload?.created_at;
    if (rawSessionId != null && rawStatus != null && rawCreatedAt != null) {
      const messageLegacy = `${rawSessionId}|${rawStatus}|${rawCreatedAt}`;
      const expectedSimpleLegacy = crypto.createHmac('sha256', secret).update(messageLegacy).digest('hex');
      const normalizedSimple = String(signatureSimple).replace(/^sha256=/i, '');
      if (safeEqualHex(expectedSimpleLegacy, normalizedSimple)) return { ok: true, mode: 'simple_legacy_demo' };
    }
  }

  if (signatureRaw && rawBodyBuffer) {
    const expectedV2 = crypto.createHmac('sha256', secret).update(rawBodyBuffer).digest('hex');
    const normalizedRaw = String(signatureRaw).replace(/^sha256=/i, '');
    if (safeEqualHex(expectedV2, normalizedRaw)) return { ok: true, mode: 'raw' };
  }

  return { ok: false, reason: 'invalid_signature' };
};

export const __diditWebhookTestUtils = {
  safeEqualHex,
  computeDiditSignatureV2FromPayload,
  verifyDiditWebhookSignature,
};

export const diditWebhook = onRequest({ region: 'europe-west4', secrets: ['DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_ASSUME_ADULT_ON_VERIFIED'] }, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let payload = {};
  if (typeof req.body === 'string') {
    try {
      payload = JSON.parse(req.body);
    } catch (error) {
      logger.error('Didit webhook invalid JSON', { error: error?.message });
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  } else {
    payload = req.body || {};
  }

  const signatureResult = verifyDiditWebhookSignature(req, payload);
  if (!signatureResult.ok) {
    logger.warn('Didit webhook signature verification failed', { code: signatureResult.reason });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const reference = resolveDiditReference(payload);
  const sessionId = resolveDiditSessionId(payload);
  const normalized = normalizeDiditStatus(payload);
  const status = normalized.status;
  const reason = resolveDiditReason(payload);
  const session = resolveDiditSession(payload);
  const age = resolveDiditAge(session, payload);

  logger.info('Didit webhook received', {
    hasReference: Boolean(reference),
    hasMetadataUid: Boolean(payload?.metadata?.uid || payload?.data?.metadata?.uid || payload?.session?.metadata?.uid),
    hasVendorData: Boolean(payload?.vendor_data || payload?.data?.vendor_data || payload?.session?.vendor_data),
    sessionIdSuffix: sessionSuffix(sessionId),
    status,
    rawStatusPath: normalized.rawStatusPath,
    rawStatusValueSafe: normalized.rawStatusValueSafe,
    eventType: String(payload?.webhook_type || payload?.event?.type || payload?.type || 'unknown'),
    signatureMode: signatureResult.mode,
  });

  let resolvedUid = reference;
  if (!resolvedUid && sessionId) {
    const [directSnap, idvSnap] = await Promise.all([
      db.collection('users').where('didit.sessionId', '==', sessionId).get(),
      db.collection('users').where('idv.sessionId', '==', sessionId).get(),
    ]);
    const unique = new Set([...directSnap.docs, ...idvSnap.docs].map((d) => d.id));
    if (unique.size === 1) resolvedUid = [...unique][0];
    if (unique.size !== 1) {
      logger.warn('Didit webhook unresolved uid', {
        hasReference: Boolean(reference),
        hasSessionId: Boolean(sessionId),
        sessionIdSuffix: sessionSuffix(sessionId),
        status,
        rawStatusPath: normalized.rawStatusPath,
        rawStatusValueSafe: normalized.rawStatusValueSafe,
      });
      return res.status(400).json({ error: 'Missing reference' });
    }
  }
  if (!resolvedUid) {
    logger.warn('Didit webhook missing reference', {
      hasReference: false,
      hasSessionId: Boolean(sessionId),
      sessionIdSuffix: sessionSuffix(sessionId),
      status,
      rawStatusPath: normalized.rawStatusPath,
      rawStatusValueSafe: normalized.rawStatusValueSafe,
      eventType: String(payload?.event?.type || payload?.type || 'unknown'),
    });
    return res.status(400).json({ error: 'Missing reference' });
  }

  try {
    await applyDiditStatusToUser({
      uid: resolvedUid,
      sessionId,
      status,
      age,
      reason,
      source: 'webhook',
      diagnostics: {
        rawStatusPath: normalized.rawStatusPath,
        rawStatusValueSafe: normalized.rawStatusValueSafe,
        matchedSessionCount: 1,
        matchedApprovedCount: status === 'approved' ? 1 : 0,
        referenceMatch: true,
        signatureMode: signatureResult.mode || null,
      },
    });
    await db.collection('users').doc(resolvedUid).set({
      didit: {
        lastWebhookReceivedAt: FieldValue.serverTimestamp(),
        lastWebhookEventType: String(payload?.webhook_type || payload?.event?.type || payload?.type || 'unknown'),
        lastWebhookStatusSafe: status,
        lastWebhookSessionIdSuffix: sessionSuffix(sessionId),
        lastWebhookSignatureMode: signatureResult.mode || null,
        lastSyncSource: 'webhook',
        lastRawStatusPath: normalized.rawStatusPath,
        lastRawStatusValueSafe: normalized.rawStatusValueSafe,
        lastReferenceMatch: true,
        lastSyncErrorCode: null,
        lastSyncErrorSafeMessage: null,
      },
    }, { merge: true });
  } catch (error) {
    logger.error('Failed to update Didit webhook status', {
      error: error?.message,
      uid: resolvedUid,
      hasReference: Boolean(reference),
      sessionIdSuffix: sessionSuffix(sessionId),
      status,
    });
    return res.status(500).json({ error: 'Failed to update status' });
  }

  return res.status(200).json({ ok: true });
});
