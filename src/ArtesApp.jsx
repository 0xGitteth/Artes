import React, { useState, useEffect, useMemo } from 'react';
import {
  Image as ImageIcon, Search, Users, Plus, Hand, Cloud, Bookmark,
  Settings, LogOut, Shield, Camera, Handshake, ChevronLeft,
  X, AlertTriangle, AlertOctagon, UserPlus, Link as LinkIcon,
  Maximize2, Share2, MoreHorizontal, LayoutGrid, User, CheckCircle,
  Briefcase, Building2, Star, Edit3, Moon, Sun, ArrowRight, Info, ExternalLink, Trash2, MapPin, Bell, Lock, HelpCircle, Mail, Globe, Loader2
} from 'lucide-react';
import {
  createProfile,
  fetchUserIndex,
  publishPost,
  seedDemoContent,
  subscribeToPosts,
  subscribeToUsers,
  updateProfile as updateProfileData,
} from './services/firebaseClient';
import {
  ensureUserProfile,
  fetchUserProfile,
  handleAuthRedirectResult,
  initAuth,
  loginWithEmail,
  logout as firebaseLogout,
  observeAuth,
  registerWithEmail,
  signInWithApple,
  signInWithGoogle,
  updateUserProfile,
} from './firebase';

// --- Constants & Styling ---

const ROLES = [
  { id: 'photographer', label: 'Fotograaf', desc: 'Deel shoots, lichtopstellingen en vind modellen.' },
  { id: 'model', label: 'Model', desc: 'Bouw je portfolio en vind veilige samenwerkingen.' },
  { id: 'artist', label: 'Artist', desc: 'Deel kunstzinnige projecten.' },
  { id: 'stylist', label: 'Stylist', desc: 'Laat je styling werk zien.' },
  { id: 'mua', label: 'MUA', desc: 'Visagie en special effects.' },
  { id: 'hair', label: 'Hairstylist', desc: 'Haarstyling en verzorging.' },
  { id: 'art_director', label: 'Art Director', desc: 'Conceptontwikkeling en visuele regie.' },
  { id: 'retoucher', label: 'Retoucher', desc: 'Nabewerking en high-end retouching.' },
  { id: 'videographer', label: 'Videograaf', desc: 'Video producties en reels.' },
  { id: 'producer', label: 'Producer', desc: 'Productie en planning van shoots.' },
  { id: 'assistent', label: 'Assistent', desc: 'Ondersteuning op de set.' },
  { id: 'agency', label: 'Agency', desc: 'Vertegenwoordig talent.' },
  { id: 'company', label: 'Company', desc: 'Merk, studio of bedrijf.' },
  { id: 'fan', label: 'Fan', desc: 'Volg je favoriete makers en bewaar inspiratie.' },
];

const THEME_STYLES = {
  'Nature': 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  'Landscape': 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800',
  'Wildlife': 'bg-lime-100 text-lime-800 border-lime-200 dark:bg-lime-900/30 dark:text-lime-300 dark:border-lime-800',
  'Macro': 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800',
  'Boudoir': 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800',
  'Art Nude': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
  'Maternity': 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800',
  'Glamour': 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-900/30 dark:text-fuchsia-300 dark:border-fuchsia-800',
  'Beauty': 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-900/20 dark:text-pink-200 dark:border-pink-800',
  'Travel': 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800',
  'Product': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
  'Corporate': 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
  'Automotive': 'bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-300 dark:border-cyan-800',
  'Fashion': 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  'Conceptual': 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
  'Editorial': 'bg-purple-50 text-purple-900 border-purple-200 dark:bg-purple-900/20 dark:text-purple-200 dark:border-purple-800',
  'Abstract': 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-200 dark:bg-fuchsia-900/20 dark:text-fuchsia-200 dark:border-fuchsia-800',
  'Surreal': 'bg-indigo-50 text-indigo-900 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-800',
  'Vintage': 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
  'Food': 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800',
  'Wedding': 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-200 dark:border-yellow-800',
  'Family': 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-200 dark:border-orange-800',
  'Portrait': 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-700',
  'Black & White': 'bg-slate-800 text-white border-slate-600 dark:bg-white dark:text-slate-900',
  'Urban': 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-700',
  'Street': 'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:border-cyan-700',
  'Architecture': 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-900/20 dark:text-sky-200 dark:border-sky-700',
  'Minimalist': 'bg-white text-blue-900 border-blue-200 dark:bg-slate-950 dark:text-blue-100 dark:border-blue-900',
};

const getThemeStyle = (theme) => {
  return THEME_STYLES[theme] || 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
};

const THEMES = Object.keys(THEME_STYLES);
const palette = ['#8B5CF6', '#EC4899', '#10B981', '#06B6D4', '#F59E0B', '#3B82F6', '#F97316'];
const themeColor = (themeLabel, fallbackIndex = 0) => {
  if (!themeLabel) return palette[fallbackIndex % palette.length];
  const hash = themeLabel.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return palette[Math.abs(hash) % palette.length];
};
const tintTowardWhite = (hexColor, intensity = 0.9) => {
  if (!hexColor) return '#ffffff';
  const normalized = hexColor.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const blend = (channel) => Math.round(channel + (255 - channel) * intensity);
  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
};

const COMMUNITIES = [
  { id: 'safety', title: 'Veiligheid & Consent', icon: Shield, members: 1240, desc: 'Over grenzen, afspraken en veilig werken.' },
  { id: 'network', title: 'Netwerk & Collabs', icon: Handshake, members: 3500, desc: 'Vind je team voor de volgende shoot.' },
  { id: 'tech', title: 'Techniek & Gear', icon: Camera, members: 2100, desc: "Alles over licht, camera's en lenzen." },
];

const TRIGGERS = [
  { id: 'nudityErotic', label: 'Naakt (erotisch)' },
  { id: 'explicit18', label: 'Expliciet 18+' },
  { id: 'kinkBdsm', label: 'Kink / BDSM' },
  { id: 'breathRestriction', label: 'Ademrestrictie' },
  { id: 'bloodInjury', label: 'Bloed / verwonding' },
  { id: 'horrorScare', label: 'Horror / schrik' },
  { id: 'needlesInjections', label: 'Naalden / injecties' },
  { id: 'spidersInsects', label: 'Spinnen / insecten' },
];

const TRIGGER_PREFERENCE_OPTIONS = [
  { id: 'show', label: 'Show', desc: 'Direct tonen' },
  { id: 'cover', label: 'Cover', desc: 'Cover overlay tonen' },
  { id: 'hideFeed', label: 'Hide feed', desc: 'Post verbergen in de feed' },
];

