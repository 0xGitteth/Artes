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

const resolveDiditAge = (session) => {
  const directAge = [
    session?.age,
    session?.subject?.age,
    session?.person?.age,
    session?.result?.age,
    session?.verification?.age,
    session?.data?.age,
  ]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));
  if (Number.isFinite(directAge)) return directAge;

  const dob =
    session?.dateOfBirth ||
    session?.date_of_birth ||
    session?.document?.dateOfBirth ||
    session?.document?.date_of_birth ||
    session?.person?.dateOfBirth ||
    session?.person?.date_of_birth ||
    session?.data?.dateOfBirth ||
    session?.data?.date_of_birth;

  return calculateAgeFromDob(dob);
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

const resolveDiditStatus = (payload) => {
  const session = resolveDiditSession(payload);

  const raw =
    session?.status ||
    payload?.status ||
    session?.result?.status ||
    session?.decision?.status ||
    payload?.decision?.status;

  const status = normalizeStatus(raw);

  if (status === 'approved') return 'verified';
  if (status === 'rejected') return 'rejected';

  return status;
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

const isApprovedStatus = (status) => ['approved', 'verified', 'completed', 'success'].includes(status);
const isRejectedStatus = (status) => ['rejected', 'declined', 'failed', 'denied'].includes(status);

const resolveDiditAdultDecision = (status, age) => {
  const normalizedStatus = normalizeStatus(status);
  const ageIsNumber = Number.isFinite(age);
  const assumeAdultOnVerified = isApprovedStatus(normalizedStatus) && DIDIT_ASSUME_ADULT_ON_VERIFIED;
  const isAdult = ageIsNumber ? age >= 18 : assumeAdultOnVerified ? true : null;
  return {
    normalizedStatus,
    ageIsNumber,
    assumeAdultOnVerified,
    isAdult,
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

const updateIdvStatus = async ({ uid, sessionId, status, age, reason, source }) => {
  if (!uid) {
    throw new Error('Missing uid for idv update');
  }

  const idvRef = db.collection('users').doc(uid).collection('idv').doc('status');
  const userRef = db.collection('users').doc(uid);
  const now = FieldValue.serverTimestamp();
  const { normalizedStatus, ageIsNumber, isAdult } = resolveDiditAdultDecision(status, age);
  const normalizedReason = normalizeReason(reason);

  const updates = {
    status: normalizedStatus || 'unknown',
    sessionId: sessionId || null,
    age: ageIsNumber ? age : null,
    isAdult: isAdult ?? null,
    reason: normalizedReason,
    updatedAt: now,
    lastSource: source || 'unknown',
  };

  if (isApprovedStatus(normalizedStatus)) {
    if (isAdult === true) {
      updates.verifiedAt = now;
      updates.isAdult = true;
    }
  }

  if (isRejectedStatus(normalizedStatus)) {
    updates.rejectedAt = now;
    updates.isAdult = false;
  }

  await idvRef.set(updates, { merge: true });

  const existingUserSnapshot = await userRef.get();
  const existingStepRaw = existingUserSnapshot.exists ? existingUserSnapshot.get('onboardingStep') : null;
  const existingStep = Number.isFinite(Number(existingStepRaw)) ? Number(existingStepRaw) : 0;

  if (isApprovedStatus(normalizedStatus)) {
    const approvedStep = Math.max(existingStep, 3);
    await userRef.set(
      {
        ageVerified: isAdult === true,
        isAdult: isAdult === true,
        ...(isAdult === true
          ? {
            ageVerifiedAt: now,
            onboardingStep: approvedStep,
          }
          : {}),
      },
      { merge: true }
    );
  }

  if (isRejectedStatus(normalizedStatus)) {
    const rejectedStep = Math.max(existingStep, 2);
    await userRef.set(
      {
        ageVerified: false,
        isAdult: false,
        onboardingStep: rejectedStep,
      },
      { merge: true }
    );
  }

  if (isApprovedStatus(normalizedStatus)) {
    try {
      await admin.auth().setCustomUserClaims(uid, {
        idvVerified: true,
        isAdult: isAdult === true,
      });
    } catch (error) {
      logger.warn('Failed to set custom claims for Didit status', {
        uid,
        error: error?.message,
      });
    }
  }

  return { status: normalizedStatus, isAdult };
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

    await db
      .collection('users')
      .doc(request.auth.uid)
      .collection('idv')
      .doc('status')
      .set(
        {
          status: 'pending',
          sessionId,
          workflowId,
          verificationUrl,
          callback: redirectUrl,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    logger.info('Didit session created', {
      uid: request.auth.uid,
      sessionId,
    });

    return { sessionId, verificationUrl };
  }
);

export const refreshDiditSession = onCall({ region: 'europe-west4', secrets: ['DIDIT_API_KEY', 'DIDIT_ASSUME_ADULT_ON_VERIFIED'] }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const sessionId = request.data?.sessionId;
  if (!sessionId) {
    throw new HttpsError('invalid-argument', 'Missing sessionId');
  }

  let response;
  try {
    response = await fetch(`${DIDIT_API_BASE}/session/${sessionId}/decision/`, {
      headers: getDiditHeaders(),
    });
  } catch (error) {
    logger.error('Didit session retrieve failed', { error: error?.message });
    throw new HttpsError('unavailable', 'Failed to reach Didit');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.error('Didit session retrieve error', {
      status: response.status,
      body: toSafeDiditErrorBody(data),
      sessionId,
    });
    throw new HttpsError('internal', 'Didit session retrieve failed');
  }

  const session = resolveDiditSession(data);
  const status = resolveDiditStatus(data);
  const age = resolveDiditAge(session);
  const reason = resolveDiditReason(data);
  const reference = resolveDiditReference(data);
  const resolvedUid = reference || request.auth.uid;
  const decision = resolveDiditAdultDecision(status, age);

  logger.info('Didit session refresh response', {
    uid: resolvedUid,
    sessionId,
    status,
    age,
    reason,
    responseStatus: response.status,
    hasSession: Boolean(session),
  });

  logger.info('Didit refresh resolved decision for idv update', {
    sessionId,
    resolvedUid,
    resolvedStatus: decision.normalizedStatus || 'unknown',
    resolvedAge: decision.ageIsNumber ? age : null,
    diditAssumeAdultOnVerified: DIDIT_ASSUME_ADULT_ON_VERIFIED,
    isAdultForUpdate: decision.isAdult,
  });

  const result = await updateIdvStatus({
    uid: resolvedUid,
    sessionId,
    status,
    age,
    reason,
    source: 'poll',
  });

  return {
    status: result.status,
    isAdult: result.isAdult,
    sessionId,
  };
});

const verifyWebhookSecret = (req) => {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.get('x-didit-signature');
  if (signature) {
    const rawBody = req.rawBody || '';
    const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const normalizedSignature = signature.startsWith('sha256=')
      ? signature.slice('sha256='.length)
      : signature;
    try {
      return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(normalizedSignature));
    } catch (error) {
      return false;
    }
  }

  const headerSecret =
    req.get('x-didit-webhook-secret') ||
    req.get('x-didit-secret') ||
    req.get('x-webhook-secret');

  return headerSecret === secret;
};

export const diditWebhook = onRequest({ region: 'europe-west4', secrets: ['DIDIT_API_KEY', 'DIDIT_WEBHOOK_SECRET', 'DIDIT_ASSUME_ADULT_ON_VERIFIED'] }, async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyWebhookSecret(req)) {
    logger.warn('Didit webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
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

  const reference = resolveDiditReference(payload);
  const sessionId = resolveDiditSessionId(payload);
  const status = resolveDiditStatus(payload);
  const reason = resolveDiditReason(payload);
  const session = resolveDiditSession(payload);
  const age = resolveDiditAge(session);

  logger.info('Didit webhook received', {
    reference,
    sessionId,
    status,
    age,
  });

  if (!reference) {
    logger.error('Didit webhook missing reference', { payload });
    return res.status(400).json({ error: 'Missing reference' });
  }

  try {
    await updateIdvStatus({
      uid: reference,
      sessionId,
      status,
      age,
      reason,
      source: 'webhook',
    });
  } catch (error) {
    logger.error('Failed to update Didit webhook status', {
      error: error?.message,
      reference,
      sessionId,
      status,
    });
    return res.status(500).json({ error: 'Failed to update status' });
  }

  return res.status(200).json({ ok: true });
});
