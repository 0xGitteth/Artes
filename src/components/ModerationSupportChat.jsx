import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { getFirebaseDbInstance } from '../firebase';
import SearchWithAutocomplete from './SearchWithAutocomplete';
import { normalizeSupportMessage } from '../utils/supportChat';

const MESSAGE_LIMIT = 80;

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const Avatar = ({ photoURL, name }) => {
  if (photoURL) {
    return <img src={photoURL} alt={name} className="h-9 w-9 rounded-full object-cover" />;
  }
  return (
    <div className="h-9 w-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-sm font-semibold">
      {name?.slice(0, 1)?.toUpperCase() || '?'}
    </div>
  );
};

const resolveThreadDisplay = (thread, userProfile) => {
  const displayName = userProfile?.displayName
    || thread?.userDisplayName
    || 'Onbekende gebruiker';
  const username = userProfile?.username || thread?.userUsername || '';
  const photoURL = userProfile?.photoURL || thread?.userPhotoURL || null;
  return { displayName, username, photoURL };
};

export default function ModerationSupportChat({ authUser, isModerator }) {
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [composerText, setComposerText] = useState('');
  const [searchValue, setSearchValue] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [userProfiles, setUserProfiles] = useState({});
  const moderationThreadsLogRef = useRef(null);

  useEffect(() => {
    const shouldStart = Boolean(authUser) && isModerator === true;
    if (import.meta.env.DEV) {
      const reason = !authUser
        ? 'skip: no auth user'
        : isModerator === null
          ? 'skip: moderator check pending'
          : isModerator === false
            ? 'skip: not a moderator'
            : 'start';
      if (moderationThreadsLogRef.current !== reason) {
        console.log(`[ModerationSupportChat] reviewCases listener ${reason}`);
        moderationThreadsLogRef.current = reason;
      }
    }
    if (!shouldStart) return undefined;
    const db = getFirebaseDbInstance();
    const q = query(
      collection(db, 'threads'),
      where('type', '==', 'support'),
      orderBy('lastMessageAt', 'desc'),
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setThreads(items);
        if (!activeThreadId && items.length > 0) {
          setActiveThreadId(items[0].id);
        }
      },
      (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', 'Moderation threads listener (reviewCases)'),
    );
  }, [authUser, isModerator, activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) {
      setActiveThread(null);
      return undefined;
    }
    const db = getFirebaseDbInstance();
    return onSnapshot(
      doc(db, 'threads', activeThreadId),
      (snapshot) => {
        if (!snapshot.exists()) {
          setActiveThread(null);
          return;
        }
        setActiveThread({ id: snapshot.id, ...snapshot.data() });
      },
      (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Moderation active thread listener threads/${activeThreadId}`),
    );
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return undefined;
    }
    const db = getFirebaseDbInstance();
    const messagesRef = collection(db, 'threads', activeThreadId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setMessages(list.slice(-MESSAGE_LIMIT));
      },
      (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Moderation thread messages listener threads/${activeThreadId}/messages`),
    );
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId || !isModerator) return;
    const db = getFirebaseDbInstance();
    const threadRef = doc(db, 'threads', activeThreadId);
    runTransaction(db, async (transaction) => {
      const snap = await transaction.get(threadRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if ((data?.unreadForModerator || 0) === 0) return;
      transaction.update(threadRef, {
        unreadForModerator: 0,
        updatedAt: serverTimestamp(),
      });
    }).catch(() => {});
  }, [activeThreadId, isModerator]);

  useEffect(() => {
    if (threads.length === 0) return;
    const db = getFirebaseDbInstance();
    const missingUids = threads
      .map((thread) => thread.userUid)
      .filter((uid) => uid && !userProfiles[uid]);
    if (missingUids.length === 0) return;
    Promise.all(missingUids.map((uid) => getDoc(doc(db, 'publicUsers', uid))))
      .then((snaps) => {
        const next = { ...userProfiles };
        snaps.forEach((snap, idx) => {
          const uid = missingUids[idx];
          if (snap.exists()) {
            next[uid] = snap.data();
          }
        });
        setUserProfiles(next);
      })
      .catch(() => {});
  }, [threads, userProfiles]);

  const filteredThreads = useMemo(() => {
    const normalized = searchValue.trim().toLowerCase();
    if (!normalized && !selectedUser?.uid) return threads;
    return threads.filter((thread) => {
      if (selectedUser?.uid && thread.userUid !== selectedUser.uid) return false;
      if (!normalized) return true;
      const profile = userProfiles[thread.userUid] || {};
      const displayName = (profile.displayName || thread.userDisplayName || '').toLowerCase();
      const username = (profile.username || thread.userUsername || '').toLowerCase();
      return displayName.includes(normalized) || username.includes(normalized);
    });
  }, [threads, searchValue, selectedUser, userProfiles]);

  const activeProfile = activeThread?.userUid ? userProfiles[activeThread.userUid] : null;
  const display = resolveThreadDisplay(activeThread, activeProfile);
  const normalizedMessages = useMemo(
    () => messages.map((message) => normalizeSupportMessage(message, activeThread)).filter(Boolean),
    [messages, activeThread],
  );

  const handleSendMessage = async () => {
    if (!authUser?.uid || !activeThread) return;
    const trimmed = composerText.trim();
    if (!trimmed) return;
    const db = getFirebaseDbInstance();
    const threadRef = doc(db, 'threads', activeThread.id);
    await runTransaction(db, async (transaction) => {
      const threadSnap = await transaction.get(threadRef);
      if (!threadSnap.exists()) return;
      const threadData = threadSnap.data();
      const messageRef = doc(collection(threadRef, 'messages'));
      transaction.set(messageRef, {
        text: trimmed,
        senderId: authUser.uid,
        senderUid: authUser.uid,
        senderRole: 'moderator',
        senderLabel: 'Moderator',
        type: 'text',
        createdAt: serverTimestamp(),
      });
      if (import.meta.env.DEV) {
        console.log('[ModerationSupportChat] Sent moderator message with senderRole: moderator');
      }
      transaction.update(threadRef, {
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: trimmed,
        userMessageAllowance: 1,
        userCanSend: true,
        unreadForUser: (threadData?.unreadForUser || 0) + 1,
        unreadForModerator: 0,
        updatedAt: serverTimestamp(),
      });
    });
    if (import.meta.env.DEV) {
      console.log('[ModerationSupportChat] Sent moderator message with senderRole: moderator, re-enabled user to send messages');
    }
    setComposerText('');
  };

  return (
    <div className="h-full flex flex-col md:flex-row">
      <aside className="md:w-80 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold dark:text-white">Berichten</h2>
          <p className="text-xs text-slate-500">Support chats</p>
          <div className="mt-3">
            <SearchWithAutocomplete
              value={searchValue}
              onChange={(val) => {
                setSearchValue(val);
                if (!val) setSelectedUser(null);
              }}
              onSelect={(user) => {
                setSelectedUser(user);
                setSearchValue(user.displayName || user.username || '');
                const match = threads.find((thread) => thread.userUid === user.uid);
                if (match) setActiveThreadId(match.id);
              }}
            />
          </div>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filteredThreads.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">Geen support chats gevonden.</div>
          ) : (
            filteredThreads.map((thread) => {
              const profile = userProfiles[thread.userUid];
              const info = resolveThreadDisplay(thread, profile);
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => setActiveThreadId(thread.id)}
                  className={`w-full text-left p-4 transition ${
                    thread.id === activeThreadId
                      ? 'bg-slate-50 dark:bg-slate-800'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar photoURL={info.photoURL} name={info.displayName} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm dark:text-white">{info.displayName}</p>
                        {thread.unreadForModerator > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-600 text-white">
                            {thread.unreadForModerator}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{info.username || 'onbekend'}</p>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                        {thread.lastMessagePreview || 'Nog geen berichten'}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {thread.lastMessageAt ? formatDate(thread.lastMessageAt) : ''}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900">
        {activeThread ? (
          <>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div>
                <h3 className="text-lg font-semibold dark:text-white">{display.displayName}</h3>
                <p className="text-xs text-slate-500">{display.username || 'onbekend'}</p>
              </div>
              <span className="text-xs text-slate-400">{formatDate(activeThread.lastMessageAt)}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {normalizedMessages.length === 0 ? (
                <div className="text-sm text-slate-500">Nog geen berichten.</div>
              ) : (
                normalizedMessages.map((message) => {
                  const isModeratorMessage = message.senderRole === 'moderator' || message.senderRole === 'system';
                  const bubbleStyle = message.senderRole === 'system'
                    ? 'bg-blue-50 text-blue-900 border border-blue-100'
                    : isModeratorMessage
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 dark:text-white border border-slate-200 dark:border-slate-700';
                  const senderName = message.senderRole === 'system'
                    ? 'ARTES MODERATIE'
                    : isModeratorMessage
                      ? 'Moderator'
                      : (message.senderLabel || display.displayName);
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isModeratorMessage ? 'justify-end' : 'justify-start'}`}
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
                  placeholder="Typ een antwoord..."
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleSendMessage();
                  }}
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className="bg-blue-600 text-white rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2"
                >
                  <Send className="w-4 h-4" /> Verstuur
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <MessageCircle className="w-10 h-10 mb-3" />
            <p>Selecteer een support chat om te starten.</p>
          </div>
        )}
      </section>
    </div>
  );
}