const buildDefaultAvatar = (seed) =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed || 'artes')}`;

const normalizeTriggerPreferences = (triggerVisibility = {}) => {
  const normalized = { ...triggerVisibility };
  TRIGGERS.forEach((trigger) => {
    const stored = triggerVisibility?.[trigger.id];
    normalized[trigger.id] = TRIGGER_PREFERENCE_OPTIONS.some((opt) => opt.id === stored) ? stored : 'cover';
  });
  return normalized;
};

const resolveTriggerKey = (trigger) => {
  const match = TRIGGERS.find((item) => item.id === trigger || item.label === trigger);
  return match ? match.id : trigger;
};

const getPostTriggerKeys = (post) => {
  const triggers = [...(post.appliedTriggers || []), ...(post.makerTags || []), ...(post.triggers || [])];
  const resolved = triggers.map(resolveTriggerKey);
  return Array.from(new Set(resolved));
};

const getPostContentPreference = (post, triggerVisibility) => {
  const triggers = getPostTriggerKeys(post);
  if (!triggers.length) return 'show';
  const preferences = triggers.map((trigger) => triggerVisibility?.[trigger] || 'cover');
  if (preferences.includes('hideFeed')) return 'hideFeed';
  if (preferences.includes('cover')) return 'cover';
  return 'show';
};

const normalizeProfileData = (profileData = {}, fallbackSeed = 'artes') => {
  const seed = profileData?.uid || profileData?.displayName || fallbackSeed;
  const roles = Array.isArray(profileData?.roles) && profileData.roles.length ? profileData.roles : ['fan'];
  const themes = Array.isArray(profileData?.themes) && profileData.themes.length ? profileData.themes : ['General'];
  const triggerVisibility = normalizeTriggerPreferences(profileData?.preferences?.triggerVisibility);
  const themePreference = profileData?.preferences?.theme || 'light';

  return {
    ...profileData,
    uid: profileData?.uid ?? null,
    displayName: profileData?.displayName || 'Onbekende maker',
    bio: profileData?.bio || 'Nog geen bio toegevoegd.',
    roles,
    themes,
    avatar: profileData?.avatar || buildDefaultAvatar(seed),
    linkedAgencyName: profileData?.linkedAgencyName ?? null,
    linkedCompanyName: profileData?.linkedCompanyName ?? null,
    linkedAgencyLink: profileData?.linkedAgencyLink ?? '',
    linkedCompanyLink: profileData?.linkedCompanyLink ?? '',
    preferences: {
      ...profileData?.preferences,
      triggerVisibility,
      theme: themePreference,
    },
  };
};


// --- SEED DATA ---
const SEED_USERS = [
  { uid: 'user_jax', displayName: 'Jax Models', bio: 'International Model Agency based in Amsterdam.', roles: ['agency', 'company'], avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=200', themes: ['Fashion', 'Editorial'] },
  { uid: 'user_sophie', displayName: 'Sophie de Vries', bio: 'Freelance model met liefde voor vintage.', roles: ['model', 'stylist'], linkedAgencyName: 'Jax Models', linkedAgencyLink: '', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200', themes: ['Vintage', 'Fashion'] },
  { uid: 'user_marcus', displayName: 'Marcus Lens', bio: 'Capture the silence.', roles: ['photographer', 'art_director'], avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=200', themes: ['Architecture', 'Street'] },
  { uid: 'user_nina', displayName: 'Nina Artistry', bio: 'MUA specialized in SFX.', roles: ['mua', 'artist'], avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=200', themes: ['Beauty', 'Conceptual'] },
  { uid: 'user_kai', displayName: 'Kai Sato', bio: 'Nature documentarian.', roles: ['photographer', 'fan'], avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=200', themes: ['Nature', 'Landscape'] },
  { uid: 'user_elena', displayName: 'Elena Visuals', bio: 'Conceptual photographer.', roles: ['photographer', 'retoucher'], avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=200', themes: ['Conceptual', 'Black & White'] },
  { uid: 'user_luna', displayName: 'Luna Shade', bio: 'Dancer & Art Model.', roles: ['model'], linkedAgencyName: 'Jax Models', avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=200', themes: ['Art Nude', 'Boudoir'] },
  { uid: 'user_tom', displayName: 'Tom Analog', bio: '35mm & 120mm only.', roles: ['photographer'], avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&q=80&w=200', themes: ['Vintage', 'Street'] }
];

const SEED_POSTS = [
  { id: 'p1', title: 'Neon Dreams', description: 'Tokyo nights.', imageUrl: 'https://images.unsplash.com/photo-1496442226666-8d4a0e62e6e9?auto=format&fit=crop&q=80&w=800', authorId: 'user_marcus', authorName: 'Marcus Lens', authorRole: 'photographer', styles: ['Street', 'Urban'], likes: 342 },
  { id: 'p2', title: 'Vintage Soul', description: 'Testing 85mm. Credits to Tom for the lens loan!', imageUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&q=80&w=800', authorId: 'user_sophie', authorName: 'Sophie de Vries', authorRole: 'model', styles: ['Fashion', 'Vintage'], credits: [{role: 'photographer', name: 'Tom Analog', uid: 'user_tom'}, {role: 'mua', name: 'Nina Artistry', uid: 'user_nina'}], likes: 890 },
  { id: 'p3', title: 'Golden Hour', description: 'Pure nature.', imageUrl: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?auto=format&fit=crop&q=80&w=800', authorId: 'user_kai', authorName: 'Kai Sato', authorRole: 'photographer', styles: ['Portrait', 'Nature'], likes: 120 },
  { id: 'p4', title: 'Abstract Form', description: 'Shadows.', imageUrl: 'https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?auto=format&fit=crop&q=80&w=800', authorId: 'user_elena', authorName: 'Elena Visuals', authorRole: 'artist', styles: ['Black & White', 'Abstract', 'Art Nude'], triggers: ['Naakt (Artistiek)'], sensitive: true, likes: 560 },
  { id: 'p5', title: 'Red Lips', description: 'Editorial MUA.', imageUrl: 'https://images.unsplash.com/photo-1512413914633-b5043f4041ea?auto=format&fit=crop&q=80&w=800', authorId: 'user_nina', authorName: 'Nina Artistry', authorRole: 'mua', styles: ['Beauty', 'Editorial'], credits: [{role: 'model', name: 'Luna Shade', uid: 'user_luna'}], likes: 230 },
  { id: 'p6', title: 'Concrete', description: 'Look up.', imageUrl: 'https://images.unsplash.com/photo-1470058869958-2a77ade41c02?auto=format&fit=crop&q=80&w=800', authorId: 'user_marcus', authorName: 'Marcus Lens', authorRole: 'photographer', styles: ['Architecture', 'Minimalist'], likes: 88 },
  { id: 'p8', title: 'Shadow Challenge', description: 'Challenge submission.', imageUrl: 'https://images.unsplash.com/photo-1508186225823-0963cf9ab0de?auto=format&fit=crop&q=80&w=800', authorId: 'user_elena', authorName: 'Elena Visuals', authorRole: 'photographer', styles: ['Black & White', 'Fine Art'], isChallenge: true, likes: 1200 },
  { id: 'p9', title: 'The Gaze', description: 'Intense.', imageUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=800', authorId: 'user_tom', authorName: 'Tom Analog', authorRole: 'photographer', styles: ['Portrait', 'Vintage'], credits: [{role: 'model', name: 'Sophie de Vries', uid: 'user_sophie'}], likes: 310 },
  { id: 'p10', title: 'Soft Light', description: 'Boudoir.', imageUrl: 'https://images.unsplash.com/photo-1550525811-e5869dd03032?auto=format&fit=crop&q=80&w=800', authorId: 'user_luna', authorName: 'Luna Shade', authorRole: 'model', styles: ['Boudoir', 'Portrait'], sensitive: true, triggers: ['Naakt (Artistiek)'], likes: 670 },
  { id: 'p11', title: 'Mountain', description: 'Thin air.', imageUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&q=80&w=800', authorId: 'user_kai', authorName: 'Kai Sato', authorRole: 'photographer', styles: ['Landscape', 'Travel'], likes: 899 },
  { id: 'p12', title: 'Avant Garde', description: 'Pushing boundaries.', imageUrl: 'https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?auto=format&fit=crop&q=80&w=800', authorId: 'user_nina', authorName: 'Nina Artistry', authorRole: 'artist', styles: ['Fashion', 'Conceptual'], likes: 400 },
];

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, asChild = false }) => {
  const baseStyle = "px-6 py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 cursor-pointer";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed",
    secondary: "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700",
    ghost: "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400",
    outline: "border border-white/40 bg-white/10 text-white hover:bg-white/20 backdrop-blur-md", 
  };
  
  if (asChild) return <span className={`${baseStyle} ${variants[variant]} ${className}`}>{children}</span>;
  return <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`} disabled={disabled}>{children}</button>;
};

const Badge = ({ children, colorClass, onClick, className = '' }) => (
  <span 
    onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
    className={`px-3 py-1 rounded-full text-xs font-semibold border ${onClick ? 'cursor-pointer hover:opacity-80' : ''} ${colorClass} ${className}`}
  >
    {children}
  </span>
);

const Input = ({ label, type = "text", placeholder, value, onChange, error }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
    <input
      type={type}
      className={`w-full px-4 py-3 rounded-xl border bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all ${error ? 'border-red-500 focus:ring-red-400' : 'border-slate-200 dark:border-slate-700'}`}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
    {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
  </div>
);

// --- Main App ---

export default function ArtesApp() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState('loading');
  const [authUser, setAuthUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authPending, setAuthPending] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showTour, setShowTour] = useState(false);
  
  // Modals & States
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [quickProfileId, setQuickProfileId] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [shadowProfileName, setShadowProfileName] = useState(null);

  // Data
  const [posts, setPosts] = useState([]);
  const [users, setUsers] = useState([]);

  // Seeding
  useEffect(() => {
     const checkAndSeed = async () => {
        if (!user) return;
        try {
            await seedDemoContent(SEED_USERS, SEED_POSTS);
        } catch (e) { console.error('Seeding error', e); }
     };
     checkAndSeed();
  }, [user]);

  // Auth & Profile Listener
  useEffect(() => {
    let active = true;
    initAuth().catch((error) => console.error('Auth init error', error));
    handleAuthRedirectResult().catch((error) => console.error('Auth redirect error', error));

    const unsubscribe = observeAuth(async (u) => {
      if (!active) return;
      setUser(u);
      setAuthUser(u);
      if (!u) {
        setProfile(null);
        setView('login');
        return;
      }
      try {
        const snapshot = await fetchUserProfile(u.uid);
        const profileData = snapshot?.exists() ? snapshot.data() : await ensureUserProfile(u);
        const normalized = normalizeProfileData(profileData, u.uid);
        setProfile(normalized);
        const hasRoles = Array.isArray(profileData?.roles) && profileData.roles.length > 0;
        setView(hasRoles ? 'gallery' : 'onboarding');
      } catch (e) {
        console.error('Failed to load profile', e);
        setView('onboarding');
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile?.preferences?.theme) return;
    setDarkMode(profile.preferences.theme === 'dark');
  }, [profile?.preferences?.theme]);

  // Data Listeners
  useEffect(() => {
     if (!user) return;
     const unsubPosts = subscribeToPosts(setPosts);
     const unsubUsers = subscribeToUsers(setUsers);
     return () => { unsubPosts(); unsubUsers(); };
  }, [user]);

  useEffect(() => {
    if (view !== 'profile' || !authUser?.uid) return;
    let active = true;
    fetchUserProfile(authUser?.uid)
      .then((snapshot) => {
        if (!active || !snapshot?.exists()) return;
        const normalized = normalizeProfileData(snapshot.data(), authUser?.uid);
        setProfile(normalized);
      })
      .catch((error) => console.error('Failed to refresh profile', error));
    return () => {
      active = false;
    };
  }, [view, authUser?.uid]);

  const toggleTheme = () => setDarkMode(!darkMode);

  const canUpload = profile && (!profile.roles.includes('fan') || profile.roles.length > 1);

  const handleTourComplete = (targetView) => {
    setShowTour(false);
    if(typeof targetView === 'string') setView(targetView);
  };

  const handleLogin = async (email, password) => {
    try {
      setAuthError(null);
      setAuthPending(true);
      const cred = await loginWithEmail(email, password);
      await ensureUserProfile(cred.user);
    } catch (e) {
      setAuthError(e.message);
    } finally {
      setAuthPending(false);
    }
  };

  const handleSignup = async (email, password, displayName) => {
    try {
      setAuthError(null);
      setAuthPending(true);
      const user = await registerWithEmail(email, password, displayName);
      await ensureUserProfile(user);
    } catch (e) {
      setAuthError(e.message);
      throw e;
    } finally {
      setAuthPending(false);
    }
  };

  const handleCompleteProfile = async (profileData, roles) => {
    const finalProfile = {
      uid: authUser?.uid,
      displayName: profileData.displayName || 'Nieuwe Maker',
      bio: profileData.bio,
      roles,
      themes: ['General'],
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authUser?.uid || 'artes'}`,
      linkedAgencyName: profileData.linkedAgencyName,
      linkedCompanyName: profileData.linkedCompanyName,
      preferences: {
        ...profileData.preferences,
        triggerVisibility: normalizeTriggerPreferences(profileData.preferences?.triggerVisibility),
        theme: profileData.preferences?.theme || 'light',
      },
    };
      if (authUser?.uid) {
        await updateUserProfile(authUser.uid, finalProfile);
        createProfile(authUser.uid, finalProfile).catch((error) => {
          console.error('Failed to sync profile to Firestore', error);
        });
      }
    const normalized = normalizeProfileData(finalProfile, authUser?.uid);
    setProfile(normalized);
    setDarkMode(finalProfile?.preferences?.theme === 'dark');
    setView('gallery');
    setShowTour(true);
  };

  return (
    <div className={`${darkMode ? 'dark' : ''} h-screen w-full flex flex-col transition-colors duration-300`}>
      <div className="flex-1 bg-[#F0F4F8] dark:bg-slate-900 text-slate-900 dark:text-slate-100 overflow-hidden relative font-sans">
        
        {/* Style tag to hide scrollbars */}
        <style dangerouslySetInnerHTML={{__html: `
           .no-scrollbar::-webkit-scrollbar { display: none; }
           .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}} />

        {/* Nav visible if profile loaded */}
        {profile && (
          <NavBar 
             view={view} 
             setView={setView} 
             profile={profile} 
             toggleTheme={toggleTheme} 
             darkMode={darkMode} 
             onOpenSettings={() => setShowSettingsModal(true)}
          />
        )}

        <main className="h-full overflow-y-auto pb-24 pt-16 scroll-smooth">
          {view === 'loading' && <div className="h-full flex items-center justify-center"><div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>}
          
          {view === 'login' && <LoginScreen setView={setView} onLogin={handleLogin} error={authError} loading={authPending} />}

          {view === 'onboarding' && <Onboarding setView={setView} users={users} onSignup={handleSignup} onCompleteProfile={handleCompleteProfile} authUser={authUser} authError={authError} />}
          
          {view === 'gallery' && (
            <Gallery 
              posts={posts} 
              onUserClick={setQuickProfileId}
              onShadowClick={setShadowProfileName}
              onPostClick={setSelectedPost}
              onChallengeClick={() => setView('challenge_detail')}
              profile={profile}
            />
          )}

          {view === 'discover' && <Discover users={users} posts={posts} onUserClick={setQuickProfileId} onPostClick={setSelectedPost} setView={setView} />}
          
          {view === 'community' && <CommunityList setView={setView} />}
          {view === 'challenge_detail' && <ChallengeDetail setView={setView} posts={posts.filter(p => p.isChallenge)} onPostClick={setSelectedPost} />}
          
          {view.startsWith('community_') && <CommunityDetail id={view.split('_')[1]} setView={setView} />}

          {/* Wrapper logic for viewing profiles */}
          {view === 'profile' && (
            <ImmersiveProfile 
              profile={profile} 
              isOwn={true} 
              posts={posts.filter(p => p.authorId === user?.uid)}
              onOpenSettings={() => setShowEditProfile(true)}
              onPostClick={setSelectedPost}
              allUsers={users}
            />
          )}
          
          {view.startsWith('profile_') && (
            <FetchedProfile 
               userId={view.split('_')[1]} 
               posts={posts}
               onPostClick={setSelectedPost}
               allUsers={users}
            />
          )}
        </main>

        {/* FAB */}
        {profile && view !== 'onboarding' && view !== 'login' && canUpload && (
           <div className="fixed bottom-6 right-6 z-40">
             <button onClick={() => setShowUploadModal(true)} className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl shadow-blue-600/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95">
               <Plus className="w-7 h-7" />
             </button>
           </div>
        )}

        {/* Modals */}
        {showUploadModal && <UploadModal onClose={() => setShowUploadModal(false)} user={user} profile={profile} users={users} />}
        {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} profile={profile} onLogout={async() => {await firebaseLogout(); setProfile(null); setAuthUser(null); setView('login');}} darkMode={darkMode} toggleTheme={toggleTheme} />}
        {showEditProfile && <EditProfileModal onClose={() => setShowEditProfile(false)} profile={profile} user={user} />}
        {showTour && <WelcomeTour onClose={handleTourComplete} setView={setView} />}
        
        {quickProfileId && (
          <UserPreviewModal
            userId={quickProfileId}
            onClose={() => setQuickProfileId(null)}
            onFullProfile={() => { setView(`profile_${quickProfileId}`); setQuickProfileId(null); }}
            posts={posts}
            allUsers={users}
          />
        )}
        {selectedPost && <PhotoDetailModal post={selectedPost} allPosts={posts} onClose={() => setSelectedPost(null)} onUserClick={setQuickProfileId} />}
        {shadowProfileName && <ShadowProfileModal name={shadowProfileName} posts={posts} onClose={() => setShadowProfileName(null)} onPostClick={setSelectedPost} />}

      </div>
    </div>
  );
}

