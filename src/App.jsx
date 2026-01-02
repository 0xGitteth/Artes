import React, { useEffect, useMemo, useState } from 'react';
import {
  initAuth,
  observeAuth,
  registerWithEmail,
  loginWithEmail,
  logout,
  createUserProfile,
  fetchUserProfile,
  subscribeToProfile,
  updateUserProfile,
  addPost,
  subscribeToPosts,
  toggleLike,
  subscribeToLikes,
  subscribeToComments,
} from './firebase';
import {
  Image as ImageIcon,
  Settings as SettingsIcon,
  Plus,
  User,
  Edit3,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';
import { Button } from './components/ui';
import AuthPanel from './components/AuthPanel';
import UploadModal from './components/UploadModal';
import EditProfileModal from './components/EditProfileModal';
import SettingsModal from './components/SettingsModal';
import PostCard from './components/PostCard';
import PhotoDetailModal from './components/PhotoDetailModal';
import ChatStub from './components/ChatStub';
import './App.css';
import './index.css';

const initialProfile = (user) => ({
  displayName: user?.displayName || 'Nieuw lid',
  bio: '',
  roles: ['fan'],
  website: '',
  darkMode: false,
  sensitivePreference: 'cover',
});

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [likesMap, setLikesMap] = useState({});
  const [commentCounts, setCommentCounts] = useState({});
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    let unsub = null;
    const bootstrap = async () => {
      try {
        await initAuth();
        unsub = observeAuth(async (firebaseUser) => {
          setUser(firebaseUser);
          if (firebaseUser) {
            const profileSnap = await fetchUserProfile(firebaseUser.uid);
            if (!profileSnap.exists()) {
              await createUserProfile(firebaseUser.uid, initialProfile(firebaseUser));
            }
            subscribeToProfile(firebaseUser.uid, (docSnap) => {
              const data = docSnap.data();
              setProfile(data);
              const storedDark = data?.darkMode ?? JSON.parse(localStorage.getItem('darkMode') || 'false');
              setDarkMode(storedDark);
            });
          } else {
            setProfile(null);
          }
        });
      } finally {
        setReady(true);
      }
    };

    bootstrap();
    return () => unsub && unsub();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (user?.uid) updateUserProfile(user.uid, { darkMode });
  }, [darkMode, user?.uid]);

  useEffect(() => {
    const unsubPosts = subscribeToPosts((snapshot) => {
      const nextPosts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPosts(nextPosts);
    });
    return () => unsubPosts();
  }, []);

  useEffect(() => {
    if (!posts.length) return undefined;
    const unsubs = posts.map((post) =>
      subscribeToLikes(post.id, (snap) => {
        setLikesMap((prev) => ({
          ...prev,
          [post.id]: {
            count: snap.size,
            liked: !!snap.docs.find((d) => d.id === user?.uid),
          },
        }));
      })
    );
    const commentUnsubs = posts.map((post) =>
      subscribeToComments(post.id, (snap) => {
        setCommentCounts((prev) => ({ ...prev, [post.id]: snap.size }));
      })
    );
    return () => {
      unsubs.forEach((fn) => fn && fn());
      commentUnsubs.forEach((fn) => fn && fn());
    };
  }, [posts, user?.uid]);

  const filteredPosts = useMemo(() => {
    const preference = profile?.sensitivePreference || 'cover';
    return posts
      .filter((p) => (preference === 'block' && p.sensitive ? false : true))
      .map((p) => ({
        ...p,
        likes: likesMap[p.id]?.count || 0,
        liked: likesMap[p.id]?.liked || false,
        commentsCount: commentCounts[p.id] || 0,
        sensitive: preference === 'show' ? false : p.sensitive,
      }));
  }, [posts, likesMap, commentCounts, profile?.sensitivePreference]);

  const handleRegister = async (email, password, displayName) => {
    try {
      setError(null);
      const newUser = await registerWithEmail(email, password, displayName);
      await createUserProfile(newUser.uid, initialProfile({ ...newUser, displayName }));
    } catch (err) {
      setError(err.message || 'Registreren mislukt');
      throw err;
    }
  };

  const handleLogin = async (email, password) => {
    try {
      setError(null);
      await loginWithEmail(email, password);
    } catch (err) {
      setError(err.message || 'Inloggen mislukt');
      throw err;
    }
  };

  const handlePublish = async (payload) => {
    if (!user) throw new Error('Je moet ingelogd zijn');
    await addPost({
      ...payload,
      authorId: user.uid,
      authorName: profile?.displayName || user.email,
      createdBy: user.uid,
    });
  };

  const handleLike = async (postId) => {
    if (!user) return;
    await toggleLike(postId, user.uid);
  };

  const toggleDark = () => setDarkMode((d) => !d);

  const updatePreference = async (pref) => {
    if (!user) return;
    await updateUserProfile(user.uid, { sensitivePreference: pref });
  };

  const saveProfile = async (data) => {
    if (!user) return;
    await updateUserProfile(user.uid, data);
  };

  if (!ready) return null;

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-6">
        <AuthPanel onLogin={handleLogin} onRegister={handleRegister} error={error} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
      <header className="sticky top-0 z-40 backdrop-blur bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold">
              EX
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Exhibit</p>
              <h1 className="text-xl font-semibold">Collaborative gallery</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => setShowEditProfile(true)}>
              <Edit3 size={16} /> Profiel
            </Button>
            <Button variant="secondary" onClick={() => setShowSettings(true)}>
              <SettingsIcon size={16} /> Settings
            </Button>
            <Button onClick={() => setShowUpload(true)}>
              <Plus size={16} /> Upload
            </Button>
            <Button variant="ghost" onClick={toggleDark}>
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button variant="ghost" onClick={logout}>
              <LogOut size={16} />
            </Button>
            <div className="flex items-center gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-2xl">
              <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold">
                {profile?.displayName?.[0] || 'U'}
              </div>
              <div>
                <p className="text-sm font-semibold">{profile?.displayName || user.email}</p>
                <p className="text-xs text-slate-500">{profile?.roles?.join(', ') || 'community'}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        <div className="grid md:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Gallery</p>
                <h2 className="text-2xl font-semibold">Recente uploads</h2>
              </div>
              <Button variant="secondary" onClick={() => setShowUpload(true)}>
                <ImageIcon size={16} /> Nieuwe post
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {filteredPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onClick={() => setSelectedPost(post)}
                  onToggleLike={() => handleLike(post.id)}
                  liked={likesMap[post.id]?.liked}
                />
              ))}
              {!filteredPosts.length && (
                <div className="p-6 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 text-center text-slate-500">
                  Nog geen posts. Start met een upload!
                </div>
              )}
            </div>
          </section>
          <aside className="space-y-4">
            <div className="p-6 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-lg shadow-slate-900/10">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-3 rounded-2xl bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200">
                  <User />
                </div>
                <div>
                  <p className="text-sm uppercase tracking-[0.08em] text-slate-400">Profiel</p>
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Welkom terug</h3>
                </div>
              </div>
              <p className="text-slate-600 dark:text-slate-300 mb-3">Bewerk je profiel, switch dark mode en beheer gevoelige content voorkeuren.</p>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setShowEditProfile(true)} className="flex-1 justify-center">
                  <Edit3 size={16} /> Bewerk
                </Button>
                <Button variant="secondary" onClick={() => setShowSettings(true)} className="flex-1 justify-center">
                  <SettingsIcon size={16} /> Voorkeuren
                </Button>
              </div>
            </div>
            <ChatStub />
          </aside>
        </div>
      </main>

      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onPublish={handlePublish} />}
      {showEditProfile && (
        <EditProfileModal profile={profile} onSave={saveProfile} onClose={() => setShowEditProfile(false)} />
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          darkMode={darkMode}
          onToggleDark={toggleDark}
          preference={profile?.sensitivePreference || 'cover'}
          onPreferenceChange={updatePreference}
          onLogout={logout}
        />
      )}
      {selectedPost && (
        <PhotoDetailModal post={selectedPost} onClose={() => setSelectedPost(null)} currentUser={user} />
      )}
    </div>
  );
}

