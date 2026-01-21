import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDbInstance } from '../firebase';
import { normalizeSupportMessage, SUPPORT_INTRO_TEXT } from '../utils/supportChat';

const MESSAGE_LIMIT = 80;

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const resolveDisplayName = (authUser, fallback) => {
  if (authUser?.displayName) return authUser.displayName;
  if (authUser?.email) return authUser.email.split('@')[0];
  return fallback || 'Artes gebruiker';
};

export default function SupportChatPanel({ authUser }) {
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [composerText, setComposerText] = useState('');
  const [sendError, setSendError] = useState(null);

  const threadId = useMemo(() => (authUser?.uid ? `support_${authUser.uid}` : null), [authUser?.uid]);

  useEffect(() => {
    if (!threadId || !authUser) return;
    const db = getFirebaseDbInstance();
    const threadRef = doc(db, 'threads', threadId);
    let active = true;
    const ensureThread = async () => {
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(threadRef);
        if (snapshot.exists()) return;
        const displayName = resolveDisplayName(authUser);
        transaction.set(threadRef, {
          type: 'support',
          threadKey: threadId,
          userUid: authUser.uid,
          participantUids: [authUser.uid],
          userDisplayName: displayName,
          userDisplayNameLower: displayName.toLowerCase(),
          userPhotoURL: authUser.photoURL ?? null,
          userUsername: '',
          userMessageAllowance: 1,
          userCanSend: true,
          lastMessageAt: serverTimestamp(),
          lastMessagePreview: SUPPORT_INTRO_TEXT,
          unreadForModerator: 0,
          unreadForUser: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        const messageRef = doc(collection(threadRef, 'messages'));
        transaction.set(messageRef, {
          text: SUPPORT_INTRO_TEXT,
          senderUid: null,
          senderRole: 'system',
          senderLabel: 'Artes Moderatie',
          type: 'system',
          createdAt: serverTimestamp(),
        });
      });
      if (!active) return;
    };
    ensureThread();
    return () => {
      active = false;
    };
  }, [threadId, authUser]);

  useEffect(() => {
    if (!threadId) {
      setThread(null);
      return undefined;
    }
    const db = getFirebaseDbInstance();
    return onSnapshot(
      doc(db, 'threads', threadId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setThread(null);
          return;
        }
        setThread({ id: snapshot.id, ...snapshot.data() });
      },
      (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Thread listener threads/${threadId}`),
    );
  }, [threadId]);

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return undefined;
    }
    const db = getFirebaseDbInstance();
    const messagesRef = collection(db, 'threads', threadId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setMessages(list.slice(-MESSAGE_LIMIT));
      },
      (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Thread messages listener threads/${threadId}/messages`),
    );
  }, [threadId]);

  const normalizedMessages = useMemo(
    () => messages.map((message) => normalizeSupportMessage(message, thread)).filter(Boolean),
    [messages, thread],
  );
  const lastRealMessage = useMemo(
    () => [...normalizedMessages].reverse().find((message) => message.senderRole === 'user' || message.senderRole === 'moderator'),
    [normalizedMessages],
  );
  const canSend = !lastRealMessage || lastRealMessage.senderRole === 'moderator';

  // Count user messages for anti-spam logic (debug)
  if (import.meta.env.DEV) {
    const userMsgCount = normalizedMessages.filter((message) => message.senderRole === 'user').length;
    const lastMsg = lastRealMessage;
    const hasModReply = lastMsg?.senderRole === 'moderator';
    console.log('[SupportChatPanel] Support thread state:', {
      totalMessages: normalizedMessages.length,
      userMessages: userMsgCount,
      lastMessageRole: lastMsg?.senderRole || 'none',
      hasModeratorReply: hasModReply,
      canSend: canSend,
      userCanSend: thread?.userCanSend,
      userMessageAllowance: thread?.userMessageAllowance,
      messageSummary: normalizedMessages.map((m) => ({
        role: m.senderRole || 'unknown',
        text: m.text?.substring(0, 40) || '(empty)',
        isUserMessage: m.senderRole === 'user',
      }))
    });
  }

  const handleSendMessage = async () => {
    if (!authUser?.uid || !threadId) return;
    const trimmed = composerText.trim();
    if (!trimmed) return;
    if (!canSend) {
      setSendError('Je kunt pas weer een bericht sturen nadat de moderatie heeft gereageerd.');
      return;
    }
    setSendError(null);
    const db = getFirebaseDbInstance();
    const threadRef = doc(db, 'threads', threadId);
    await runTransaction(db, async (transaction) => {
      const threadSnap = await transaction.get(threadRef);
      if (!threadSnap.exists()) throw new Error('Thread ontbreekt.');
      const threadData = threadSnap.data();
      if (!canSend) {
        throw new Error('Je kunt pas weer een bericht sturen nadat de moderatie heeft gereageerd.');
      }
      const messageRef = doc(collection(threadRef, 'messages'));
      transaction.set(messageRef, {
        text: trimmed,
        senderId: authUser.uid,
        senderUid: authUser.uid,
        senderRole: 'user',
        senderLabel: resolveDisplayName(authUser),
        type: 'text',
        createdAt: serverTimestamp(),
      });
      if (import.meta.env.DEV) {
        console.log('[SupportChatPanel] Sent user message with senderRole: user');
      }
      transaction.update(threadRef, {
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: trimmed,
        userMessageAllowance: 0,
        userCanSend: false,
        unreadForModerator: (threadData?.unreadForModerator || 0) + 1,
        unreadForUser: 0,
        updatedAt: serverTimestamp(),
      });
    });
    setComposerText('');
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div>
          <h3 className="text-lg font-semibold dark:text-white">Artes Moderatie</h3>
          <p className="text-xs text-slate-500">Support chat</p>
        </div>
        {thread?.lastMessageAt && (
          <span className="text-xs text-slate-400">{formatDateTime(thread.lastMessageAt)}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 bg-slate-50 dark:bg-slate-900">
        {normalizedMessages.length === 0 ? (
          <div className="text-sm text-slate-500">Nog geen berichten.</div>
        ) : (
          normalizedMessages.map((message) => {
            const isOwn = message.senderRole === 'user';
            const isSystem = message.senderRole === 'system';
            const bubbleStyle = isSystem
              ? 'bg-blue-50 text-blue-900 border border-blue-100'
              : isOwn
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-800 dark:text-white border border-slate-200 dark:border-slate-700';
            const senderName = message.senderRole === 'moderator'
              ? 'Moderator'
              : message.senderLabel || (isOwn ? resolveDisplayName(authUser) : 'Artes Moderatie');
            return (
              <div
                key={message.id}
                className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm ${bubbleStyle}`}>
                  <div className="text-[11px] uppercase font-semibold mb-1 opacity-70">{senderName}</div>
                  <p>{message.text || message.message}</p>
                  <div className="mt-1 text-[10px] text-slate-400 text-right">
                    {formatTime(message.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-full border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm dark:bg-slate-800 dark:text-white"
            placeholder={canSend ? 'Typ een bericht...' : 'Wacht op reactie van moderatie...'}
            value={composerText}
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleSendMessage();
            }}
            disabled={!canSend}
          />
          <button
            type="button"
            onClick={handleSendMessage}
            className="bg-blue-600 text-white rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={!canSend}
          >
            Verstuur
          </button>
        </div>
        {!canSend && (
          <div className="mt-2 text-xs text-amber-600 flex items-center gap-2">
            <MessageCircle className="w-3 h-3" /> Je kunt pas weer een bericht sturen nadat de moderatie heeft gereageerd.
          </div>
        )}
        {sendError && (
          <div className="mt-2 text-xs text-amber-600 flex items-center gap-2">
            <MessageCircle className="w-3 h-3" /> {sendError}
          </div>
        )}
      </div>
    </div>
  );
}