// --- SUB COMPONENTS ---

function LoginScreen({ setView, onLogin, error, loading }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);
  const enableEmail = import.meta.env.VITE_ENABLE_EMAIL_SIGNIN !== 'false';
  const enableGoogle = import.meta.env.VITE_ENABLE_GOOGLE_SIGNIN !== 'false';
  const enableApple = import.meta.env.VITE_ENABLE_APPLE_SIGNIN === 'true';
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
       <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-bold text-4xl mb-6 shadow-xl shadow-blue-500/20 mx-auto">A</div>
          <h1 className="text-4xl font-bold mb-2 dark:text-white">Artes</h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8 text-lg">Connect, Create, Inspire.</p>
          <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-700">
             <div className="space-y-4">
               <Input label="E-mailadres" placeholder="naam@voorbeeld.nl" value={email} onChange={(e) => setEmail(e.target.value)} />
               <Input label="Wachtwoord" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
               {(localError || error) && <p className="text-sm text-red-500 text-left">{localError || error}</p>}
               <Button className="w-full" disabled={loading || !enableEmail} onClick={() => {
                 if (!enableEmail) {
                   setLocalError('Email login staat nog uit.');
                   return;
                 }
                 onLogin?.(email, password);
               }}>{loading ? 'Bezig met inloggen...' : 'Inloggen'}</Button>
             </div>
             <div className="mt-5 space-y-3">
               {enableGoogle && (
                 <button
                   type="button"
                   onClick={async () => {
                     try {
                       setLocalError(null);
                       const user = await signInWithGoogle();
                       if (user) {
                         await ensureUserProfile(user);
                       }
                     } catch (err) {
                       setLocalError(err?.message || 'Google login mislukt.');
                     }
                   }}
                   className="w-full border border-slate-200 dark:border-slate-700 rounded-xl py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                 >
                   Continue with Google
                 </button>
               )}
               <button
                 type="button"
                 disabled={!enableApple}
                 onClick={async () => {
                   if (!enableApple) {
                     setLocalError('Apple login staat nog uit. Komt later.');
                     return;
                   }
                   try {
                     setLocalError(null);
                     const user = await signInWithApple();
                     if (user) {
                       await ensureUserProfile(user);
                     }
                   } catch (e) {
                     const msg = e?.code === 'auth/operation-not-allowed'
                       ? 'Apple login is nog niet geactiveerd in Firebase.'
                       : e?.code === 'auth/unauthorized-domain'
                         ? 'Dit domein is nog niet toegestaan in Firebase Auth.'
                         : 'Apple login mislukt.';
                     setLocalError(msg);
                   }
                 }}
                 className={`w-full border border-slate-200 dark:border-slate-700 rounded-xl py-3 text-sm font-semibold transition ${enableApple ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700' : 'text-slate-400 dark:text-slate-500 cursor-not-allowed bg-slate-50 dark:bg-slate-800/40'}`}
               >
                 Continue with Apple {enableApple ? '' : '(soon)'}
               </button>
             </div>
             <div className="relative my-8">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200 dark:border-slate-700"></div></div>
                <div className="relative flex justify-center text-sm"><span className="px-4 bg-white dark:bg-slate-800 text-slate-500">Nieuw hier?</span></div>
             </div>
             <Button variant="secondary" className="w-full" onClick={() => setView('onboarding')}>Account aanmaken</Button>
          </div>
       </div>
    </div>
  );
}

