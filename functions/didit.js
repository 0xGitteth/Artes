import crypto from 'crypto';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();
const DIDIT_API_BASE = process.env.DIDIT_API_BASE_URL || 'https://verification.didit.me/v3';

const getDiditHeaders = () => {
  const apiKey = process.env.DIDIT_API_KEY;
  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'Missing DIDIT_API_KEY');
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
};

const normalizeStatus = (status) => String(status || '').trim().toLowerCase();

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

  const dob = session?.dateOfBirth
    || session?.date_of_birth
    || session?.document?.dateOfBirth
    || session?.document?.date_of_birth
    || session?.person?.dateOfBirth
    || session?.person?.date_of_birth
    || session?.data?.dateOfBirth
    || session?.data?.date_of_birth;
  return calculateAgeFromDob(dob);
};

const resolveDiditReference = (payload) => (
  payload?.reference
  || payload?.session?.reference
  || payload?.data?.reference
  || payload?.session?.metadata?.uid
  || payload?.session?.metadata?.reference
  || payload?.metadata?.uid
  || payload?.metadata?.reference
  || payload?.data?.metadata?.uid
  || payload?.data?.metadata?.reference
);

const resolveDiditSession = (payload) => payload?.session || payload?.data || payload;

const resolveDiditStatus = (payload) => {
  const session = resolveDiditSession(payload);
  const status = normalizeStatus(session?.status || payload?.status || session?.result?.status);
  if (status === 'approved') return 'verified';
  if (status === 'rejected') return 'rejected';
  return status;
};

const resolveDiditReason = (payload) => {
  const session = resolveDiditSession(payload);
  return session?.reason || session?.status_reason || payload?.reason || payload?.status_reason || null;
};

const resolveDiditSessionId = (payload) => {
  const session = resolveDiditSession(payload);
  return session?.id || payload?.sessionId || payload?.session_id || null;
};

const isApprovedStatus = (status) => ['approved', 'verified', 'completed', 'success'].includes(status);
const isRejectedStatus = (status) => ['rejected', 'declined', 'failed', 'denied'].includes(status);

const updateIdvStatus = async ({ uid, sessionId, status, age, reason, source }) => {
  if (!uid) {
    throw new Error('Missing uid for idv update');
  }

  const idvRef = db.collection('users').doc(uid).collection('idv').doc('status');
  const userRef = db.collection('users').doc(uid);
  const now = FieldValue.serverTimestamp();
  const normalizedStatus = normalizeStatus(status);
  const isAdult = Number.isFinite(age) ? age >= 18 : null;
  const updates = {
    status: normalizedStatus || 'unknown',
    sessionId: sessionId || null,
    age: Number.isFinite(age) ? age : null,
    isAdult: isAdult ?? null,
    reason: reason || null,
    updatedAt: now,
    lastSource: source || 'unknown',
  };

  if (isApprovedStatus(normalizedStatus)) {
    updates.verifiedAt = now;
  }

  if (isRejectedStatus(normalizedStatus)) {
    updates.rejectedAt = now;
  }

  await idvRef.set(updates, { merge: true });

  if (isApprovedStatus(normalizedStatus)) {
    await userRef.set(
      {
        ageVerified: isAdult === true,
        ageVerifiedAt: now,
        isAdult: isAdult === true,
      },
      { merge: true }
    );
    if (isAdult === true) {
      await userRef.set({ onboardingStep: 3 }, { merge: true });
    }
  }

  if (isRejectedStatus(normalizedStatus)) {
    await userRef.set(
      {
        ageVerified: false,
        isAdult: false,
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

export const createDiditSession = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const workflowId = process.env.DIDIT_WORKFLOW_ID;
  const appBaseUrl = process.env.APP_BASE_URL;

  if (!workflowId) {
    throw new HttpsError('failed-precondition', 'Missing DIDIT_WORKFLOW_ID');
  }
  if (!appBaseUrl) {
    throw new HttpsError('failed-precondition', 'Missing APP_BASE_URL');
  }

  const redirectUrl = `${appBaseUrl.replace(/\/$/, '')}/onboarding?step=2&diditReturn=1`;
  const payload = {
    workflowId,
    reference: request.auth.uid,
    redirectUrl,
    metadata: {
      uid: request.auth.uid,
    },
  };

  logger.info('Creating Didit session', {
    uid: request.auth.uid,
    workflowId,
    redirectUrl,
  });

  let response;
  try {
    response = await fetch(`${DIDIT_API_BASE}/sessions`, {
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
    logger.error('Didit session create failed', { status: response.status, data });
    throw new HttpsError('internal', 'Didit session create failed');
  }

  const sessionId = data?.id || data?.sessionId || data?.session_id || null;
  const verificationUrl = data?.verificationUrl
    || data?.verification_url
    || data?.url
    || data?.link
    || null;

  await db.collection('users').doc(request.auth.uid).collection('idv').doc('status').set(
    {
      status: 'pending',
      sessionId,
      workflowId,
      verificationUrl,
      redirectUrl,
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
});

export const refreshDiditSession = onCall({ region: 'europe-west4' }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const sessionId = request.data?.sessionId;
  if (!sessionId) {
    throw new HttpsError('invalid-argument', 'Missing sessionId');
  }

  let response;
  try {
    response = await fetch(`${DIDIT_API_BASE}/sessions/${sessionId}`, {
      headers: getDiditHeaders(),
    });
  } catch (error) {
    logger.error('Didit session retrieve failed', { error: error?.message });
    throw new HttpsError('unavailable', 'Failed to reach Didit');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    logger.error('Didit session retrieve error', { status: response.status, data });
    throw new HttpsError('internal', 'Didit session retrieve failed');
  }

  const session = resolveDiditSession(data);
  const status = resolveDiditStatus(data);
  const age = resolveDiditAge(session);
  const reason = resolveDiditReason(data);
  const reference = resolveDiditReference(data);
  const resolvedUid = reference || request.auth.uid;

  logger.info('Didit session refreshed', {
    uid: resolvedUid,
    sessionId,
    status,
    age,
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
  if (!secret) {
    logger.error('Didit webhook secret is not configured');
    return false;
  }

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

  const headerSecret = req.get('x-didit-webhook-secret')
    || req.get('x-didit-secret')
    || req.get('x-webhook-secret');

  return headerSecret === secret;
};

export const diditWebhook = onRequest({ region: 'europe-west4' }, async (req, res) => {
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
