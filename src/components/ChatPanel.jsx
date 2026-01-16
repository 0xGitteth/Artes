import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Plus, Search, X } from 'lucide-react';
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { getFirebaseDbInstance } from '../firebase';

const MESSAGE_LIMIT = 50;

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
};

const normalizeQuery = (value) => value.trim().toLowerCase();

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

function NewChatModal({ authUser, functionsBase, onClose, onThreadReady }) {
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const normalizedQuery = useMemo(() => normalizeQuery(queryText), [queryText]);

  useEffect(() => {
    if (!normalizedQuery) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const db = getFirebaseDbInstance();
      const publicUsersRef = collection(db, 'publicUsers');
      const searchTerm = normalizedQuery.startsWith('@') ? normalizedQuery.slice(1) : normalizedQuery;
      if (!searchTerm) {
        setResults([]);
        setLoading(false);
        return;
      }

      const usernameQuery = query(
        publicUsersRef,
        where('username', '>=', searchTerm),
        where('username', '<', `${searchTerm}\uf8ff`),
        orderBy('username'),
        limit(10),
      );

      const displayNameQuery = query(
        publicUsersRef,
        where('displayNameLower', '>=', searchTerm),
        where('displayNameLower', '<', `${searchTerm}\uf8ff`),
        orderBy('displayNameLower'),
        limit(10),
      );

      try {
        const [usernameSnap, displayNameSnap] = await Promise.all([
          getDocs(usernameQuery),
          normalizedQuery.startsWith('@') ? Promise.resolve(null) : getDocs(displayNameQuery),
        ]);
        const merged = new Map();
        usernameSnap?.docs.forEach((docSnap) => {
          merged.set(docSnap.id, { uid: docSnap.id, matchType: 'username', ...docSnap.data() });
        });
        displayNameSnap?.docs.forEach((docSnap) => {
          if (merged.has(docSnap.id)) return;
          merged.set(docSnap.id, { uid: docSnap.id, matchType: 'display', ...docSnap.data() });
        });
        const sorted = Array.from(merged.values()).sort((a, b) => {
          if (a.matchType === b.matchType) return 0;
          return a.matchType === 'username' ? -1 : 1;
        });
        if (active) setResults(sorted);
      } catch (error) {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [normalizedQuery]);

  useEffect(() => {
  if (!authUser?.uid) return;

  const run = async () => {
    const token = await authUser.getIdToken();
    await fetch(import.meta.env.VITE_FUNCTIONS_BASE_URL + "/ensureSupportThread", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  };

  run().catch(() => {});
}, [authUser]);

  const handleStartChat = async () => {
    if (!selectedUser || selectedUser.uid === authUser.uid) return;
    if (!functionsBase) return;
    const token = await authUser.getIdToken();
    const response = await fetch(`${functionsBase}/createDmThread`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recipientUid: selectedUser.uid,
      }),
    });
    if (!response.ok) return;
    const data = await response.json();
    if (data?.threadId) {
      onThreadReady(data.threadId);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold dark:text-white">Nieuwe chat</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Zoek op @username of naam.</p>
          </div>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3.5 w-4 h-4 text-slate-400" />
            <input
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              placeholder="Zoek op @username of naam"
              value={queryText}
              onChange={(event) => {
                setQueryText(event.target.value);
                setSelectedUser(null);
              }}
            />
          </div>

          {loading && (
            <div className="text-sm text-slate-500">Zoeken...</div>
          )}

          {!loading && results.length > 0 && !selectedUser && (
            <div className="space-y-2">
              {results.map((user) => (
                <button
                  key={user.uid}
                  type="button"
                  onClick={() => setSelectedUser(user)}
                  className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  <Avatar photoURL={user.photoURL} name={user.displayName || user.username} />
                  <div className="text-left">
                    <p className="text-sm font-semibold dark:text-white">{user.displayName || 'Onbekend'}</p>
                    <p className="text-xs text-slate-500">@{user.username}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && normalizedQuery && results.length === 0 && (
            <div className="text-sm text-slate-500">Geen gebruikers gevonden.</div>
          )}

          {selectedUser && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Avatar photoURL={selectedUser.photoURL} name={selectedUser.displayName || selectedUser.username} />
                <div>
                  <p className="text-sm font-semibold dark:text-white">{selectedUser.displayName || 'Onbekend'}</p>
                  <p className="text-xs text-slate-500">@{selectedUser.username}</p>
                </div>
              </div>
              {selectedUser.uid === authUser.uid ? (
                <p className="text-xs text-amber-600">Je kunt geen chat met jezelf starten.</p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleStartChat}
                    disabled={!functionsBase}
                    className="w-full bg-blue-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-blue-700"
                  >
                    Start chat
                  </button>
                  {!functionsBase && (
                    <p className="text-xs text-red-500 mt-2">Chat is nog niet beschikbaar zonder backend.</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel({ authUser, functionsBase, initialThreadId }) {
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [composerText, setComposerText] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [sendError, setSendError] = useState(null);

  useEffect(() => {
    if (!initialThreadId) return;
    setActiveThreadId(initialThreadId);
  }, [initialThreadId]);

  useEffect(() => {
    if (!authUser?.uid) return undefined;
    const db = getFirebaseDbInstance();
    const threadIndexRef = collection(db, 'users', authUser.uid, 'threadIndex');
    const q = query(threadIndexRef, orderBy('pinned', 'desc'), orderBy('lastMessageAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      setThreads(items);
      if (!activeThreadId && items.length > 0) {
        setActiveThreadId(items[0].threadId || items[0].id);
      }
    });
  }, [authUser?.uid, activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) {
      setActiveThread(null);
      return undefined;
    }
    const db = getFirebaseDbInstance();
    return onSnapshot(doc(db, 'threads', activeThreadId), (snapshot) => {
      if (!snapshot.exists()) {
        setActiveThread(null);
        return;
      }
      setActiveThread({ id: snapshot.id, ...snapshot.data() });
    });
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return undefined;
    }
    const db = getFirebaseDbInstance();
    const messagesRef = collection(db, 'threads', activeThreadId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'), limit(MESSAGE_LIMIT));
    return onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });
  }, [activeThreadId]);

  const activeThreadIndex = useMemo(() => {
    if (!activeThreadId) return null;
    return threads.find((thread) => thread.threadId === activeThreadId || thread.id === activeThreadId) || null;
  }, [threads, activeThreadId]);

  const canSendSupport = Boolean(activeThread?.userCanSend || activeThread?.userMessageAllowance > 0);

  const handleSendMessage = async () => {
    if (!authUser?.uid || !activeThread) return;
    const trimmed = composerText.trim();
    if (!trimmed || !functionsBase) return;
    if (activeThread.type === 'support' && !canSendSupport) {
      setSendError('Je hebt al een bericht gestuurd. Je kunt weer een nieuw bericht sturen zodra moderatie heeft gereageerd. We reageren binnen 3 werkdagen.');
      return;
    }
    setSendError(null);
    const token = await authUser.getIdToken();
    const endpoint = activeThread.type === 'support' ? 'sendSupportMessage' : 'sendDmMessage';
    const response = await fetch(`${functionsBase}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        threadId: activeThread.id,
        text: trimmed,
      }),
    });
    if (response.ok) {
      setComposerText('');
    }
  };

  return (
    <div className="h-full flex flex-col md:flex-row">
      <aside className="md:w-80 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold dark:text-white">Chat</h2>
            <p className="text-xs text-slate-500">Berichten & moderatie</p>
          </div>
          <button
            type="button"
            onClick={() => setShowNewChat(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
          >
            <Plus className="w-4 h-4" /> Nieuwe chat
          </button>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {threads.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">Nog geen gesprekken.</div>
          ) : (
            threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => setActiveThreadId(thread.threadId || thread.id)}
                className={`w-full text-left p-4 transition ${
                  (thread.threadId || thread.id) === activeThreadId
                    ? 'bg-slate-50 dark:bg-slate-800'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm dark:text-white">{thread.displayTitle || 'Chat'}</p>
                    {(thread.threadType === 'support'
                      || (thread.threadId || thread.id || '').startsWith('moderation_')) && (
                      <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                        Support
                      </span>
                    )}
                  </div>
                  {thread.pinned && (
                    <span className="text-[10px] uppercase text-blue-600 font-semibold">Vastgezet</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {thread.lastMessageAt ? formatTime(thread.lastMessageAt) : 'Nog geen berichten'}
                </p>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900">
        {activeThread ? (
          <>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div>
                <h3 className="text-lg font-semibold dark:text-white">
                  {activeThreadIndex?.displayTitle || activeThread.title || 'Chat'}
                </h3>
                {activeThread.type === 'system' && (
                  <p className="text-xs text-slate-500">Systeemupdates, alleen lezen.</p>
                )}
              </div>
              {activeThread.type === 'system' && (
                <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-700">Systeem</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {messages.length === 0 ? (
                <div className="text-sm text-slate-500">Nog geen berichten.</div>
              ) : (
                messages.map((message) => {
                  const isOwn = message.senderUid === authUser.uid;
                  const isSystem = message.senderUid === 'system' || message.type === 'moderation_decision';
                  const bodyText = message.text || message.message || '';
                  return (
                    <div
                      key={message.id}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                          isSystem
                            ? 'bg-blue-50 text-blue-900 border border-blue-100'
                            : isOwn
                              ? 'bg-blue-600 text-white'
                              : 'bg-white dark:bg-slate-800 dark:text-white border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {message.type === 'moderation_decision' && (
                          <div className="text-[10px] uppercase font-semibold text-blue-700 mb-1">Moderatie</div>
                        )}
                        <p>{bodyText}</p>
                        {message.metadata?.reasons?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {message.metadata.reasons.map((reason) => (
                              <span
                                key={reason}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
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
              {activeThread.type === 'dm' || activeThread.type === 'support' ? (
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-full border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm dark:bg-slate-800 dark:text-white"
                    placeholder={activeThread.type === 'support' && !canSendSupport ? 'Wacht op reactie van moderatie...' : 'Typ een bericht...'}
                    value={composerText}
                    onChange={(event) => setComposerText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleSendMessage();
                    }}
                    disabled={activeThread.type === 'support' && !canSendSupport}
                  />
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    className="bg-blue-600 text-white rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    disabled={activeThread.type === 'support' && !canSendSupport}
                  >
                    Verstuur
                  </button>
                </div>
              ) : (
                <div className="text-xs text-slate-500 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" /> Dit gesprek is alleen lezen.
                </div>
              )}
              {activeThread.type === 'support' && !canSendSupport && (
                <div className="mt-3 text-xs text-amber-600 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Je hebt al een bericht gestuurd. Je kunt weer een nieuw bericht sturen zodra moderatie heeft gereageerd. We reageren binnen 3 werkdagen.
                </div>
              )}
              {sendError && (
                <div className="mt-3 text-xs text-amber-600 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4" /> {sendError}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <MessageCircle className="w-10 h-10 mb-3" />
            <p>Selecteer een gesprek of start een nieuwe chat.</p>
          </div>
        )}
      </section>

      {showNewChat && (
        <NewChatModal
          authUser={authUser}
          functionsBase={functionsBase}
          onClose={() => setShowNewChat(false)}
          onThreadReady={(threadId) => setActiveThreadId(threadId)}
        />
      )}
    </div>
  );
}