function Onboarding({ setView, users, onSignup, onCompleteProfile, authUser, authError }) {
    const [step, setStep] = useState(1);
    const [roles, setRoles] = useState([]);
    const [profileData, setProfileData] = useState({
       displayName: '', bio: '', insta: '', linkedAgencyName: '', linkedCompanyName: '', preferences: {
         triggerVisibility: normalizeTriggerPreferences(),
         theme: 'light',
       },
    });
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [accountCreated, setAccountCreated] = useState(!!authUser);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
      if (!accountCreated && step > 1) {
        setStep(1);
      }
    }, [accountCreated, step]);

    useEffect(() => {
      if (authUser && !accountCreated) {
        setAccountCreated(true);
        setStep(2);
      }
    }, [authUser, accountCreated]);

    if (step === 1) return (
      <div className="max-w-md mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-1">Stap 1/5</h2>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Welkom bij Artes</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">Maak een account aan om te beginnen.</p>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          <Input label="E-mailadres" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Wachtwoord" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Echte naam (volledige naam)" value={profileData.displayName} onChange={e => setProfileData({...profileData, displayName: e.target.value})} />
          {(error || authError) && <p className="text-sm text-red-500">{error || authError}</p>}
          <Button onClick={async () => {
              try {
                setPending(true);
                setError(null);
                if (!accountCreated) {
                  await onSignup?.(email, password, profileData.displayName);
                  setAccountCreated(true);
                }
                setStep(2);
              } catch (e) {
                setError(e.message);
              } finally {
                setPending(false);
              }
          }} className="w-full" disabled={pending || (!accountCreated && (!email || !password))}> {pending ? 'Bezig...' : accountCreated ? 'Ga verder' : 'Account aanmaken'} </Button>
        </div>
      </div>
    );

    if (step === 2) return (
      <div className="max-w-lg mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase mb-1">Stap 2/5</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">Veiligheid & Waarden</h1>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border dark:border-slate-700 space-y-6">
           <div className="flex gap-3"><Shield className="text-blue-500"/><p className="text-sm dark:text-slate-300">Bij Artes staan respect en consent centraal.</p></div>
           <div className="flex gap-3"><CheckCircle className="text-green-500"/><p className="text-sm dark:text-slate-300">Identificatie via Didit is verplicht voor veiligheid.</p></div>
           <Button onClick={() => setStep(3)} className="w-full">Start Didit Verificatie</Button>
        </div>
      </div>
    );

    if (step === 3) return (
      <div className="max-w-2xl mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase mb-1">Stap 3/5</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">Kies je rol(len)</h1>
        <div className="grid grid-cols-2 gap-4 mb-8 h-96 overflow-y-auto no-scrollbar">
          {ROLES.map(r => (
            <button key={r.id} onClick={() => setRoles(prev => prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id])} className={`p-4 border-2 rounded-xl text-left transition-all ${roles.includes(r.id) ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="font-bold text-sm dark:text-white">{r.label}</div>
              <div className="text-xs text-slate-500">{r.desc}</div>
            </button>
          ))}
        </div>
        <Button onClick={() => setStep(4)} disabled={roles.length === 0} className="w-full">Volgende</Button>
      </div>
    );

    if (step === 4) return (
      <div className="max-w-lg mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase mb-1">Stap 4/5</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">Maak je profiel af</h1>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border dark:border-slate-700 space-y-4">
          <Input label="Weergavenaam" value={profileData.displayName} onChange={e => setProfileData({...profileData, displayName: e.target.value})} />
          <Input label="Korte bio" value={profileData.bio} onChange={e => setProfileData({...profileData, bio: e.target.value})} />
          
          <div className="flex gap-4">
             <div className="flex-1">
                 <label className="block text-sm font-medium mb-1 dark:text-slate-300">Agency (Optioneel)</label>
                 <input className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Naam Agency" value={profileData.linkedAgencyName} onChange={e => setProfileData({...profileData, linkedAgencyName: e.target.value})} />
             </div>
             <div className="flex-1">
                 <label className="block text-sm font-medium mb-1 dark:text-slate-300">Bedrijf/Studio (Optioneel)</label>
                 <input className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" placeholder="Naam Bedrijf" value={profileData.linkedCompanyName} onChange={e => setProfileData({...profileData, linkedCompanyName: e.target.value})} />
             </div>
          </div>
          <Button className="w-full mt-4" onClick={() => setStep(5)}>Volgende</Button>
        </div>
      </div>
    );

    if (step === 5) return (
      <div className="max-w-lg mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase mb-1">Stap 5/5</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">Appvoorkeuren</h1>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border dark:border-slate-700 space-y-6">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Thema</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Kies de weergave van de app.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'light', label: 'Light' },
                { id: 'dark', label: 'Dark' },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() =>
                    setProfileData((prev) => ({
                      ...prev,
                      preferences: {
                        ...prev.preferences,
                        theme: opt.id,
                      },
                    }))
                  }
                  className={`p-4 rounded-2xl border text-left transition ${
                    (profileData.preferences?.theme || 'light') === opt.id
                      ? 'border-blue-300 bg-blue-50 dark:border-blue-800/80 dark:bg-blue-900/20 text-blue-800 dark:text-blue-100'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <p className="font-semibold">{opt.label}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Trigger voorkeuren</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Kies hoe je gevoelige content per trigger wilt zien.</p>
            </div>
            <div className="space-y-3">
              {TRIGGERS.map((trigger) => (
                <div key={trigger.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{trigger.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {TRIGGER_PREFERENCE_OPTIONS.map((opt) => (
                      <button
                        type="button"
                        key={opt.id}
                        onClick={() =>
                          setProfileData((prev) => ({
                            ...prev,
                            preferences: {
                              ...prev.preferences,
                              triggerVisibility: {
                                ...prev.preferences?.triggerVisibility,
                                [trigger.id]: opt.id,
                              },
                            },
                          }))
                        }
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                          (profileData.preferences?.triggerVisibility?.[trigger.id] || 'cover') === opt.id
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button className="w-full" disabled={!accountCreated || pending || roles.length === 0} onClick={async () => {
              try {
                setPending(true);
                setError(null);
                await onCompleteProfile?.(profileData, roles);
              } catch (e) {
                setError(e.message);
              } finally {
                setPending(false);
              }
          }}>{pending ? 'Opslaan...' : 'Afronden'}</Button>
        </div>
      </div>
    );
}

function Gallery({ posts, onUserClick, profile, onChallengeClick, onPostClick, onShadowClick }) {
  const [sensitiveRevealed, setSensitiveRevealed] = useState({});
  const triggerVisibility = profile?.preferences?.triggerVisibility || normalizeTriggerPreferences();
  const isSensitivePost = (post) => getPostTriggerKeys(post).length > 0;
  const visiblePosts = posts.filter((post) => getPostContentPreference(post, triggerVisibility) !== 'hideFeed');

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-12">
      {visiblePosts.map((post) => {
        const contentPreference = getPostContentPreference(post, triggerVisibility);
        const shouldCover = isSensitivePost(post) && contentPreference === 'cover' && !sensitiveRevealed[post.id];
        return (
        <div key={post.id} className="relative group">
           <div className={`relative overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800 min-h-[300px] shadow-sm cursor-pointer ${post.isChallenge ? 'ring-4 ring-amber-400' : ''}`} onClick={() => onPostClick(post)}>
             {shouldCover ? (
                <div className="absolute inset-0 z-10 backdrop-blur-3xl bg-slate-900/80 flex flex-col items-center justify-center p-6 text-center" onClick={(e) => e.stopPropagation()}>
                   <AlertOctagon className="w-12 h-12 text-orange-500 mb-4" />
                   <h4 className="text-white font-bold text-lg mb-2">Gevoelige inhoud</h4>
                   <Button variant="outline" onClick={() => setSensitiveRevealed(prev => ({...prev, [post.id]: true}))}>Toch bekijken</Button>
                </div>
             ) : null}
             <img src={post.imageUrl} className="w-full h-auto object-cover block" loading="lazy" />
           </div>
           <div className="bg-white dark:bg-slate-800 rounded-b-xl shadow-xl p-5 mt-2 border border-slate-100 dark:border-slate-700 flex gap-6">
              <div className="flex-1 space-y-3">
                 <div className="flex gap-4"><Hand className="w-6 h-6"/><Cloud className="w-6 h-6"/></div>
                 <div><h3 className="text-lg font-serif font-bold dark:text-white">{post.title}</h3><p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{post.description}</p></div>
                 <div className="flex flex-wrap gap-2">{post.styles?.map(s => <Badge key={s} colorClass={getThemeStyle(s)}>{s}</Badge>)}</div>
              </div>
              <div className="text-right flex flex-col gap-2">
                 <div className="cursor-pointer group" onClick={() => onUserClick(post.authorId)}>
                    <div className="text-xs uppercase font-bold text-slate-400">{ROLES.find(r => r.id === post.authorRole)?.label}</div>
                    <div className="text-xs font-medium text-slate-900 group-hover:text-blue-600 dark:text-white transition-colors">{post.authorName}</div>
                 </div>
                 {post.credits && post.credits.map((c, i) => (
                    <div key={i} className="cursor-pointer group" onClick={() => c.uid ? onUserClick(c.uid) : onShadowClick(c.name)}>
                       <div className="text-xs uppercase font-bold text-slate-400">{ROLES.find(r => r.id === c.role)?.label || c.role}</div>
                       <div className="text-xs font-medium text-slate-900 group-hover:text-blue-600 dark:text-white transition-colors flex items-center justify-end gap-1">
                          {c.name} {!c.uid && <ExternalLink className="w-3 h-3 text-slate-400"/>}
                       </div>
                    </div>
                 ))}
              </div>
           </div>
        </div>
      );})}
    </div>
  );
}

function Discover({ users, posts, onUserClick, onPostClick, setView }) {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [activeThemes, setActiveThemes] = useState([]);
  const [activeRole, setActiveRole] = useState(null);
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [showAllRoles, setShowAllRoles] = useState(false);

  const displayedThemes = showAllThemes ? THEMES : THEMES.slice(0, 5);
  const displayedRoles = showAllRoles ? ROLES : ROLES.slice(0, 5);
  
  const toggleTheme = (t) => setActiveThemes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  const mixedContent = useMemo(() => {
     if (tab !== 'all') return [];
     const res = [];
     const max = Math.max(users.length, posts.length);
     for(let i=0; i<max; i++) {
        if(posts[i]) res.push({type: 'post', data: posts[i]});
        if(users[i]) res.push({type: 'user', data: users[i]});
     }
     return res.filter(i => (i.type === 'post' ? i.data.title : i.data.displayName).toLowerCase().includes(search.toLowerCase()));
  }, [users, posts, search, tab]);

  const filteredPosts = posts.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) && (activeThemes.length === 0 || p.styles?.some(s => activeThemes.includes(s))));
  const filteredUsers = users.filter(u => u.displayName.toLowerCase().includes(search.toLowerCase()) && (!activeRole || u.roles?.includes(activeRole)));

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
       <div className="sticky top-0 bg-[#F0F4F8] dark:bg-slate-900 z-30 pb-4">
          <div className="relative mb-4"><Search className="absolute left-4 top-3.5 text-slate-400"/><input className="w-full pl-12 pr-4 py-3 rounded-2xl border-none shadow-sm dark:bg-slate-800 dark:text-white" placeholder="Zoeken..." value={search} onChange={e => setSearch(e.target.value)}/></div>
          <div className="flex gap-2 mb-4">
             {['all', 'ideas', 'people'].map(t => <button key={t} onClick={() => setTab(t)} className={`px-6 py-2 rounded-lg font-bold text-sm transition-all ${tab === t ? 'bg-white shadow text-blue-600 dark:bg-slate-700 dark:text-white' : 'text-slate-500'}`}>{t === 'all' ? 'Alles' : t === 'ideas' ? 'Ideeën' : 'Mensen'}</button>)}
          </div>
       </div>

       {tab === 'all' && <div className="columns-2 md:columns-4 gap-4 space-y-4">{mixedContent.map((item, i) => (
          <div key={i} onClick={() => item.type === 'post' ? onPostClick(item.data) : onUserClick(item.data.uid)} className="break-inside-avoid bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm cursor-pointer mb-4">
             <img src={item.type === 'post' ? item.data.imageUrl : item.data.avatar} className="w-full h-auto" />
             <div className="p-2 font-bold text-xs truncate dark:text-white">{item.type === 'post' ? item.data.title : item.data.displayName}</div>
          </div>
       ))}</div>}

       {tab === 'ideas' && <div>
          <div className="flex flex-wrap gap-2 mb-6">{displayedThemes.map(t => <button key={t} onClick={() => toggleTheme(t)} className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${activeThemes.includes(t) ? 'ring-2 ring-blue-500 ' + getThemeStyle(t) : 'bg-white dark:bg-slate-800 text-slate-500'}`}>{t}</button>)}<button onClick={() => setShowAllThemes(!showAllThemes)} className="text-xs font-bold text-blue-600 px-4">Toon meer...</button></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{filteredPosts.map(p => <div key={p.id} onClick={() => onPostClick(p)} className="aspect-[4/5] bg-slate-200 rounded-lg overflow-hidden cursor-pointer"><img src={p.imageUrl} className="w-full h-full object-cover"/></div>)}</div>
       </div>}

       {tab === 'people' && <div>
          <div className="flex flex-wrap gap-2 mb-6"><button onClick={() => setActiveRole(null)} className="px-4 py-2 rounded-full text-xs font-bold bg-blue-600 text-white">Iedereen</button>{displayedRoles.map(r => <button key={r.id} onClick={() => setActiveRole(r.id)} className={`px-4 py-2 rounded-full text-xs font-bold border ${activeRole === r.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}>{r.label}</button>)}<button onClick={() => setShowAllRoles(!showAllRoles)} className="text-xs font-bold text-blue-600 px-4">Toon meer...</button></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{filteredUsers.map(u => <div key={u.uid} onClick={() => onUserClick(u.uid)} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm cursor-pointer"><div className="aspect-square relative"><img src={u.avatar} className="w-full h-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-3"><span className="text-white font-bold">{u.displayName}</span><span className="text-white/70 text-xs">{ROLES.find(r => r.id === u.roles[0])?.label}</span></div></div></div>)}</div>
       </div>}
    </div>
  );
}

function NavBar({ view, setView, profile, onOpenSettings }) {
   return (
      <>
        <div className="fixed top-0 left-0 right-0 h-16 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 z-30 flex items-center justify-between px-6">
           <div className="font-bold text-xl dark:text-white cursor-pointer" onClick={() => setView('gallery')}>Artes</div>
           <div className="hidden md:flex gap-6">
              {['gallery', 'discover', 'community'].map(v => <button key={v} onClick={() => setView(v)} className={`capitalize font-medium ${view === v ? 'text-blue-600' : 'text-slate-500'}`}>{v === 'discover' ? 'Ontdekken' : v === 'gallery' ? 'Galerij' : v}</button>)}
              <button onClick={() => setView('profile')} className={`capitalize font-medium ${view === 'profile' ? 'text-blue-600' : 'text-slate-500'}`}>Mijn Portfolio</button>
           </div>
           <button onClick={onOpenSettings}><Settings className="w-5 h-5 text-slate-500"/></button>
        </div>
        <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 z-30 flex items-center justify-around">
           <button onClick={() => setView('gallery')} className={view === 'gallery' ? 'text-blue-600' : 'text-slate-400'}><ImageIcon/></button>
           <button onClick={() => setView('discover')} className={view === 'discover' ? 'text-blue-600' : 'text-slate-400'}><Search/></button>
           <button onClick={() => setView('community')} className={view === 'community' ? 'text-blue-600' : 'text-slate-400'}><Users/></button>
           <button onClick={() => setView('profile')} className={view === 'profile' ? 'text-blue-600' : 'text-slate-400'}><User/></button>
        </div>
      </>
   );
}

function ImmersiveProfile({ profile, isOwn, posts, onOpenSettings, onPostClick }) {
  if (!profile) return null;
  const normalizedProfile = normalizeProfileData(profile);
  const roles = normalizedProfile.roles;
  const themes = normalizedProfile.themes;
  const bio = normalizedProfile.bio;
  const showBio = Boolean(bio && bio !== 'Nog geen bio toegevoegd.');
  const agencyName = normalizedProfile.linkedAgencyName || '';
  const companyName = normalizedProfile.linkedCompanyName || '';
  const agencyLink = normalizedProfile.linkedAgencyLink || '';
  const companyLink = normalizedProfile.linkedCompanyLink || '';
  const hasAgency = Boolean(agencyName);
  const hasCompany = Boolean(companyName);
  const roleLabel = (roleId) => ROLES.find((x) => x.id === roleId)?.label || 'Onbekende rol';

  return (
     <div className="min-h-screen bg-white dark:bg-slate-900 pb-20">
        <div className="relative h-[520px] w-full overflow-hidden">
           <img src={normalizedProfile.avatar} className="w-full h-full object-cover scale-105" />
           <div className="absolute inset-0 bg-white/40 dark:bg-black/55" />
           <div className="absolute inset-0 bg-gradient-to-b from-white/70 via-white/20 to-white/50 dark:from-black/70 dark:via-black/30 dark:to-black/80" />
           <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white dark:from-slate-900 to-transparent z-10" /> 
           
           {isOwn && <div className="absolute top-4 right-4 z-30"><Button onClick={onOpenSettings} className="bg-black/50 text-white hover:bg-black/70 border-none backdrop-blur-md"><Edit3 className="w-4 h-4 mr-2"/> Profiel Bewerken</Button></div>}
           
           <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center">
              <h1 className="text-5xl font-bold text-blue-700 dark:text-white mb-3">{normalizedProfile.displayName}</h1>
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                 {roles.map(r => (
                   <span key={r} className="text-xs font-bold uppercase tracking-widest text-blue-900 dark:text-white bg-white/80 dark:bg-white/10 px-3 py-1 rounded-full backdrop-blur border border-blue-200/60 dark:border-white/20 shadow-sm">
                     {roleLabel(r)}
                   </span>
                 ))}
              </div>
              {showBio && <p className="text-slate-700 dark:text-slate-200 max-w-xl text-base md:text-lg mb-5 leading-relaxed">{bio}</p>}
              {(hasAgency || hasCompany) && (
                <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-2 sm:gap-6 text-xs text-slate-700/80 dark:text-white/80 mb-5">
                  {hasAgency && (
                    <span className="flex items-center gap-1.5">
                      <span className="uppercase tracking-widest text-[10px] font-semibold text-slate-500 dark:text-slate-300">Agency</span>
                      {agencyLink ? (
                        <a href={agencyLink} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 dark:text-white hover:text-blue-800 dark:hover:text-white/90 transition-colors">
                          {agencyName}
                        </a>
                      ) : (
                        <span className="font-semibold text-slate-700 dark:text-white">{agencyName}</span>
                      )}
                    </span>
                  )}
                  {hasCompany && (
                    <span className="flex items-center gap-1.5">
                      <span className="uppercase tracking-widest text-[10px] font-semibold text-slate-500 dark:text-slate-300">Bedrijf</span>
                      {companyLink ? (
                        <a href={companyLink} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 dark:text-white hover:text-blue-800 dark:hover:text-white/90 transition-colors">
                          {companyName}
                        </a>
                      ) : (
                        <span className="font-semibold text-slate-700 dark:text-white">{companyName}</span>
                      )}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-2 mt-1">
                {themes.map((theme) => (
                  <span key={theme} className={`px-3 py-1 rounded-full text-xs font-semibold border ${getThemeStyle(theme)}`}>
                    {theme}
                  </span>
                ))}
              </div>
           </div>
        </div>
        
        <div className="max-w-6xl mx-auto px-6 py-8 relative z-20">
           <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {posts.map(p => <div key={p.id} onClick={() => onPostClick(p)} className="aspect-[4/5] bg-slate-200 rounded-sm overflow-hidden cursor-pointer"><img src={p.imageUrl} className="w-full h-full object-cover"/></div>)}
           </div>
           {posts.length === 0 && <p className="text-center text-slate-500 py-10">Nog geen posts.</p>}
        </div>
     </div>
  );
}

function UploadModal({ onClose, user, profile, users }) {
  const defaultRole = profile.roles?.[0] || 'photographer';
  const selfCredit = { role: defaultRole, name: profile.displayName, uid: profile.uid, isSelf: true };
  const triggerLabelMap = useMemo(() => new Map(TRIGGERS.map((trigger) => [trigger.id, trigger.label])), []);
  const getTriggerLabel = (id) => triggerLabelMap.get(id) || id;
  const MAX_UPLOAD_BYTES = 900 * 1024;
  const MAX_DIMENSION = 1600;

  const [step, setStep] = useState(1);
  const [image, setImage] = useState(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [credits, setCredits] = useState([selfCredit]);
  const [newCredit, setNewCredit] = useState({ role: 'model', name: '', link: '' });
  const [showInvite, setShowInvite] = useState(false);
  const [makerTags, setMakerTags] = useState([]);
  const [appliedTriggers, setAppliedTriggers] = useState([]);
  const [suggestedTriggers, setSuggestedTriggers] = useState([]);
  const [outcome, setOutcome] = useState(null);
  const [forbiddenReasons, setForbiddenReasons] = useState([]);
  const [reviewCaseId, setReviewCaseId] = useState(null);
  const [showSuggestionUI, setShowSuggestionUI] = useState(false);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [uploaderRole, setUploaderRole] = useState(defaultRole);
  const [errors, setErrors] = useState({});
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');

  // Contributor search logic
  const [contributorSearch, setContributorSearch] = useState('');
  const searchResults = useMemo(() => {
    if (!contributorSearch) return [];
    return users.filter(u => u.displayName.toLowerCase().includes(contributorSearch.toLowerCase()));
  }, [users, contributorSearch]);

  const toDataUrlSize = (dataUrl) => {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) return dataUrl.length;
    const base64 = dataUrl.slice(commaIndex + 1);
    return Math.floor((base64.length * 3) / 4);
  };

  const compressImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Kon het bestand niet lezen.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Kon de afbeelding niet laden.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / img.width, MAX_DIMENSION / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (toDataUrlSize(dataUrl) > MAX_UPLOAD_BYTES && quality > 0.5) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (toDataUrlSize(dataUrl) > MAX_UPLOAD_BYTES) {
          const ratio = Math.sqrt(MAX_UPLOAD_BYTES / toDataUrlSize(dataUrl));
          const resizedCanvas = document.createElement('canvas');
          resizedCanvas.width = Math.max(1, Math.floor(canvas.width * ratio));
          resizedCanvas.height = Math.max(1, Math.floor(canvas.height * ratio));
          const resizedCtx = resizedCanvas.getContext('2d');
          resizedCtx.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
          dataUrl = resizedCanvas.toDataURL('image/jpeg', 0.7);
        }

        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await compressImage(file);
      setImage(dataUrl);
      setStep(2);
      setErrors(prev => ({ ...prev, image: undefined }));
      setAiError('');
      setMakerTags([]);
      setAppliedTriggers([]);
      setSuggestedTriggers([]);
      setOutcome(null);
      setForbiddenReasons([]);
      setReviewCaseId(null);
      setShowSuggestionUI(false);
      setReviewRequested(false);
    } catch (error) {
      console.error('Image processing failed', error);
      setErrors(prev => ({ ...prev, image: 'Afbeelding verwerken mislukt. Probeer een ander bestand.' }));
    }
  };

  const runAICheck = async () => {
    if (!image) {
      setErrors((prev) => ({ ...prev, image: 'Voeg eerst een afbeelding toe voor de AI-scan.' }));
      return;
    }

    const moderationEndpoint = import.meta.env.VITE_MODERATION_FUNCTION_URL;
    if (!moderationEndpoint) {
      setAiError('Geen AI-endpoint ingesteld. Voeg VITE_MODERATION_FUNCTION_URL toe aan je omgeving.');
      return;
    }

    setAiLoading(true);
    setAiError('');
    setErrors((prev) => ({ ...prev, moderation: undefined }));

    try {
      const response = await fetch(moderationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, makerTags }),
      });

      if (!response.ok) {
        throw new Error('AI-service gaf een fout terug.');
      }

      const data = await response.json();
      const nextAppliedTriggers = Array.isArray(data.appliedTriggers) ? data.appliedTriggers : [];
      const nextSuggestedTriggers = Array.isArray(data.suggestedTriggers) ? data.suggestedTriggers : [];
      const nextOutcome = data?.outcome ?? null;
      const nextForbiddenReasons = Array.isArray(data.forbiddenReasons) ? data.forbiddenReasons : [];
      const nextReviewCaseId = data?.reviewCaseId ?? null;
      const shouldShowSuggestions = nextOutcome === 'allowed' && nextSuggestedTriggers.length > 0;

      setAppliedTriggers(nextAppliedTriggers);
      setSuggestedTriggers(nextSuggestedTriggers);
      setOutcome(nextOutcome);
      setForbiddenReasons(nextForbiddenReasons);
      setReviewCaseId(nextReviewCaseId);
      setShowSuggestionUI(shouldShowSuggestions);
      setReviewRequested(false);
    } catch (error) {
      console.error('AI check failed', error);
      setAiError('AI-check mislukt. Probeer het opnieuw.');
      setAppliedTriggers([]);
      setSuggestedTriggers([]);
      setOutcome(null);
      setForbiddenReasons([]);
      setReviewCaseId(null);
      setShowSuggestionUI(false);
      setReviewRequested(false);
    } finally {
      setAiLoading(false);
    }
  };

  const addCredit = (foundUser) => {
     if(foundUser) {
        setCredits([...credits, { role: newCredit.role, name: foundUser.displayName, uid: foundUser.uid }]);
        setContributorSearch('');
        setNewCredit({...newCredit, name: ''});
     } else {
        if(!newCredit.name) return;
        // Add shadow profile
        setCredits([...credits, { role: newCredit.role, name: newCredit.name, link: newCredit.link, isExternal: true }]);
        setContributorSearch('');
        setNewCredit({ role: 'model', name: '', link: '' });
        setShowInvite(false);
     }
  };

  useEffect(() => {
    setCredits((prev) => {
      const existingSelf = prev.find((c) => c.isSelf);
      if (existingSelf && existingSelf.role === uploaderRole && existingSelf.name === profile.displayName && existingSelf.uid === profile.uid) {
        const others = prev.filter((c) => !c.isSelf);
        return [existingSelf, ...others];
      }
      const others = prev.filter((c) => !c.isSelf);
      return [{ role: uploaderRole, name: profile.displayName, uid: profile.uid, isSelf: true }, ...others];
    });
  }, [uploaderRole, profile.displayName, profile.uid]);

  const toggleStyle = (theme) => {
    setSelectedStyles((prev) => prev.includes(theme) ? prev.filter(x => x !== theme) : [...prev, theme]);
    setErrors(prev => ({ ...prev, styles: undefined }));
  };

  const handlePublish = async ({ applySuggestions = false } = {}) => {
    const validationErrors = {};

    if (!image) validationErrors.image = 'Voeg een afbeelding toe.';
    if (!title.trim()) validationErrors.title = 'Titel is verplicht.';
    if (selectedStyles.length === 0) validationErrors.styles = 'Kies minstens één thema.';
    if (outcome === 'forbidden') validationErrors.moderation = 'Deze publicatie is geblokkeerd door de safety check.';

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const baseTriggers = appliedTriggers.length ? appliedTriggers : makerTags;
    const finalAppliedTriggers = applySuggestions
      ? Array.from(new Set([...baseTriggers, ...suggestedTriggers]))
      : baseTriggers;
    const triggerFlag = finalAppliedTriggers.length > 0;

    setPublishing(true);
    setPublishError('');

    try {
      await publishPost({
         title, description: desc, imageUrl: image, authorId: user.uid, authorName: profile.displayName, authorRole: uploaderRole,
         styles: selectedStyles,
         sensitive: triggerFlag,
         triggers: finalAppliedTriggers.map(getTriggerLabel),
         makerTags,
         appliedTriggers: finalAppliedTriggers,
         outcome: outcome || 'unchecked',
         forbiddenReasons,
         reviewCaseId,
         credits,
         likes: 0
      });

      setErrors({});
      setImage(null);
      setTitle('');
      setDesc('');
      setSelectedStyles([]);
      setCredits([{ role: defaultRole, name: profile.displayName, uid: profile.uid, isSelf: true }]);
      setNewCredit({ role: 'model', name: '', link: '' });
      setShowInvite(false);
      setMakerTags([]);
      setAppliedTriggers([]);
      setSuggestedTriggers([]);
      setOutcome(null);
      setForbiddenReasons([]);
      setReviewCaseId(null);
      setShowSuggestionUI(false);
      setReviewRequested(false);
      setAiLoading(false);
      setUploaderRole(defaultRole);
      setStep(1);
      setPublishing(false);
      onClose();
    } catch (error) {
      console.error('Publish error', error);
      setPublishError('Er ging iets mis bij het publiceren. Probeer het opnieuw.');
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
       <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[85vh] rounded-3xl overflow-hidden flex flex-col">
          <div className="p-4 border-b flex justify-between"><h3 className="font-bold dark:text-white">Beeld publiceren</h3><button onClick={onClose}><X className="dark:text-white"/></button></div>
          <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
             {step === 1 ? <div className="h-full border-2 border-dashed rounded-3xl flex items-center justify-center relative"><input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFile} /><Plus className="w-10 h-10 text-slate-400"/></div> : (
                <div className="grid md:grid-cols-2 gap-8">
                   <div className="space-y-4">
                      <div className="aspect-[4/5] bg-slate-100 rounded-xl overflow-hidden relative">
                         <img src={image} className="w-full h-full object-cover"/>
                         {outcome === 'forbidden' && (
                           <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center text-orange-400 font-bold">
                             <AlertOctagon className="w-6 h-6 mr-2"/> Publicatie geblokkeerd
                           </div>
                         )}
                      </div>
                      {errors.image && <p className="text-xs text-red-500">{errors.image}</p>}
                      <div className="bg-slate-50 p-4 rounded-xl border dark:bg-slate-800 dark:border-slate-700">
                         <div className="flex justify-between items-center mb-3">
                            <span className="text-sm font-bold flex items-center gap-2 dark:text-white"><Shield className="w-4 h-4"/> Safety Check</span>
                            <button
                              onClick={runAICheck}
                              disabled={aiLoading}
                              className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded flex items-center gap-1 disabled:opacity-60"
                            >
                              {aiLoading && <Loader2 className="w-3 h-3 animate-spin" />}AI Scan
                            </button>
                         </div>
                         <p className="text-xs text-slate-500 dark:text-slate-300 mb-2">Selecteer maker-tags om context mee te geven aan de AI-check.</p>
                         <div className="flex flex-wrap gap-2">
                           {TRIGGERS.map((trigger) => (
                             <button
                               key={trigger.id}
                               type="button"
                               onClick={() => {
                                 setMakerTags((prev) => prev.includes(trigger.id)
                                   ? prev.filter((item) => item !== trigger.id)
                                   : [...prev, trigger.id]
                                 );
                                 setShowSuggestionUI(false);
                               }}
                               className={`text-[11px] px-2 py-1 rounded border ${makerTags.includes(trigger.id) ? 'bg-orange-100 text-orange-800 border-orange-200' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-200'}`}
                             >
                               {trigger.label}
                             </button>
                           ))}
                         </div>
                         {aiError && <p className="text-xs text-red-500 mt-2">{aiError}</p>}
                         {errors.moderation && <p className="text-xs text-red-500 mt-2">{errors.moderation}</p>}
                         {outcome === 'forbidden' && (
                           <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/30 dark:text-red-200">
                             <p className="font-semibold">Deze publicatie is geblokkeerd.</p>
                             {forbiddenReasons.length > 0 && (
                               <ul className="list-disc list-inside mt-2 space-y-1">
                                 {forbiddenReasons.map((reason) => (
                                   <li key={reason}>{reason}</li>
                                 ))}
                               </ul>
                             )}
                             {reviewCaseId && <p className="mt-2">Case ID: <span className="font-semibold">{reviewCaseId}</span></p>}
                             <div className="mt-3 flex flex-wrap gap-2">
                               <button
                                 type="button"
                                 onClick={() => setReviewRequested(true)}
                                 className="text-xs bg-red-600 text-white px-3 py-1 rounded"
                               >
                                 Vraag review aan
                               </button>
                               {reviewRequested && (
                                 <span className="text-xs text-red-600 dark:text-red-300">Review aangevraagd. We nemen contact op.</span>
                               )}
                             </div>
                           </div>
                         )}
                         {outcome === 'allowed' && !showSuggestionUI && (
                           <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-300">AI-check: toegestaan. Je kunt direct publiceren.</p>
                         )}
                         {showSuggestionUI && (
                           <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/30 dark:text-amber-200">
                             <p className="font-semibold">AI-suggesties voor extra triggers</p>
                             <div className="flex flex-wrap gap-2 mt-2">
                               {suggestedTriggers.map((triggerId) => (
                                 <span key={triggerId} className="px-2 py-1 rounded-full border border-amber-300 text-[11px]">
                                   {getTriggerLabel(triggerId)}
                                 </span>
                               ))}
                             </div>
                             <div className="mt-3 flex flex-wrap gap-2">
                               <button
                                 type="button"
                                 onClick={() => handlePublish({ applySuggestions: true })}
                                 className="text-xs bg-amber-600 text-white px-3 py-1 rounded"
                                 disabled={publishing}
                               >
                                 Voeg suggesties toe & publiceer
                               </button>
                               <button
                                 type="button"
                                 onClick={() => handlePublish({ applySuggestions: false })}
                                 className="text-xs border border-amber-400 px-3 py-1 rounded"
                                 disabled={publishing}
                               >
                                 Publiceer zonder suggesties
                               </button>
                               <button
                                 type="button"
                                 onClick={() => setShowSuggestionUI(false)}
                                 className="text-xs text-amber-700 underline"
                               >
                                 Aanpassen
                               </button>
                             </div>
                           </div>
                         )}
                      </div>
                   </div>
                   <div className="space-y-6">
                      <Input label="Titel" value={title} onChange={e => { setTitle(e.target.value); setErrors(prev => ({ ...prev, title: undefined })); }} error={errors.title} />
                      <div><label className="text-sm font-normal block mb-2 dark:text-white">Bijschrift</label><textarea className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white" value={desc} onChange={e => setDesc(e.target.value)} /></div>
                      
                      <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border">
                         <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-bold block dark:text-white">Bijdragers</label>
                            {profile.roles.length === 1 && <span className="text-[11px] uppercase text-slate-500">{ROLES.find(x => x.id === uploaderRole)?.label}</span>}
                         </div>

                         {profile.roles.length > 1 && (
                            <div className="mb-4">
                               <p className="text-xs font-semibold text-slate-500 mb-1">Jouw rol in deze publicatie</p>
                               <div className="flex gap-2 flex-wrap">{profile.roles.map(r => <button key={r} onClick={() => setUploaderRole(r)} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${uploaderRole === r ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-white'}`}>{ROLES.find(x => x.id === r)?.label}</button>)}</div>
                               <p className="text-[11px] text-slate-500 mt-1">Wordt toegevoegd als jouw eigen credit.</p>
                            </div>
                         )}

                         <div className="space-y-2 mb-3">
                            {credits.map((c, i) => (
                               <div key={i} className="flex justify-between items-center text-xs bg-white dark:bg-slate-700 p-2 rounded border dark:border-slate-600">
                                  <div className="flex items-center gap-2 dark:text-white">
                                     {c.isSelf && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Jij</span>}
                                     <span><span className="font-bold capitalize">{ROLES.find(r => r.id === c.role)?.label}:</span> {c.name}</span>
                                  </div>
                                  <div className="flex gap-2 items-center">
                                     {c.isExternal && <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px]">Extern</span>}
                                     {!c.isSelf && <button onClick={() => setCredits(credits.filter((_, idx) => idx !== i))}><Trash2 className="w-3 h-3 text-red-500"/></button>}
                                  </div>
                               </div>
                            ))}
                         </div>

                         <div className="flex gap-2 mb-2">
                            <select className="p-2 border rounded text-sm w-1/3" value={newCredit.role} onChange={e => setNewCredit({...newCredit, role: e.target.value})}>{ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                            <div className="relative flex-1">
                                <input 
                                   className="w-full p-2 border rounded text-sm" 
                                   placeholder="Zoek naam..." 
                                   value={contributorSearch || newCredit.name} 
                                   onChange={e => {
                                      setContributorSearch(e.target.value);
                                      setNewCredit({...newCredit, name: e.target.value});
                                      if(!e.target.value) setShowInvite(false);
                                   }} 
                                />
                                {contributorSearch && searchResults.length > 0 && (
                                   <div className="absolute top-full left-0 right-0 bg-white border mt-1 rounded shadow-lg max-h-40 overflow-y-auto z-10">
                                      {searchResults.map(u => (
                                         <div key={u.uid} className="p-2 hover:bg-slate-100 cursor-pointer text-sm" onClick={() => addCredit(u)}>{u.displayName}</div>
                                      ))}
                                   </div>
                                )}
                                {contributorSearch && searchResults.length === 0 && (
                                    <div className="absolute top-full left-0 right-0 bg-white border mt-1 rounded shadow-lg p-2 z-10">
                                        <p className="text-xs text-orange-500 mb-2">Geen gebruiker gevonden.</p>
                                        <button onClick={() => setShowInvite(true)} className="text-xs bg-slate-100 p-1 rounded w-full">Voeg toe als extern</button>
                                    </div>
                                )}
                            </div>
                         </div>
                         
                         {showInvite && (
                            <div className="bg-yellow-50 p-3 rounded text-xs text-yellow-800 mb-2 border border-yellow-200">
                               <p className="mb-2 font-semibold">Tijdelijk profiel aanmaken voor {newCredit.name}</p>
                               <input className="w-full p-2 rounded border mb-2" placeholder="Website / Instagram Link (Optioneel)" value={newCredit.link} onChange={e => setNewCredit({...newCredit, link: e.target.value})} />
                               <button onClick={() => addCredit(null)} className="w-full bg-yellow-600 text-white py-1 rounded">Toevoegen</button>
                            </div>
                         )}

                         <div className="space-y-1">
                         </div>
                      </div>
                      <div>
                     <label className="text-sm font-bold block mb-2 dark:text-white">Thema&apos;s</label>
                         <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto no-scrollbar">{THEMES.map(t => <button key={t} onClick={() => toggleStyle(t)} className={`px-2 py-1 rounded text-xs border ${selectedStyles.includes(t) ? 'bg-blue-600 text-white' : ''} ${getThemeStyle(t)}`}>{t}</button>)}</div>
                         {errors.styles && <p className="mt-2 text-xs text-red-500">{errors.styles}</p>}
                      </div>
                      {publishError && <p className="text-sm text-red-500 text-center">{publishError}</p>}
                      {showSuggestionUI && <p className="text-xs text-amber-700 text-center">Kies hoe je met de AI-suggesties wilt omgaan om te publiceren.</p>}
                      <Button onClick={handlePublish} className="w-full" disabled={publishing || showSuggestionUI || outcome === 'forbidden'}>
                        {publishing ? <><Loader2 className="w-4 h-4 animate-spin" /> Publiceren...</> : 'Publiceren'}
                      </Button>
                   </div>
                </div>
             )}
          </div>
       </div>
    </div>
  );
}

function EditProfileModal({ onClose, profile, user }) {
  const [formData, setFormData] = useState({ ...profile });
  const [agencySearch, setAgencySearch] = useState('');
  const [tab, setTab] = useState('general');
  
  const handleSave = async () => {
     const payload = {
       ...formData,
       preferences: {
         ...formData.preferences,
         triggerVisibility: normalizeTriggerPreferences(formData.preferences?.triggerVisibility),
       },
     };
     await updateProfileData(user.uid, payload);
     onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
       <div className="bg-white dark:bg-slate-900 w-full max-w-2xl h-[80vh] rounded-3xl overflow-hidden flex flex-col">
          <div className="p-6 border-b flex justify-between"><h3 className="font-bold text-lg dark:text-white">Profiel Bewerken</h3><button onClick={onClose}><X/></button></div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
             {/* Simple Tabs for this view */}
             <div className="flex gap-4 border-b mb-4">
                 {['Algemeen', 'Triggers', 'Rollen', 'Stijlen'].map(t => (
                   <button
                     key={t}
                     onClick={() => setTab(t.toLowerCase())}
                     className={`pb-2 ${tab === t.toLowerCase() ? 'border-b-2 border-blue-600 font-bold' : ''}`}
                   >
                     {t}
                   </button>
                 ))}
             </div>

             {tab === 'general' && (
                <>
                    <Input label="Weergavenaam" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})} />
                    <div><label className="block text-sm font-medium mb-1 dark:text-slate-300">Bio</label><textarea className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white h-24" value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} /></div>
                    
                    <div className="border-t pt-6">
                        <h4 className="font-bold mb-4 dark:text-white">Connecties</h4>
                        <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Agency (Naam)</label>
                            <input className="w-full p-3 rounded-xl border mb-2 dark:bg-slate-800 dark:text-white" placeholder="Typ naam..." value={agencySearch || formData.linkedAgencyName} onChange={e => { setAgencySearch(e.target.value); setFormData({...formData, linkedAgencyName: e.target.value, linkedAgencyId: ''}); }} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Bedrijf (Naam)</label>
                            <input className="w-full p-3 rounded-xl border mb-2 dark:bg-slate-800 dark:text-white" placeholder="Typ naam..." value={formData.linkedCompanyName} onChange={e => setFormData({...formData, linkedCompanyName: e.target.value, linkedCompanyId: ''})} />
                        </div>
                        </div>
                    </div>
                </>
             )}

             {tab === 'triggers' && (
               <div className="space-y-4">
                 <div>
                   <h4 className="font-bold text-slate-800 dark:text-white">Trigger voorkeuren</h4>
                   <p className="text-sm text-slate-500 dark:text-slate-400">Beheer per trigger hoe de feed het toont.</p>
                 </div>
                 <div className="space-y-3">
                   {TRIGGERS.map((trigger) => (
                     <div key={trigger.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                       <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{trigger.label}</p>
                       <div className="flex flex-wrap gap-2">
                         {TRIGGER_PREFERENCE_OPTIONS.map((opt) => (
                           <button
                             type="button"
                             key={opt.id}
                             onClick={() =>
                               setFormData((prev) => ({
                                 ...prev,
                                 preferences: {
                                   ...prev.preferences,
                                   triggerVisibility: {
                                     ...prev.preferences?.triggerVisibility,
                                     [trigger.id]: opt.id,
                                   },
                                 },
                               }))
                             }
                             className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                               (formData.preferences?.triggerVisibility?.[trigger.id] || 'cover') === opt.id
                                 ? 'bg-blue-600 text-white border-blue-600'
                                 : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                             }`}
                           >
                             {opt.label}
                           </button>
                         ))}
                       </div>
                     </div>
                   ))}
                 </div>
               </div>
             )}

             {/* Placeholder for other tabs logic to keep file size manageable but show structure */}
             {tab === 'rollen' && <div><p className="text-sm text-slate-500">Rol selectie hier...</p></div>}
          </div>
          <div className="p-6 border-t flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Annuleren</Button><Button onClick={handleSave}>Opslaan</Button></div>
       </div>
    </div>
  );
}

function CommunityList({ setView }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <div><h2 className="text-2xl font-bold dark:text-white">Community</h2></div>
        <Button variant="secondary" className="px-4 py-2 text-sm h-10">Chat</Button>
      </div>

      <div className="mb-8 cursor-pointer" onClick={() => setView('challenge_detail')}>
         <div className="bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/20 p-6 rounded-2xl border border-amber-200 dark:border-amber-800/30 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
            <div>
               <h3 className="font-bold text-amber-900 dark:text-amber-400 text-lg mb-1 flex items-center gap-2"><Star className="w-5 h-5 fill-amber-500 text-amber-500" /> Weekly Challenge</h3>
               <p className="text-sm text-amber-800 dark:text-amber-200/80 mb-0">Thema: &quot;Shadow Play&quot;</p>
            </div>
            <Button className="bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20" asChild>Doe mee</Button>
         </div>
      </div>

      <div className="space-y-4">
        {COMMUNITIES.map(comm => {
          const Icon = comm.icon;
          return (
            <div key={comm.id} className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex gap-6 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setView(`community_${comm.id}`)}>
              <div className="w-12 h-12 bg-blue-50 dark:bg-slate-700 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0"><Icon className="w-6 h-6" /></div>
              <div><h3 className="font-bold text-lg dark:text-white mb-1">{comm.title}</h3><p className="text-slate-600 dark:text-slate-400 text-sm">{comm.desc}</p></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommunityDetail({ id, setView }) { return <div className="p-6"><Button onClick={() => setView('community')}>Terug</Button> Community Detail voor {id}</div> }
function ChallengeDetail({ setView, posts, onPostClick }) {
   return (
      <div className="max-w-4xl mx-auto px-4 py-6">
         <button onClick={() => setView('community')} className="flex items-center text-slate-500 hover:text-slate-800 mb-6 font-medium"><ChevronLeft className="w-4 h-4 mr-1"/> Terug</button>
         <div className="bg-amber-100 dark:bg-amber-900/20 p-8 rounded-3xl border border-amber-200 dark:border-amber-800 mb-8 text-center relative overflow-hidden">
            <h1 className="text-4xl font-bold text-amber-900 dark:text-amber-100 mb-2">Shadow Play</h1>
         </div>
         <div className="grid grid-cols-2 md:grid-cols-3 gap-1 md:gap-4">
            {posts.map(post => (<div key={post.id} onClick={() => onPostClick(post)} className="aspect-square bg-slate-200 rounded-lg overflow-hidden cursor-pointer"><img src={post.imageUrl} className="w-full h-full object-cover" /></div>))}
         </div>
      </div>
   );
}

function FetchedProfile({ userId, posts, onPostClick, allUsers }) {
  const [fetchedUser, setFetchedUser] = useState(null);
  useEffect(() => {
    const existing = allUsers.find(u => u.uid === userId);
    if (existing) {
      setFetchedUser(normalizeProfileData(existing, userId));
    }
    fetchUserIndex(userId).then((data) => {
      if (data) {
        setFetchedUser(normalizeProfileData(data, userId));
      }
    });
  }, [userId, allUsers]);
  if (!fetchedUser) return <div>Loading...</div>;
  return <ImmersiveProfile profile={fetchedUser} isOwn={false} posts={posts.filter(p => p.authorId === userId)} onPostClick={onPostClick} allUsers={allUsers} />;
}
function PhotoDetailModal({ post, onClose }) { return <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-10"><img src={post.imageUrl} className="max-h-full" /><button onClick={onClose} className="absolute top-4 right-4 text-white"><X/></button></div> }
function UserPreviewModal({ userId, onClose, onFullProfile, posts, allUsers }) {
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    const existing = allUsers.find((u) => u.uid === userId);
    if (existing) {
      setUserProfile(normalizeProfileData(existing, userId));
    }
    fetchUserIndex(userId).then((data) => {
      if (data) {
        setUserProfile(normalizeProfileData(data, userId));
      }
    });
  }, [userId, allUsers]);

  if (!userProfile) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 w-full max-w-md text-center shadow-2xl">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-300">Profiel laden...</p>
        </div>
      </div>
    );
  }

  const roles = userProfile.roles || [];
  const themes = userProfile.themes || [];
  const roleLabel = (roleId) => ROLES.find((x) => x.id === roleId)?.label || 'Onbekende rol';
  const userPosts = posts.filter((post) => post.authorId === userId);
  const previewPosts = userPosts.slice(0, 3);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className="bg-white dark:bg-slate-900 rounded-[32px] w-full max-w-4xl shadow-2xl overflow-hidden border border-white/10">
        <div className="relative h-80 w-full">
          <img src={userProfile.avatar} className="w-full h-full object-cover scale-105" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/50 to-black/90" />
          <div className="absolute inset-x-0 bottom-0 p-8 text-white">
            <h2 className="text-4xl font-bold mb-3">{userProfile.displayName}</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {roles.map((role) => (
                <span
                  key={role}
                  className="text-xs font-bold uppercase tracking-widest text-white bg-white/20 px-3 py-1 rounded-full border border-white/30 backdrop-blur"
                >
                  {roleLabel(role)}
                </span>
              ))}
            </div>
            {userProfile.bio && (
              <p className="text-white/80 max-w-2xl text-sm md:text-base leading-relaxed">
                {userProfile.bio}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="absolute top-6 right-6 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-md hover:bg-black/70 transition"
            aria-label="Sluiten"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="flex flex-wrap gap-2">
            {themes.map((theme) => (
              <span key={theme} className={`px-3 py-1 rounded-full text-xs font-semibold border ${getThemeStyle(theme)}`}>
                {theme}
              </span>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Recente posts</h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">{userPosts.length} totaal</span>
            </div>
            {previewPosts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {previewPosts.map((post) => (
                  <div key={post.id} className="bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-hidden">
                    <div className="aspect-[4/5]">
                      <img src={post.imageUrl} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{post.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{post.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-6 text-center text-sm text-slate-500 dark:text-slate-300">
                Nog geen posts om te tonen.
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={onFullProfile} className="flex-1">
              Bekijk volledig profiel <ArrowRight className="w-4 h-4" />
            </Button>
            <Button onClick={() => {}} variant="secondary" className="flex-1">
              Word fan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
function ShadowProfileModal({ name, posts, onClose, onPostClick }) { 
    const shadowPosts = posts.filter(p => p.credits && p.credits.some(c => c.name === name));
    return <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"><div className="bg-slate-900 w-full max-w-4xl h-full rounded-3xl overflow-hidden flex flex-col"><div className="h-64 bg-indigo-900 flex items-center justify-center flex-col text-white"><div className="text-4xl font-bold mb-2">{name}</div><p>Tijdelijk Profiel. Claim dit profiel.</p><button onClick={onClose} className="absolute top-4 right-4"><X/></button></div><div className="flex-1 p-6 overflow-y-auto no-scrollbar"><div className="grid grid-cols-3 gap-2">{shadowPosts.map(p => <div key={p.id} onClick={() => onPostClick(p)} className="aspect-square bg-slate-800"><img src={p.imageUrl} className="w-full h-full object-cover"/></div>)}</div></div></div></div> 
}
function SettingsModal({ onClose }) { 
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
            <div className="bg-white w-80 h-full p-6 flex flex-col gap-6">
                <div className="flex justify-between items-center"><h3 className="font-bold text-xl">Instellingen</h3><button onClick={onClose}><X/></button></div>
                <div className="space-y-4">
                    <h4 className="text-xs uppercase font-bold text-slate-400">Account</h4>
                    <div className="p-3 bg-slate-50 rounded flex justify-between"><span>Meldingen</span><Bell className="w-4 h-4"/></div>
                    <div className="p-3 bg-slate-50 rounded flex justify-between"><span>Privacy</span><Lock className="w-4 h-4"/></div>
                    <h4 className="text-xs uppercase font-bold text-slate-400">Weergave</h4>
                    <div className="p-3 bg-slate-50 rounded flex justify-between"><span>Dark Mode</span><Moon className="w-4 h-4"/></div>
                    <div className="p-3 bg-slate-50 rounded flex justify-between"><span>Taal</span><Globe className="w-4 h-4"/></div>
                    <h4 className="text-xs uppercase font-bold text-slate-400">Overig</h4>
                    <div className="p-3 bg-slate-50 rounded flex justify-between"><span>Support</span><HelpCircle className="w-4 h-4"/></div>
                </div>
            </div>
        </div>
    ) 
}
function WelcomeTour({ onClose, setView }) {
  const [step, setStep] = useState(0);
  const steps = [
    { title: 'Welkom bij Artes!', desc: 'Dit is een demoversie. Feedback is welkom via Instagram @maraeliza.portfolio.', icon: Info, action: null },
    { title: 'De Galerij', desc: 'Hier vind je inspirerend werk van mensen die je volgt.', icon: ImageIcon, action: 'gallery' },
    { title: 'Ontdekken', desc: 'Zoek nieuwe makers, ideeën en connecties.', icon: Search, action: 'discover' },
    { title: 'Community', desc: 'Praat mee over veiligheid, techniek en samenwerkingen.', icon: Users, action: 'community' },
    { title: 'Jouw Portfolio', desc: 'Je visitekaartje. Beheer je werk en connecties.', icon: User, action: 'profile' },
  ];

  useEffect(() => {
     if(steps[step].action) setView(steps[step].action);
  }, [step]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
       <div className="bg-white dark:bg-slate-900 max-w-sm w-full rounded-3xl p-8 shadow-2xl relative text-center">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-600 dark:text-blue-400">
             <Star className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-3 dark:text-white">{steps[step].title}</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-8">{steps[step].desc}</p>
          
          {step < steps.length - 1 ? (
             <div className="flex gap-3">
               <Button onClick={() => setStep(step + 1)} className="w-full">Volgende</Button>
             </div>
          ) : (
             <div className="flex gap-3 flex-col">
                <div className="flex gap-3">
                   <Button variant="ghost" onClick={() => setStep(0)} className="flex-1">Herhaal Tour</Button>
                   <Button onClick={onClose} className="flex-1">Begrepen</Button>
                </div>
                <p className="text-xs text-slate-400 mt-2">Veel plezier met Artes!</p>
             </div>
          )}
          
          <div className="flex justify-center gap-2 mt-6">
             {steps.map((_, i) => <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'}`} />)}
          </div>
       </div>
    </div>
  );
}
