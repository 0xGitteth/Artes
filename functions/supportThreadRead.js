import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';

export const resolveSupportThreadId = ({ threadId, userUid } = {}) => {
  const requestedThreadId = String(threadId || '').trim();
  if (requestedThreadId) return requestedThreadId;
  const requestedUserUid = String(userUid || '').trim();
  return requestedUserUid ? `support_${requestedUserUid}` : '';
};

export const markSupportThreadReadForModeratorCore = async ({ db, decoded, ensureModerator, body }) => {
  if (!decoded?.uid) {
    const error = new Error('Missing auth token');
    error.status = 401;
    throw error;
  }

  await ensureModerator(decoded);

  const threadId = resolveSupportThreadId(body || {});
  if (!threadId) {
    const error = new Error('threadId or userUid is required');
    error.status = 400;
    throw error;
  }
  if (!threadId.startsWith('support_')) {
    const error = new Error('Only support threads can be marked read');
    error.status = 400;
    throw error;
  }

  const threadRef = db.collection('threads').doc(threadId);
  const threadSnap = await threadRef.get();
  if (!threadSnap.exists) {
    const error = new Error('Support thread not found');
    error.status = 404;
    throw error;
  }

  const threadData = threadSnap.data() || {};
  if (threadData.type !== 'support') {
    const error = new Error('Only support threads can be marked read');
    error.status = 400;
    throw error;
  }

  await threadRef.set({
    unreadForModerator: 0,
    moderatorLastReadAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, threadId };
};

export const createMarkSupportThreadReadForModerator = ({ db, verifyToken, ensureModerator, parseJsonBody }) => onRequest({ cors: true, region: 'europe-west4' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const decoded = await verifyToken(req);
    const body = parseJsonBody(req) || {};
    const result = await markSupportThreadReadForModeratorCore({ db, decoded, ensureModerator, body });
    res.status(200).json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message || 'Failed to mark support thread read' });
  }
});
