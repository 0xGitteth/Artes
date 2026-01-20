import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Image as ImageIcon, Search, Users, Plus, Hand, Cloud, Bookmark,
  Settings, LogOut, Shield, Camera, Handshake, ChevronLeft,
  X, AlertTriangle, AlertOctagon, UserPlus, Link as LinkIcon,
  Maximize2, Share2, MoreHorizontal, LayoutGrid, User, CheckCircle,
  Briefcase, Building2, Star, Edit3, Moon, Sun, ArrowRight, Info, ExternalLink, Trash2, MapPin, Bell, Lock, HelpCircle, Mail, Globe, Loader2, MessageCircle
} from 'lucide-react';
import {
  fetchUserIndex,
  publishPost,
  seedDemoContent,
  subscribeToPosts,
  subscribeToUsers,
  updatePost,
  deletePost,
} from './services/firebaseClient';
import {
  ensureUserProfile,
  fetchUserProfile,
  handleAuthRedirectResult,
  initAuth,
  loginWithEmail,
  logout as firebaseLogout,
  migrateArtifactsUserData,
  observeAuth,
  reloadCurrentUser,
  registerWithEmail,
  resendVerificationEmail,
  signInWithApple,
  signInWithGoogle,
  updateUserProfile,
  getFirebaseDbInstance,
  isModerator,
} from './firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import ChatPanel from './components/ChatPanel';
import ModerationSupportChat from './components/ModerationSupportChat';
import SupportLanding from './components/SupportLanding';

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

const MODERATION_REASON_PRESETS = [
  { id: 'explicitSexAct', label: 'Expliciete seksuele handelingen' },
  { id: 'sexualViolence', label: 'Seksueel geweld of dwang' },
  { id: 'minorSexualContext', label: 'Minderjarigen in seksuele context of mogelijk minderjarig' },
  { id: 'activeSelfHarm', label: 'Actieve zelfbeschadiging of suïcide handeling' },
  { id: 'proAnaBodyCheck', label: 'Schadelijke eetstoornis content pro ana body check' },
  { id: 'graphicGore', label: 'Grafische gore of schokkend letsel' },
  { id: 'missingOrIncorrectTags', label: 'Triggers ontbreken of kloppen niet' },
  { id: 'tooExplicitForPlatform', label: 'Te expliciet voor Artes' },
];

const buildDecisionTemplate = (decision, reasons) => {
  if (decision === 'approved') {
    if (reasons.includes('missingOrIncorrectTags')) {
      return 'Je foto is gecontroleerd en goedgekeurd. We hebben wel extra trigger tags nodig zodat kijkers kunnen kiezen wat ze zien.';
    }
    return 'Je foto is gecontroleerd en goedgekeurd. Bedankt voor het labelen.';
  }
  if (reasons.includes('minorSexualContext')) {
    return 'Je foto kunnen we niet toestaan vanwege veiligheidsbeleid. Als je denkt dat dit een vergissing is, neem dan contact op met Artes Moderatie via de chatfunctie';
  }
  return 'Je foto kunnen we niet toestaan omdat hij valt onder verboden inhoud volgens onze regels. Je kunt een andere versie uploaden die niet onder deze categorie valt.';
};

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
  // Profile expectations:
  // avatar: string (data URL or https) for the profile avatar.
  // headerImage: string (data URL or https) for header/hero usage.
  // headerPosition: CSS object-position value for headerImage (e.g. "center", "top").
  // quickProfilePreviewMode: "latest" | "best" | "manual".
  // quickProfilePostIds: array of post IDs to preview when mode is "manual".
  const seed = profileData?.uid || profileData?.displayName || fallbackSeed;
  const roles = Array.isArray(profileData?.roles) && profileData.roles.length ? profileData.roles : ['fan'];
  const themes = Array.isArray(profileData?.themes) && profileData.themes.length ? profileData.themes : ['General'];
  const triggerVisibility = normalizeTriggerPreferences(profileData?.preferences?.triggerVisibility);
  const themePreference = profileData?.preferences?.theme || 'light';
  const quickProfilePreviewMode = ['latest', 'best', 'manual'].includes(profileData?.quickProfilePreviewMode)
    ? profileData.quickProfilePreviewMode
    : 'latest';
  const quickProfilePostIds = Array.isArray(profileData?.quickProfilePostIds)
    ? profileData.quickProfilePostIds.filter(Boolean)
    : [];

  return {
    ...profileData,
    uid: profileData?.uid ?? null,
    displayName: profileData?.displayName || 'Onbekende maker',
    bio: profileData?.bio || 'Nog geen bio toegevoegd.',
    roles,
    themes,
    avatar: profileData?.avatar || buildDefaultAvatar(seed),
    headerImage: profileData?.headerImage || '',
    headerPosition: profileData?.headerPosition || 'center',
    quickProfilePreviewMode,
    quickProfilePostIds,
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
  const [profileLoading, setProfileLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [verificationNote, setVerificationNote] = useState(null);
  const [verificationPending, setVerificationPending] = useState(false);
  
  // Modals & States
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [quickProfileId, setQuickProfileId] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [shadowProfileName, setShadowProfileName] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [moderationModal, setModerationModal] = useState(null);
  const [moderationActionPending, setModerationActionPending] = useState(false);
  const [moderatorAccess, setModeratorAccess] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [supportThreadId, setSupportThreadId] = useState(null);

  // Data
  const [posts, setPosts] = useState([]);
  const [users, setUsers] = useState([]);
  const moderationApiBase = useMemo(() => {
    const explicitBase = import.meta.env.VITE_MODERATION_API_BASE;
    if (explicitBase) return explicitBase;
    const moderationUrl = import.meta.env.VITE_MODERATION_FUNCTION_URL;
    if (moderationUrl && moderationUrl.includes('/moderateImage')) {
      return moderationUrl.replace('/moderateImage', '');
    }
    return moderationUrl || '';
  }, []);
  const functionsBase = useMemo(() => {
    const explicitBase = import.meta.env.VITE_FUNCTIONS_BASE;
    if (explicitBase) return explicitBase;
    const moderationUrl = import.meta.env.VITE_MODERATION_FUNCTION_URL;
    if (moderationUrl && moderationUrl.includes('/moderateImage')) {
      return moderationUrl.replace('/moderateImage', '');
    }
    return moderationUrl || '';
  }, []);
  const ensureModerationThread = useCallback(async (user) => {
    if (!user?.uid || !functionsBase) return null;
    const token = await user.getIdToken();
    const response = await fetch(`${functionsBase}/ensureModerationThread`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error('Failed to ensure moderation thread');
    }
    const data = await response.json();
    return data?.threadId || `moderation_${user.uid}`;
  }, [functionsBase]);

  const handleDeleteOnboardingAccount = useCallback(async () => {
    if (!authUser?.uid) {
      throw new Error('Geen account gevonden om te verwijderen.');
    }
    if (!functionsBase) {
      throw new Error('Account verwijderen is momenteel niet beschikbaar.');
    }
    const token = await authUser.getIdToken();
    const response = await fetch(`${functionsBase}/deleteOnboardingAccount`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || 'Account verwijderen is mislukt.');
    }
    await firebaseLogout();
    setProfile(null);
    setView('login');
    setToastMessage('Account verwijderd.');
  }, [authUser, functionsBase]);

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
      setProfileLoading(true);
      setView('loading');
      setUser(u);
      setAuthUser(u);
      if (!u) {
        setProfile(null);
        const path = window.location.pathname || '/';
        const unauthView = path.startsWith('/support')
          ? 'support'
          : path.startsWith('/chat') || path.startsWith('/messages')
            ? 'chat'
            : 'login';
        setView(unauthView);
        setProfileLoading(false);
        return;
      }
      try {
        await migrateArtifactsUserData(u);
        const profileData = await ensureUserProfile(u);
        const normalized = normalizeProfileData(profileData, u.uid);
        setProfile(normalized);
        const onboardingComplete = profileData?.onboardingComplete === true;
        const baseView = onboardingComplete ? 'gallery' : 'onboarding';
        const path = window.location.pathname || '/';
        const routedView = path.startsWith('/moderation')
          ? 'moderation'
          : path.startsWith('/support')
            ? 'support'
            : path.startsWith('/chat') || path.startsWith('/messages')
              ? 'chat'
              : baseView;
        setView(routedView);
        ensureModerationThread(u).catch((error) => {
          console.error('Failed to ensure support thread', error);
        });
      } catch (e) {
        console.error('Failed to load profile', e);
        setView('onboarding');
      } finally {
        setProfileLoading(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [ensureModerationThread]);

  useEffect(() => {
    if (!profile?.preferences?.theme) return;
    setDarkMode(profile.preferences.theme === 'dark');
  }, [profile?.preferences?.theme]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname || '/';
      if (path.startsWith('/moderation')) {
        setView('moderation');
      } else if (path.startsWith('/support')) {
        setView('support');
      } else if (path.startsWith('/chat') || path.startsWith('/messages')) {
        setView('chat');
      } else if (view === 'moderation' || view === 'support' || view === 'chat') {
        setView('gallery');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [view]);

  useEffect(() => {
    if (view === 'moderation') {
      window.history.pushState({}, '', '/moderation');
    } else if (view === 'support') {
      window.history.pushState({}, '', '/support');
    } else if (view === 'chat') {
      const params = new URLSearchParams(window.location.search);
      const existingThreadId = params.get('threadId');
      const openTarget = params.get('open');
      const threadId = supportThreadId || existingThreadId;
      const queryParams = new URLSearchParams();
      if (threadId) {
        queryParams.set('threadId', threadId);
      } else if (openTarget) {
        queryParams.set('open', openTarget);
      }
      const query = queryParams.toString();
      window.history.pushState({}, '', `/chat${query ? `?${query}` : ''}`);
    } else if (
      window.location.pathname === '/moderation'
      || window.location.pathname === '/chat'
      || window.location.pathname === '/messages'
      || window.location.pathname === '/support'
    ) {
      window.history.pushState({}, '', '/');
    }
  }, [view, supportThreadId]);

  // Data Listeners
  useEffect(() => {
     if (!user) return;
     const unsubPosts = subscribeToPosts(setPosts);
     const unsubUsers = subscribeToUsers(setUsers);
     return () => { unsubPosts(); unsubUsers(); };
  }, [user]);

  useEffect(() => {
    if (!authUser?.uid) return;
    const db = getFirebaseDbInstance();
    const q = query(
      collection(db, 'uploads'),
      where('userId', '==', authUser.uid),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snapshot) => {
      setUploads(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid) return;
    const db = getFirebaseDbInstance();
    const threadId = `moderation_${authUser.uid}`;
    const messagesRef = collection(db, 'threads', threadId, 'messages');
    const q = query(messagesRef, where('unread', '==', true), orderBy('createdAt', 'desc'), limit(1));
    return onSnapshot(q, (snapshot) => {
      if (snapshot.empty) return;
      const docSnap = snapshot.docs[0];
      if (moderationModal?.id === docSnap.id) return;
      setModerationModal({ id: docSnap.id, ...docSnap.data() });
    });
  }, [authUser?.uid, moderationModal?.id]);

  useEffect(() => {
    if (view !== 'chat') return;
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get('threadId');
    if (threadId) {
      setSupportThreadId(threadId);
    }
  }, [view]);

  useEffect(() => {
    if (view !== 'chat') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('open') !== 'moderation') return;
    if (!authUser?.uid || !functionsBase) return;
    let active = true;
    ensureModerationThread(authUser)
      .then((threadId) => {
        if (!active) return;
        setSupportThreadId(threadId || `moderation_${authUser.uid}`);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to ensure moderation thread', error);
        setToastMessage('Support chat openen is mislukt.');
      });
    return () => {
      active = false;
    };
  }, [view, authUser, functionsBase, ensureModerationThread]);

  useEffect(() => {
    if (!authUser) {
      setModeratorAccess(false);
      return;
    }
    let active = true;
    setModeratorAccess(null);
    isModerator(authUser)
      .then((result) => {
        if (!active) return;
        setModeratorAccess(result);
      })
      .catch(() => {
        if (!active) return;
        setModeratorAccess(false);
      });
    return () => {
      active = false;
    };
  }, [authUser?.uid, authUser?.email]);

  useEffect(() => {
    if (view !== 'moderation' || profileLoading) return;
    if (moderatorAccess === false) {
      setView('gallery');
      setToastMessage('Geen toegang');
    }
  }, [view, profileLoading, moderatorAccess]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

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

  const handleOpenSupportChat = () => {
    if (!authUser?.uid || !functionsBase) {
      setToastMessage('Support chat is momenteel niet beschikbaar.');
      return;
    }
    const fallbackThreadId = `moderation_${authUser.uid}`;
    setSupportThreadId(fallbackThreadId);
    setView('chat');
    ensureModerationThread(authUser)
      .then((threadId) => {
        if (threadId) {
          setSupportThreadId(threadId);
        }
      })
      .catch((error) => {
        console.error('Failed to ensure moderation thread', error);
      });
  };

  const handleToggleDarkMode = async () => {
    const nextTheme = darkMode ? 'light' : 'dark';
    setDarkMode(nextTheme === 'dark');
    const nextPreferences = {
      ...profile?.preferences,
      triggerVisibility: normalizeTriggerPreferences(profile?.preferences?.triggerVisibility),
      theme: nextTheme,
    };
    setProfile((prev) => (prev ? { ...prev, preferences: nextPreferences } : prev));
    setToastMessage(`Thema ingesteld op ${nextTheme === 'dark' ? 'donker' : 'licht'}.`);

    if (!authUser?.uid) return;
    try {
      await updateUserProfile(authUser.uid, { preferences: nextPreferences });
    } catch (error) {
      console.error('Failed to update theme preference', error);
      setToastMessage('Opslaan van het thema is mislukt. Probeer het opnieuw.');
    }
  };

  const canUpload = profile && (!profile.roles.includes('fan') || profile.roles.length > 1);
  const requiresEmailVerification = useMemo(() => {
    if (!authUser) return false;
    const usesPasswordProvider = authUser?.providerData?.some((provider) => provider?.providerId === 'password');
    return usesPasswordProvider && !authUser.emailVerified;
  }, [authUser]);

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
      if (import.meta.env.VITE_ENABLE_EMAIL_SIGNIN === 'false') {
        throw new Error('Email signup staat uitgeschakeld.');
      }
      const user = await registerWithEmail(email, password, displayName);
      await ensureUserProfile(user);
      return user;
    } catch (e) {
      setAuthError(e.message);
      throw e;
    } finally {
      setAuthPending(false);
    }
  };

  const handleCompleteProfile = async (profileData, roles) => {
    const themes = Array.isArray(profileData.themes) && profileData.themes.length ? profileData.themes : ['General'];
    const finalProfile = {
      uid: authUser?.uid,
      displayName: profileData.displayName || 'Nieuwe Maker',
      bio: profileData.bio,
      roles,
      themes,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authUser?.uid || 'artes'}`,
      linkedAgencyName: profileData.linkedAgencyName,
      linkedCompanyName: profileData.linkedCompanyName,
      onboardingComplete: true,
      onboardingStep: 5,
      preferences: {
        ...profileData.preferences,
        triggerVisibility: normalizeTriggerPreferences(profileData.preferences?.triggerVisibility),
        theme: profileData.preferences?.theme || 'light',
      },
    };
      if (authUser?.uid) {
        await updateUserProfile(authUser.uid, finalProfile);
      }
    const normalized = normalizeProfileData(finalProfile, authUser?.uid);
    setProfile(normalized);
    setDarkMode(finalProfile?.preferences?.theme === 'dark');
    setView('gallery');
    setShowTour(true);
  };

  const handleResendVerification = async () => {
    try {
      setVerificationPending(true);
      setVerificationNote(null);
      await resendVerificationEmail();
      setVerificationNote('Verificatiemail opnieuw verstuurd.');
    } catch (error) {
      console.error('Failed to resend verification email', error);
      setVerificationNote('Er ging iets mis, probeer het opnieuw.');
    } finally {
      setVerificationPending(false);
    }
  };

  const handleRefreshVerification = async () => {
    try {
      setVerificationPending(true);
      setVerificationNote(null);
      const refreshed = await reloadCurrentUser();
      setAuthUser(refreshed);
      setUser(refreshed);
      if (!refreshed?.emailVerified) {
        setVerificationNote('Je email is nog niet geverifieerd.');
        return;
      }
      const profileData = await ensureUserProfile(refreshed);
      const normalized = normalizeProfileData(profileData, refreshed?.uid);
      setProfile(normalized);
      const onboardingComplete = profileData?.onboardingComplete === true;
      setView(onboardingComplete ? 'gallery' : 'onboarding');
    } catch (error) {
      console.error('Failed to refresh verification state', error);
      setVerificationNote('Er ging iets mis, probeer het opnieuw.');
    } finally {
      setVerificationPending(false);
    }
  };

  const handleVerificationLogout = async () => {
    await firebaseLogout();
    setProfile(null);
    setAuthUser(null);
    setUser(null);
    setView('login');
  };

  const handleSettingsLogout = async () => {
    await firebaseLogout();
    setProfile(null);
    setAuthUser(null);
    setUser(null);
    setShowSettingsModal(false);
    setView('login');
  };

  const handleModerationAction = async (action) => {
    if (!moderationModal || !authUser || !moderationApiBase) return;
    setModerationActionPending(true);
    try {
      const uploadId = moderationModal?.metadata?.uploadId || moderationModal?.uploadId;
      if (!uploadId) throw new Error('Geen upload gevonden.');
      const token = await authUser.getIdToken();
      const response = await fetch(`${moderationApiBase}/userModerationAction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messageId: moderationModal.id,
          uploadId,
          action,
        }),
      });
      if (!response.ok) {
        throw new Error('Moderatie actie mislukt.');
      }
      setModerationModal(null);
    } catch (error) {
      console.error('Moderation action failed', error);
    } finally {
      setModerationActionPending(false);
    }
  };

  if (requiresEmailVerification) {
    return (
      <div className={`${darkMode ? 'dark' : ''} h-screen w-full flex flex-col transition-colors duration-300`}>
        <div className="flex-1 bg-[#F0F4F8] dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-white dark:bg-slate-800 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-700 p-10 text-center space-y-6">
            <div className="w-16 h-16 bg-blue-600/10 text-blue-600 rounded-2xl flex items-center justify-center mx-auto">
              <Mail className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-2">Email verificatie nodig</h1>
              <p className="text-slate-600 dark:text-slate-300">
                We hebben een verificatiemail gestuurd. Check je inbox en spam.
              </p>
            </div>
            {verificationNote && (
              <p className="text-sm text-blue-600 dark:text-blue-300">{verificationNote}</p>
            )}
            <div className="space-y-3">
              <Button
                className="w-full"
                onClick={handleResendVerification}
                disabled={verificationPending}
              >
                Opnieuw verificatiemail sturen
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleRefreshVerification}
                disabled={verificationPending}
              >
                Ik heb geverifieerd
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={handleVerificationLogout}
                disabled={verificationPending}
              >
                Uitloggen
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
             onOpenSettings={() => setShowSettingsModal(true)}
          />
        )}

        <main className="h-full overflow-y-auto pb-24 pt-16 scroll-smooth">
          {(view === 'loading' || profileLoading) && (
            <div className="h-full flex items-center justify-center">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
          
          {!profileLoading && view === 'login' && (
            <LoginScreen setView={setView} onLogin={handleLogin} error={authError} loading={authPending} />
          )}

          {!profileLoading && view === 'onboarding' && (
            <Onboarding
              setView={setView}
              users={users}
              onSignup={handleSignup}
              onCompleteProfile={handleCompleteProfile}
              onDeclineDidit={handleDeleteOnboardingAccount}
              authUser={authUser}
              authError={authError}
              profile={profile}
            />
          )}
          
          {!profileLoading && view === 'gallery' && (
            <Gallery 
              posts={posts} 
              onUserClick={setQuickProfileId}
              onShadowClick={setShadowProfileName}
              onPostClick={setSelectedPost}
              onChallengeClick={() => setView('challenge_detail')}
              profile={profile}
            />
          )}

          {!profileLoading && view === 'moderation' && (
            <ModerationPortal
              moderationApiBase={moderationApiBase}
              authUser={authUser}
              isModerator={moderatorAccess}
              uploads={uploads}
              moderationModal={moderationModal}
              moderationActionPending={moderationActionPending}
              onModerationAction={handleModerationAction}
              onCloseModerationModal={() => handleModerationAction('dismiss')}
            />
          )}

          {!profileLoading && view === 'discover' && (
            <Discover users={users} posts={posts} onUserClick={setQuickProfileId} onPostClick={setSelectedPost} setView={setView} />
          )}
          
          {!profileLoading && view === 'community' && <CommunityList setView={setView} />}
          {!profileLoading && view === 'support' && (
            <SupportLanding onOpenChat={handleOpenSupportChat} canOpenChat={Boolean(authUser)} />
          )}
          {!profileLoading && view === 'chat' && (
            authUser ? (
              <div className="max-w-6xl mx-auto px-4 py-6 h-[75vh]">
                <ChatPanel authUser={authUser} functionsBase={functionsBase} initialThreadId={supportThreadId} />
              </div>
            ) : (
              <div className="max-w-2xl mx-auto px-4 py-6">
                <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
                  Log in om de chat te openen.
                </div>
              </div>
            )
          )}
          {!profileLoading && view === 'challenge_detail' && (
            <ChallengeDetail setView={setView} posts={posts.filter(p => p.isChallenge)} onPostClick={setSelectedPost} />
          )}
          
          {!profileLoading && view.startsWith('community_') && (
            <CommunityDetail id={view.split('_')[1]} setView={setView} authUser={authUser} functionsBase={functionsBase} />
          )}

          {/* Wrapper logic for viewing profiles */}
          {!profileLoading && view === 'profile' && (
            <ImmersiveProfile 
              profile={profile} 
              isOwn={true} 
              posts={posts.filter(p => p.authorId === user?.uid)}
              onOpenSettings={() => setShowEditProfile(true)}
              onPostClick={setSelectedPost}
              allUsers={users}
            />
          )}
          
          {!profileLoading && view.startsWith('profile_') && (
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
        {showSettingsModal && (
          <SettingsModal
            onClose={() => setShowSettingsModal(false)}
            moderatorAccess={moderatorAccess}
            onOpenModeration={() => {
              setShowSettingsModal(false);
              setView('moderation');
            }}
            onOpenSupport={() => {
              setShowSettingsModal(false);
              setView('support');
            }}
            darkMode={darkMode}
            onToggleDark={handleToggleDarkMode}
            onLogout={handleSettingsLogout}
          />
        )}
        {showEditProfile && (
          <EditProfileModal
            onClose={() => setShowEditProfile(false)}
            profile={profile}
            user={user}
            posts={posts}
            onOpenQuickProfile={() => setQuickProfileId(user?.uid || null)}
          />
        )}
        {showTour && <WelcomeTour onClose={handleTourComplete} setView={setView} />}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
            {toastMessage}
          </div>
        )}
        
        {quickProfileId && (
          <UserPreviewModal
            userId={quickProfileId}
            onClose={() => setQuickProfileId(null)}
            onFullProfile={() => { setView(`profile_${quickProfileId}`); setQuickProfileId(null); }}
            posts={posts}
            allUsers={users}
          />
        )}
        {selectedPost && (
          <PhotoDetailModal
            post={selectedPost}
            allPosts={posts}
            onClose={() => setSelectedPost(null)}
            onUserClick={setQuickProfileId}
            authUser={authUser}
            moderationApiBase={moderationApiBase}
          />
        )}
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
             <Button
               variant="secondary"
               className="w-full"
               disabled={!enableEmail}
               onClick={() => {
                 if (!enableEmail) {
                   setLocalError('Email signup staat nog uit.');
                   return;
                 }
                 setView('onboarding');
               }}
             >
               Account aanmaken
             </Button>
          </div>
       </div>
    </div>
  );
}

function Onboarding({ setView, users, onSignup, onCompleteProfile, onDeclineDidit, authUser, authError, profile }) {
    const [step, setStep] = useState(() => Math.max(1, profile?.onboardingStep ?? 1));
    const [roles, setRoles] = useState([]);
    const [profileData, setProfileData] = useState(() => ({
       displayName: profile?.displayName || '',
       bio: profile?.bio || '',
       insta: '',
       linkedAgencyName: profile?.linkedAgencyName || '',
       linkedCompanyName: profile?.linkedCompanyName || '',
       themes: Array.isArray(profile?.themes) ? profile.themes : [],
       preferences: {
         triggerVisibility: normalizeTriggerPreferences(),
         theme: profile?.preferences?.theme || 'light',
       },
    }));
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [accountCreated, setAccountCreated] = useState(!!authUser);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const [diditPending, setDiditPending] = useState(false);
    const [diditError, setDiditError] = useState(null);
    const [syncedGoogleProfile, setSyncedGoogleProfile] = useState(false);
    const enableEmail = import.meta.env.VITE_ENABLE_EMAIL_SIGNIN !== 'false';
    const isGoogleUser = authUser?.providerData?.some((provider) => provider?.providerId === 'google.com')
      || profile?.authProvider === 'google.com';

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

    useEffect(() => {
      if (profile?.onboardingStep && profile.onboardingStep > step) {
        setStep(profile.onboardingStep);
      }
    }, [profile?.onboardingStep, step]);

    useEffect(() => {
      if (!authUser) return;
      setEmail(authUser.email || '');
      if (authUser.displayName) {
        setProfileData((prev) => ({ ...prev, displayName: authUser.displayName }));
      }
    }, [authUser]);

    useEffect(() => {
      if (!isGoogleUser || !authUser?.uid || syncedGoogleProfile) return;
      setAccountCreated(true);
      setStep((prev) => (prev < 2 ? 2 : prev));
      updateUserProfile(authUser.uid, {
        onboardingStep: 2,
        onboardingComplete: false,
        displayName: authUser.displayName || profileData.displayName || 'Artes gebruiker',
        email: authUser.email ?? null,
        authProvider: 'google.com',
      }).catch((e) => console.error('Failed to sync Google profile', e));
      setSyncedGoogleProfile(true);
    }, [isGoogleUser, authUser?.uid, authUser?.displayName, authUser?.email, profileData.displayName, syncedGoogleProfile]);

    if (!enableEmail && !authUser) {
      return (
        <div className="max-w-md mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
          <h2 className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-1">Signup uitgeschakeld</h2>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Email accounts zijn niet beschikbaar</h1>
          <p className="text-slate-600 dark:text-slate-400 mb-8">
            Email signup staat op dit moment uit. Log in met een sociale provider of probeer het later opnieuw.
          </p>
          <Button className="w-full" onClick={() => setView('login')}>Terug naar inloggen</Button>
        </div>
      );
    }

    if (step === 1 && isGoogleUser) {
      return (
        <div className="max-w-md mx-auto py-12 px-4 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      );
    }

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
                if (!enableEmail && !accountCreated) {
                  throw new Error('Email signup staat uitgeschakeld.');
                }
                let createdUser = authUser;
                if (!accountCreated) {
                  createdUser = await onSignup?.(email, password, profileData.displayName);
                  setAccountCreated(true);
                }
                const uid = createdUser?.uid || authUser?.uid;
                if (uid) {
                  await updateUserProfile(uid, {
                    onboardingStep: 2,
                    onboardingComplete: false,
                    displayName: profileData.displayName || createdUser?.displayName || 'Nieuwe Maker',
                    email: createdUser?.email || email,
                    authProvider: 'password',
                  });
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
           {diditError && <p className="text-sm text-red-500">{diditError}</p>}
           <div className="flex flex-col gap-3">
             <Button onClick={() => setStep(3)} className="w-full" disabled={diditPending}>Start Didit Verificatie</Button>
             <Button
               variant="danger"
               onClick={async () => {
                 if (!window.confirm('Weet je zeker dat je niet akkoord gaat? Je account wordt verwijderd.')) return;
                 try {
                   setDiditPending(true);
                   setDiditError(null);
                   await onDeclineDidit?.();
                 } catch (e) {
                   setDiditError(e.message || 'Account verwijderen is mislukt.');
                 } finally {
                   setDiditPending(false);
                 }
               }}
               className="w-full"
               disabled={diditPending}
             >
               Niet akkoord, verwijder mijn account
             </Button>
           </div>
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
          <div>
            <label className="block text-sm font-medium mb-2 dark:text-slate-300">Thema&apos;s</label>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto no-scrollbar">
              {THEMES.map((theme) => {
                const isSelected = profileData.themes?.includes(theme);
                return (
                  <button
                    key={theme}
                    type="button"
                    onClick={() =>
                      setProfileData((prev) => {
                        const prevThemes = prev.themes || [];
                        return {
                          ...prev,
                          themes: prevThemes.includes(theme)
                            ? prevThemes.filter((item) => item !== theme)
                            : [...prevThemes, theme],
                        };
                      })
                    }
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${getThemeStyle(theme)} ${
                      isSelected ? 'ring-2 ring-blue-500' : ''
                    }`}
                  >
                    {theme}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-3 mt-4">
            <Button className="w-full" onClick={() => setStep(5)}>Volgende</Button>
            <Button variant="secondary" onClick={() => setStep(3)} className="w-full">Terug</Button>
          </div>
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
          <div className="flex flex-col gap-3">
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
            <Button variant="secondary" onClick={() => setStep(4)} className="w-full" disabled={pending}>Terug</Button>
          </div>
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
  const filteredUsers = users.filter((u) => (
    u.displayName.toLowerCase().includes(search.toLowerCase())
    && (!activeRole || u.roles?.includes(activeRole))
    && (activeThemes.length === 0 || u.themes?.some((theme) => activeThemes.includes(theme)))
  ));

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
          <div className="space-y-3 mb-6">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveThemes([])}
                className={`px-4 py-2 rounded-full text-xs font-bold border ${activeThemes.length === 0 ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
              >
                Alle thema&apos;s
              </button>
              {displayedThemes.map((theme) => (
                <button
                  key={theme}
                  onClick={() => toggleTheme(theme)}
                  className={`px-4 py-2 rounded-full text-xs font-bold border transition-all ${activeThemes.includes(theme) ? 'ring-2 ring-blue-500 ' + getThemeStyle(theme) : 'bg-white dark:bg-slate-800 text-slate-500'}`}
                >
                  {theme}
                </button>
              ))}
              <button onClick={() => setShowAllThemes(!showAllThemes)} className="text-xs font-bold text-blue-600 px-4">Toon meer...</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setActiveRole(null)}
                className={`px-4 py-2 rounded-full text-xs font-bold border ${!activeRole ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
              >
                Iedereen
              </button>
              {displayedRoles.map(r => <button key={r.id} onClick={() => setActiveRole(r.id)} className={`px-4 py-2 rounded-full text-xs font-bold border ${activeRole === r.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}>{r.label}</button>)}
              <button onClick={() => setShowAllRoles(!showAllRoles)} className="text-xs font-bold text-blue-600 px-4">Toon meer...</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{filteredUsers.map(u => <div key={u.uid} onClick={() => onUserClick(u.uid)} className="bg-white dark:bg-slate-800 rounded-2xl overflow-hidden shadow-sm cursor-pointer"><div className="aspect-square relative"><img src={u.avatar} className="w-full h-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-3"><span className="text-white font-bold">{u.displayName}</span><span className="text-white/70 text-xs">{ROLES.find(r => r.id === u.roles[0])?.label}</span></div></div></div>)}</div>
       </div>}
    </div>
  );
}

function NavBar({ view, setView, onOpenSettings }) {
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
  const headerImage = normalizedProfile.headerImage || normalizedProfile.avatar;
  const headerPosition = normalizedProfile.headerPosition || 'center';
  const hasAgency = Boolean(agencyName);
  const hasCompany = Boolean(companyName);
  const roleLabel = (roleId) => ROLES.find((x) => x.id === roleId)?.label || 'Onbekende rol';
  return (
     <div className="min-h-screen bg-white dark:bg-slate-900 pb-20">
        <div className="relative h-[520px] w-full overflow-hidden">
           <img
             src={headerImage}
             className="w-full h-full object-cover scale-105"
             style={{ objectPosition: headerPosition }}
           />
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

function ModerationDecisionModal({ message, onClose, onAction, pending }) {
  if (!message) return null;
  const decision = message?.metadata?.decision;
  const reasons = message?.metadata?.reasons || [];
  const isApproved = decision === 'approved';
  const isReport = message?.metadata?.caseType === 'report';
  const canTakeAction = isApproved && !isReport && message?.metadata?.uploadId;
  const title = decision ? (isApproved ? 'Je foto is goedgekeurd' : 'Je foto is niet goedgekeurd') : 'Moderatie-update';
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
          <h3 className="font-bold text-lg dark:text-white">{title}</h3>
          <button onClick={onClose} disabled={pending}><X /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-200">{message.text || message.message}</p>
          {Array.isArray(reasons) && reasons.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {reasons.map((reason) => {
                const label = MODERATION_REASON_PRESETS.find((preset) => preset.id === reason)?.label || reason;
                return (
                  <span key={reason} className="text-[11px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200">
                    {label}
                  </span>
                );
              })}
            </div>
          )}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Je kunt dit bericht terugvinden in de chat Artes Moderatie.
          </p>
        </div>
        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-3 justify-end">
          {canTakeAction ? (
            <>
              <Button variant="secondary" onClick={() => onAction('saveDraft')} disabled={pending}>
                Later plaatsen
              </Button>
              <Button onClick={() => onAction('publishNow')} disabled={pending}>
                Nu plaatsen
              </Button>
            </>
          ) : (
            <Button onClick={() => onAction('dismiss')} disabled={pending}>
              Oké
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function UploadStatusPanel({ uploads = [] }) {
  const renderReviewStatus = (upload) => {
    if (upload.reviewStatus === 'approved') return 'Goedgekeurd';
    if (upload.reviewStatus === 'rejected') return 'Afgekeurd';
    return 'In review';
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold dark:text-white">Upload status</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Moderatie updates verschijnen hier zodra ze beschikbaar zijn.</p>
      </div>
      {uploads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-sm text-slate-500 dark:text-slate-400">
          Nog geen uploads in moderatie.
        </div>
      ) : (
        <div className="space-y-4">
          {uploads.map((upload) => (
            <div key={upload.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold dark:text-white">Upload {upload.id.slice(0, 6)}</p>
                  <p className="text-xs text-slate-500">{renderReviewStatus(upload)}</p>
                </div>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
                  upload.reviewStatus === 'approved'
                    ? 'bg-emerald-100 text-emerald-700'
                    : upload.reviewStatus === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-slate-100 text-slate-600'
                }`}>
                  {renderReviewStatus(upload)}
                </span>
              </div>
              {upload.reviewDecisionMessagePublic && (
                <p className="text-sm text-slate-700 dark:text-slate-200">{upload.reviewDecisionMessagePublic}</p>
              )}
              {Array.isArray(upload.reviewDecisionReasons) && upload.reviewDecisionReasons.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {upload.reviewDecisionReasons.map((reason) => {
                    const label = MODERATION_REASON_PRESETS.find((preset) => preset.id === reason)?.label || reason;
                    return (
                      <span key={reason} className="text-[11px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200">
                        {label}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModerationPanel({ moderationApiBase, authUser, isModerator, caseTypeFilter }) {
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [claimState, setClaimState] = useState({ claimed: false, claimedBy: null, loading: false });
  const [decision, setDecision] = useState('approved');
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [decisionMessage, setDecisionMessage] = useState('');
  const [messageTouched, setMessageTouched] = useState(false);
  const [moderatorNote, setModeratorNote] = useState('');
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState(null);

  useEffect(() => {
    if (!isModerator) return;
    const db = getFirebaseDbInstance();
    const q = query(collection(db, 'reviewCases'), where('status', '==', 'inReview'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setCases(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    });
  }, [isModerator]);

  const filteredCases = useMemo(() => {
    if (caseTypeFilter === 'report') {
      return cases.filter((item) => item.caseType === 'report');
    }
    if (caseTypeFilter === 'upload') {
      return cases.filter((item) => item.caseType !== 'report');
    }
    return cases;
  }, [cases, caseTypeFilter]);

  useEffect(() => {
    if (!selectedCaseId) {
      setSelectedCase(null);
      setSelectedUpload(null);
      return;
    }
    const found = filteredCases.find((item) => item.id === selectedCaseId) || null;
    setSelectedCase(found);
    if (!found) {
      setSelectedCaseId(null);
    }
  }, [selectedCaseId, filteredCases]);

  useEffect(() => {
    if (!selectedCase) {
      setSelectedUpload(null);
      return;
    }
    const uploadId = selectedCase.uploadId || selectedCase.linkedUploadIds?.[0];
    if (!uploadId) {
      setSelectedUpload(null);
      return;
    }
    const db = getFirebaseDbInstance();
    getDoc(doc(db, 'uploads', uploadId))
      .then((snapshot) => {
        if (!snapshot.exists()) {
          setSelectedUpload(null);
        } else {
          setSelectedUpload({ id: snapshot.id, ...snapshot.data() });
        }
      })
      .catch(() => setSelectedUpload(null));
  }, [selectedCase]);

  useEffect(() => {
    if (!selectedCaseId || !authUser || !moderationApiBase) return;
    let active = true;
    const claim = async () => {
      setClaimState((prev) => ({ ...prev, loading: true }));
      try {
        const token = await authUser.getIdToken();
        const response = await fetch(`${moderationApiBase}/moderatorClaim`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reviewCaseId: selectedCaseId }),
        });
        const data = await response.json();
        if (!active) return;
        setClaimState({
          claimed: Boolean(data?.claimed),
          claimedBy: data?.claimedBy || null,
          loading: false,
        });
      } catch (error) {
        if (!active) return;
        setClaimState({ claimed: false, claimedBy: null, loading: false });
      }
    };
    claim();
    return () => {
      active = false;
    };
  }, [selectedCaseId, authUser, moderationApiBase]);

  useEffect(() => {
    if (!selectedCaseId || !claimState.claimed || !authUser || !moderationApiBase) return;
    const interval = setInterval(async () => {
      try {
        const token = await authUser.getIdToken();
        await fetch(`${moderationApiBase}/moderatorClaim`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reviewCaseId: selectedCaseId }),
        });
      } catch (error) {
        console.error('Failed to refresh lock', error);
      }
    }, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedCaseId, claimState.claimed, authUser, moderationApiBase]);

  useEffect(() => {
    return () => {
      if (!selectedCaseId || !authUser || !moderationApiBase) return;
      authUser.getIdToken()
        .then((token) => fetch(`${moderationApiBase}/moderatorRelease`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reviewCaseId: selectedCaseId }),
        }))
        .catch(() => {});
    };
  }, [selectedCaseId, authUser, moderationApiBase]);

  useEffect(() => {
    if (messageTouched) return;
    setDecisionMessage(buildDecisionTemplate(decision, selectedReasons));
  }, [decision, selectedReasons, messageTouched]);

  useEffect(() => {
    if (!selectedCase) return;
    setDecision('approved');
    setSelectedReasons([]);
    setDecisionMessage(buildDecisionTemplate('approved', []));
    setMessageTouched(false);
    setModeratorNote('');
    setDecisionError(null);
  }, [selectedCase?.id]);

  useEffect(() => {
    const handler = (event) => {
      if (isModerator !== true) return;
      const activeElement = document.activeElement;
      if (activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName)) {
        return;
      }
      if (event.key.toLowerCase() === 'a') {
        setDecision('approved');
        setMessageTouched(false);
      }
      if (event.key.toLowerCase() === 'r') {
        setDecision('rejected');
        setMessageTouched(false);
      }
      if (event.key.toLowerCase() === 'j') {
        const index = filteredCases.findIndex((item) => item.id === selectedCaseId);
        if (index < filteredCases.length - 1) {
          setSelectedCaseId(filteredCases[index + 1].id);
        }
      }
      if (event.key.toLowerCase() === 'k') {
        const index = filteredCases.findIndex((item) => item.id === selectedCaseId);
        if (index > 0) {
          setSelectedCaseId(filteredCases[index - 1].id);
        }
      }
      if (event.key.toLowerCase() === 'n') {
        const noteField = document.getElementById('moderator-note');
        noteField?.focus();
      }
      if (event.key === 'Escape') {
        setSelectedCaseId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredCases, selectedCaseId, isModerator]);

  const toggleReason = (reasonId) => {
    setMessageTouched(false);
    setSelectedReasons((prev) => {
      if (prev.includes(reasonId)) {
        return prev.filter((item) => item !== reasonId);
      }
      if (prev.length >= 3) return prev;
      return [...prev, reasonId];
    });
  };

  const handleDecisionSubmit = async () => {
    if (!selectedCase || !authUser || !moderationApiBase) return;
    if (!decisionMessage.trim()) {
      setDecisionError('Voeg een moderatiebericht toe.');
      return;
    }
    if (decisionMessage.length > 280) {
      setDecisionError('Het bericht mag maximaal 280 tekens zijn.');
      return;
    }
    if (decision === 'rejected' && selectedReasons.length === 1 && selectedReasons[0] === 'missingOrIncorrectTags') {
      setDecisionError('Triggers ontbreken of kloppen niet kan niet alleen tot afkeuring leiden.');
      return;
    }
    setDecisionPending(true);
    setDecisionError(null);
    try {
      const token = await authUser.getIdToken();
      const response = await fetch(`${moderationApiBase}/moderatorDecide`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reviewCaseId: selectedCase.id,
          decision,
          decisionMessagePublic: decisionMessage.trim(),
          decisionReasons: selectedReasons,
          moderatorNoteInternal: moderatorNote || null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || 'Beslissing opslaan mislukt.');
      }
      setSelectedCaseId(null);
    } catch (error) {
      setDecisionError(error.message);
    } finally {
      setDecisionPending(false);
    }
  };

  if (isModerator === false) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10 text-center">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-10">
          <Shield className="w-10 h-10 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold dark:text-white">Geen toegang</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Je hebt geen toegang tot moderatie.</p>
        </div>
      </div>
    );
  }

  if (isModerator === null) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const isLockedByOther = selectedCaseId && !claimState.claimed;
  const isReportCase = selectedCase?.caseType === 'report';
  const reportedPost = selectedCase?.reportedPost || null;
  const uploadPreviewUrl = selectedUpload?.previewUrl || selectedUpload?.imageUrl || selectedUpload?.image || reportedPost?.imageUrl || null;
  const tags = selectedUpload?.appliedTriggers || selectedUpload?.makerTags || [];
  const queueTitle = caseTypeFilter === 'report' ? 'Gerapporteerde foto’s' : 'Foto’s in review';

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold dark:text-white">{queueTitle}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{filteredCases.length} in review</p>
          </div>
          <div className="text-xs text-slate-400">J/K</div>
        </div>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto no-scrollbar">
          {filteredCases.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelectedCaseId(item.id)}
              className={`w-full text-left rounded-2xl border p-4 transition ${
                item.id === selectedCaseId
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold dark:text-white">Case {item.id.slice(0, 6)}</p>
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  {item.caseType === 'report' ? 'Melding' : 'Upload'}
                </span>
              </div>
              <p className="text-xs text-slate-500">Uploader: {item.userId || item.reportedPost?.authorId || 'Onbekend'}</p>
            </button>
          ))}
          {filteredCases.length === 0 && (
            <div className="text-xs text-slate-500 dark:text-slate-400">Geen open cases.</div>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {!selectedCase && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Selecteer een case om details te bekijken.
          </div>
        )}

        {selectedCase && (
          <>
            {isLockedByOther && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/30 p-4 text-sm text-amber-800 dark:text-amber-200">
                Al in behandeling door {claimState.claimedBy || 'een andere moderator'}.
              </div>
            )}

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold dark:text-white">Case {selectedCase.id}</h2>
                <div className="text-xs text-slate-400">A/R · N · Esc</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
                <div className="space-y-3">
                  <div className="aspect-[4/5] rounded-2xl bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                    {uploadPreviewUrl ? (
                      <img src={uploadPreviewUrl} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs text-slate-400">Geen preview</span>
                    )}
                  </div>
                  {reportedPost && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-500 dark:text-slate-300 space-y-1">
                      <p className="font-semibold text-slate-600 dark:text-slate-200">Gemelde post</p>
                      {reportedPost.title && <p className="text-slate-500">Titel: {reportedPost.title}</p>}
                      <p className="text-slate-500">Post ID: {reportedPost.id}</p>
                      {reportedPost.authorName && <p className="text-slate-500">Maker: {reportedPost.authorName}</p>}
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Uploader tags</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {tags.length > 0 ? tags.map((tag) => (
                        <span key={tag} className="text-[11px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200">
                          {tag}
                        </span>
                      )) : (
                        <span className="text-xs text-slate-400">{isReportCase ? 'Geen tags beschikbaar' : 'Geen tags'}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">AI snapshot</p>
                    <pre className="text-xs bg-slate-50 dark:bg-slate-800 rounded-xl p-3 max-h-40 overflow-y-auto no-scrollbar text-slate-600 dark:text-slate-200">
                      {JSON.stringify(selectedCase.aiSnapshot || {}, null, 2)}
                    </pre>
                  </div>
                  <div className="space-y-3">
                    <div className="flex gap-3">
                      <Button variant={decision === 'approved' ? 'primary' : 'secondary'} onClick={() => { setDecision('approved'); setMessageTouched(false); }}>
                        Goedkeuren (A)
                      </Button>
                      <Button variant={decision === 'rejected' ? 'danger' : 'secondary'} onClick={() => { setDecision('rejected'); setMessageTouched(false); }}>
                        Afkeuren (R)
                      </Button>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Redenen (max 3)</label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {MODERATION_REASON_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => toggleReason(preset.id)}
                            className={`text-[11px] px-3 py-1 rounded-full border transition ${
                              selectedReasons.includes(preset.id)
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Bericht aan uploader</label>
                      <textarea
                        className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                        value={decisionMessage}
                        onChange={(event) => {
                          setDecisionMessage(event.target.value);
                          setMessageTouched(true);
                        }}
                        maxLength={280}
                        rows={4}
                      />
                      <div className="text-xs text-slate-400 mt-1">{decisionMessage.length}/280</div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Interne notitie (alleen moderators)</label>
                      <textarea
                        id="moderator-note"
                        className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                        value={moderatorNote}
                        onChange={(event) => setModeratorNote(event.target.value)}
                        rows={3}
                      />
                    </div>
                    {decisionError && <p className="text-xs text-red-500">{decisionError}</p>}
                    <Button
                      onClick={handleDecisionSubmit}
                      disabled={decisionPending || isLockedByOther}
                      className="w-full"
                    >
                      {decisionPending ? 'Beslissing opslaan...' : 'Beslissing opslaan'}
                    </Button>
                    <p className="text-[11px] text-slate-400">Shortcuts: A/R, J/K, N (notitie), Esc</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ModerationPortal({
  moderationApiBase,
  authUser,
  isModerator,
  uploads,
  moderationModal,
  moderationActionPending,
  onModerationAction,
  onCloseModerationModal,
}) {
  const [activeTab, setActiveTab] = useState('chat');

  if (isModerator === null) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (isModerator === false) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10 text-center">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-10">
          <Shield className="w-10 h-10 text-slate-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold dark:text-white">Geen toegang</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Je hebt geen toegang tot moderatie.</p>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'chat', label: 'Berichten', icon: MessageCircle },
    { id: 'review', label: 'Review voor posten', icon: ImageIcon },
    { id: 'reports', label: 'Rapportages', icon: AlertTriangle },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold dark:text-white">Artes Moderatie</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Beheer support chats, reviews en rapportages.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold border transition ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'chat' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900 min-h-[60vh]">
          {authUser ? (
            <ModerationSupportChat authUser={authUser} isModerator={isModerator} />
          ) : (
            <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Log in om de chat te openen.</div>
          )}
        </div>
      )}

      {activeTab === 'review' && (
        <div className="space-y-6">
          <UploadStatusPanel uploads={uploads} />
          <ModerationPanel
            moderationApiBase={moderationApiBase}
            authUser={authUser}
            isModerator={isModerator}
            caseTypeFilter="upload"
          />
        </div>
      )}

      {activeTab === 'reports' && (
        <ModerationPanel
          moderationApiBase={moderationApiBase}
          authUser={authUser}
          isModerator={isModerator}
          caseTypeFilter="report"
        />
      )}

      {moderationModal && (
        <ModerationDecisionModal
          message={moderationModal}
          onClose={onCloseModerationModal}
          onAction={onModerationAction}
          pending={moderationActionPending}
        />
      )}
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
  const moderationEndpoint = import.meta.env.VITE_MODERATION_FUNCTION_URL;

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

  const runAICheck = async ({ silent = false } = {}) => {
    if (!image) {
      if (!silent) {
        setErrors((prev) => ({ ...prev, image: 'Voeg eerst een afbeelding toe voor de AI-scan.' }));
      }
      return null;
    }

    if (!moderationEndpoint) {
      if (!silent) {
        setAiError('Geen AI-endpoint ingesteld. Voeg VITE_MODERATION_FUNCTION_URL toe aan je omgeving.');
      }
      return null;
    }

    setAiLoading(true);
    if (!silent) {
      setAiError('');
    }
    setErrors((prev) => ({ ...prev, moderation: undefined }));

    try {
      if (!user) {
        if (!silent) {
          setAiError('Je moet ingelogd zijn om de AI-check uit te voeren.');
        }
        return null;
      }
      const token = await user.getIdToken();
      const response = await fetch(moderationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
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
      return data;
    } catch (error) {
      console.error('AI check failed', error);
      if (!silent) {
        setAiError('AI-check mislukt. Probeer het opnieuw.');
      }
      setAppliedTriggers([]);
      setSuggestedTriggers([]);
      setOutcome(null);
      setForbiddenReasons([]);
      setReviewCaseId(null);
      setShowSuggestionUI(false);
      setReviewRequested(false);
      return null;
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

    let nextOutcome = outcome;
    let moderationData = null;
    if (!nextOutcome || nextOutcome === 'unchecked') {
      moderationData = await runAICheck({ silent: true });
      nextOutcome = moderationData?.outcome ?? outcome;
    }

    if (nextOutcome === 'forbidden') {
      setErrors((prev) => ({ ...prev, moderation: 'Deze publicatie is geblokkeerd door de safety check.' }));
      return;
    }

    const effectiveAppliedTriggers = moderationData
      ? (Array.isArray(moderationData.appliedTriggers) ? moderationData.appliedTriggers : [])
      : appliedTriggers;
    const effectiveForbiddenReasons = moderationData
      ? (Array.isArray(moderationData.forbiddenReasons) ? moderationData.forbiddenReasons : [])
      : forbiddenReasons;
    const effectiveReviewCaseId = moderationData?.reviewCaseId ?? reviewCaseId;
    const baseTriggers = effectiveAppliedTriggers.length ? effectiveAppliedTriggers : makerTags;
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
         outcome: nextOutcome || 'unchecked',
         forbiddenReasons: effectiveForbiddenReasons,
         reviewCaseId: effectiveReviewCaseId,
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
                              {aiLoading && <Loader2 className="w-3 h-3 animate-spin" />}Help me bepalen ✨
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
                           <div className="mt-3 space-y-1 text-xs text-emerald-600 dark:text-emerald-300">
                             <p>AI-check: toegestaan. Je kunt direct publiceren.</p>
                             {appliedTriggers.length === 0 && suggestedTriggers.length === 0 && (
                               <p>Geen waarschuwingen nodig voor deze foto.</p>
                             )}
                           </div>
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

function EditProfileModal({ onClose, profile, user, posts, onOpenQuickProfile }) {
  const [formData, setFormData] = useState({ ...profile });
  const [agencySearch, setAgencySearch] = useState('');
  const [tab, setTab] = useState('general');
  const [pendingRoleRemoval, setPendingRoleRemoval] = useState(null);
  const [avatarInputMode, setAvatarInputMode] = useState(profile?.avatar?.startsWith('data:') ? 'upload' : 'url');
  const [headerInputMode, setHeaderInputMode] = useState(profile?.headerImage?.startsWith('data:') ? 'upload' : 'url');
  const [manualPostIds, setManualPostIds] = useState(profile?.quickProfilePostIds || []);
  const [saveError, setSaveError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const selectedRoles = formData.roles || [];
  const selectedThemes = formData.themes || [];
  const userPosts = useMemo(() => (posts || []).filter((post) => post.authorId === user?.uid), [posts, user?.uid]);
  const resolvePostTimestamp = (post) => {
    if (post?.createdAt?.seconds) return post.createdAt.seconds * 1000;
    if (post?.createdAt?.toMillis) return post.createdAt.toMillis();
    if (typeof post?.createdAt === 'number') return post.createdAt;
    return 0;
  };
  const sortedUserPosts = useMemo(
    () => [...userPosts].sort((a, b) => resolvePostTimestamp(b) - resolvePostTimestamp(a)),
    [userPosts]
  );

  const handleSave = async () => {
     setSaveError(null);
     setIsSaving(true);
     const quickProfilePostIds = Array.from(new Set(manualPostIds));
     const payload = {
       ...formData,
       roles: formData.roles?.length ? formData.roles : ['fan'],
       themes: formData.themes || [],
       headerPosition: formData.headerPosition || 'center',
       quickProfilePreviewMode: formData.quickProfilePreviewMode || 'latest',
       quickProfilePostIds,
       preferences: {
         ...formData.preferences,
         triggerVisibility: normalizeTriggerPreferences(formData.preferences?.triggerVisibility),
       },
     };
     try {
       await updateUserProfile(user.uid, payload);
       onClose();
     } catch (error) {
       console.error('Failed to save profile settings', error);
       setSaveError('Opslaan mislukt. Probeer het opnieuw.');
     } finally {
       setIsSaving(false);
     }
  };

  const handleRoleToggle = (roleId) => {
    if (selectedRoles.includes(roleId)) {
      setPendingRoleRemoval(roleId);
      return;
    }
    setFormData((prev) => ({
      ...prev,
      roles: [...(prev.roles || []), roleId],
    }));
  };

  const confirmRoleRemoval = () => {
    if (!pendingRoleRemoval) return;
    setFormData((prev) => ({
      ...prev,
      roles: (prev.roles || []).filter((role) => role !== pendingRoleRemoval),
    }));
    setPendingRoleRemoval(null);
  };

  const handleThemeToggle = (theme) => {
    setFormData((prev) => {
      const prevThemes = prev.themes || [];
      return {
        ...prev,
        themes: prevThemes.includes(theme)
          ? prevThemes.filter((item) => item !== theme)
          : [...prevThemes, theme],
      };
    });
  };

  const handleImageUpload = (event, key) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({
        ...prev,
        [key]: reader.result,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleManualPostToggle = (postId) => {
    setManualPostIds((prev) => (
      prev.includes(postId) ? prev.filter((id) => id !== postId) : [...prev, postId]
    ));
  };

  const quickPreviewMode = formData.quickProfilePreviewMode || 'latest';

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
       <div className="bg-white dark:bg-slate-900 w-full max-w-2xl h-[80vh] rounded-3xl overflow-hidden flex flex-col">
          <div className="p-6 border-b flex justify-between"><h3 className="font-bold text-lg dark:text-white">Profiel Bewerken</h3><button onClick={onClose}><X/></button></div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
             {/* Simple Tabs for this view */}
             <div className="flex gap-4 border-b mb-4">
                 {[
                   { key: 'general', label: 'Algemeen' },
                   { key: 'preview', label: 'Quick Profile' },
                   { key: 'triggers', label: 'Triggers' },
                   { key: 'rollen', label: 'Rollen' },
                   { key: 'stijlen', label: 'Stijlen' },
                 ].map(({ key, label }) => (
                   <button
                     key={key}
                     onClick={() => setTab(key)}
                     className={`pb-2 ${tab === key ? 'border-b-2 border-blue-600 font-bold' : ''}`}
                   >
                     {label}
                   </button>
                 ))}
             </div>

             {tab === 'general' && (
                <>
                    <Input label="Weergavenaam" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})} />
                    <div><label className="block text-sm font-medium mb-1 dark:text-slate-300">Bio</label><textarea className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white h-24" value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} /></div>

                    <div className="border-t pt-6 space-y-4">
                      <h4 className="font-bold dark:text-white">Profielafbeeldingen</h4>
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Avatar</p>
                        <div className="flex gap-2">
                          {['upload', 'url'].map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setAvatarInputMode(mode)}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                                avatarInputMode === mode
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {mode === 'upload' ? 'Upload' : 'URL'}
                            </button>
                          ))}
                        </div>
                        {avatarInputMode === 'upload' ? (
                          <input
                            type="file"
                            accept="image/*"
                            className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            onChange={(event) => handleImageUpload(event, 'avatar')}
                          />
                        ) : (
                          <input
                            className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            placeholder="https://"
                            value={formData.avatar || ''}
                            onChange={(event) => setFormData({ ...formData, avatar: event.target.value })}
                          />
                        )}
                        {formData.avatar && (
                          <div className="flex items-center gap-3">
                            <img src={formData.avatar} alt="Avatar preview" className="w-12 h-12 rounded-full object-cover border" />
                            <button
                              type="button"
                              className="text-xs text-slate-500 hover:text-slate-700"
                              onClick={() => setFormData({ ...formData, avatar: '' })}
                            >
                              Verwijderen
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Header afbeelding</p>
                        <div className="flex gap-2">
                          {['upload', 'url'].map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setHeaderInputMode(mode)}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                                headerInputMode === mode
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              {mode === 'upload' ? 'Upload' : 'URL'}
                            </button>
                          ))}
                        </div>
                        {headerInputMode === 'upload' ? (
                          <input
                            type="file"
                            accept="image/*"
                            className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            onChange={(event) => handleImageUpload(event, 'headerImage')}
                          />
                        ) : (
                          <input
                            className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            placeholder="https://"
                            value={formData.headerImage || ''}
                            onChange={(event) => setFormData({ ...formData, headerImage: event.target.value })}
                          />
                        )}
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Header positie</label>
                            <select
                              className="w-full p-2 rounded-xl border text-sm dark:bg-slate-800 dark:text-white"
                              value={formData.headerPosition || 'center'}
                              onChange={(event) => setFormData({ ...formData, headerPosition: event.target.value })}
                            >
                              {[
                                'center',
                                'top',
                                'bottom',
                                'left',
                                'right',
                                'left top',
                                'right top',
                                'left bottom',
                                'right bottom',
                              ].map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </div>
                          {formData.headerImage && (
                            <div className="rounded-2xl border overflow-hidden h-20">
                              <img
                                src={formData.headerImage}
                                alt="Header preview"
                                className="w-full h-full object-cover"
                                style={{ objectPosition: formData.headerPosition || 'center' }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

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

             {tab === 'preview' && (
               <div className="space-y-5">
                 <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                   <div>
                     <h4 className="font-bold text-slate-800 dark:text-white">Quick Profile</h4>
                     <p className="text-sm text-slate-500 dark:text-slate-400">
                       Kies welke posts je visitekaartje toont in snelle previews.
                     </p>
                   </div>
                   <Button
                     variant="secondary"
                     className="self-start sm:self-auto"
                     onClick={() => onOpenQuickProfile?.()}
                   >
                     Bekijk Quick Profile
                   </Button>
                 </div>
                 <div className="space-y-2">
                   <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Modus</label>
                   <div className="flex flex-wrap gap-2">
                     {[
                       { id: 'latest', label: 'Laatste' },
                       { id: 'best', label: 'Beste' },
                       { id: 'manual', label: 'Handmatig' },
                     ].map((option) => (
                       <button
                         key={option.id}
                         type="button"
                         onClick={() => setFormData({ ...formData, quickProfilePreviewMode: option.id })}
                         className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                           quickPreviewMode === option.id
                             ? 'bg-blue-600 text-white border-blue-600'
                             : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                         }`}
                       >
                         {option.label}
                       </button>
                     ))}
                   </div>
                 </div>
                 {quickPreviewMode === 'manual' && (
                   <div className="space-y-2">
                     <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Selecteer posts</label>
                     {sortedUserPosts.length > 0 ? (
                       <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                         {sortedUserPosts.map((post) => {
                           const isSelected = manualPostIds.includes(post.id);
                           return (
                             <button
                               key={post.id}
                               type="button"
                               onClick={() => handleManualPostToggle(post.id)}
                               className={`relative rounded-2xl overflow-hidden border transition ${
                                 isSelected
                                   ? 'border-blue-500 ring-2 ring-blue-500'
                                   : 'border-slate-200 dark:border-slate-700 hover:border-blue-300'
                               }`}
                             >
                               <img src={post.imageUrl} alt={post.title} className="w-full h-32 object-cover" />
                               <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 hover:opacity-100 transition" />
                               <div className="absolute bottom-2 left-2 right-2 text-left">
                                 <p className="text-xs font-semibold text-white truncate">{post.title}</p>
                               </div>
                               {isSelected && (
                                 <div className="absolute top-2 right-2 bg-blue-600 text-white rounded-full p-1">
                                   <CheckCircle className="w-4 h-4" />
                                 </div>
                               )}
                             </button>
                           );
                         })}
                       </div>
                     ) : (
                       <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400 text-center">
                         Nog geen uploads gevonden. Upload eerst posts om ze hier te selecteren.
                       </div>
                     )}
                     <p className="text-xs text-slate-500 dark:text-slate-400">
                       {manualPostIds.length > 0
                         ? `${manualPostIds.length} geselecteerd. Deze worden getoond in de snelle preview.`
                         : 'Geen selectie gemaakt: we tonen automatisch je laatste posts.'}
                     </p>
                   </div>
                 )}
               </div>
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
             {tab === 'rollen' && (
               <div className="space-y-5">
                 <div>
                   <h4 className="font-bold text-slate-800 dark:text-white">Rollen</h4>
                   <p className="text-sm text-slate-500 dark:text-slate-400">
                     Kies welke rollen zichtbaar zijn op je profiel. Je bestaande posts blijven staan en credits blijven gekoppeld,
                     maar de uitgezette rol wordt niet meer getoond bij je profiel of nieuwe posts/credits (we migreren niets).
                   </p>
                 </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                   {ROLES.map((role) => {
                     const isSelected = selectedRoles.includes(role.id);
                     return (
                       <button
                         key={role.id}
                         type="button"
                         onClick={() => handleRoleToggle(role.id)}
                         className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                           isSelected
                             ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                             : 'border-slate-200 dark:border-slate-700 hover:border-blue-300'
                         }`}
                       >
                         <div className="flex items-center justify-between gap-2">
                           <span className="text-sm font-semibold text-slate-900 dark:text-white">{role.label}</span>
                           {isSelected && <span className="text-[10px] uppercase tracking-wide text-blue-600">Actief</span>}
                         </div>
                         <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{role.desc}</p>
                       </button>
                     );
                   })}
                 </div>
               </div>
             )}

             {tab === 'stijlen' && (
               <div className="space-y-4">
                 <div>
                   <h4 className="font-bold text-slate-800 dark:text-white">Stijlen</h4>
                   <p className="text-sm text-slate-500 dark:text-slate-400">Selecteer de thema&apos;s die bij jouw werk passen.</p>
                 </div>
                 <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto no-scrollbar">
                   {THEMES.map((theme) => {
                     const isSelected = selectedThemes.includes(theme);
                     return (
                       <button
                         key={theme}
                         type="button"
                         onClick={() => handleThemeToggle(theme)}
                         className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${getThemeStyle(theme)} ${
                           isSelected ? 'ring-2 ring-blue-500' : ''
                         }`}
                       >
                         {theme}
                       </button>
                     );
                   })}
                 </div>
               </div>
             )}
          </div>
          <div className="p-6 border-t space-y-3">
            {saveError && <p className="text-sm text-red-500">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Annuleren</Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Opslaan...' : 'Opslaan'}
              </Button>
            </div>
          </div>
       </div>
       {pendingRoleRemoval && (
         <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-6">
           <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-md shadow-xl space-y-4">
             <div className="flex items-center gap-3">
               <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                 <AlertTriangle className="w-5 h-5" />
               </div>
               <div>
                 <h4 className="font-bold text-slate-900 dark:text-white">Rol uitschakelen?</h4>
                 <p className="text-sm text-slate-500 dark:text-slate-400">
                   Je zet <span className="font-semibold">{ROLES.find((role) => role.id === pendingRoleRemoval)?.label}</span> uit.
                 </p>
               </div>
             </div>
             <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 text-sm text-slate-600 dark:text-slate-300 space-y-2">
               <p>Bestaande posts en credits blijven gekoppeld aan jou en blijven zichtbaar.</p>
               <p>We migreren niets: deze rol wordt alleen verwijderd van je profiel en verschijnt niet meer bij nieuwe posts/credits.</p>
             </div>
             <div className="flex justify-end gap-2">
               <Button variant="ghost" onClick={() => setPendingRoleRemoval(null)}>Annuleren</Button>
               <Button className="bg-amber-500 hover:bg-amber-600 text-white" onClick={confirmRoleRemoval}>Rol uitschakelen</Button>
             </div>
           </div>
         </div>
       )}
    </div>
  );
}

function CommunityList({ setView }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <div><h2 className="text-2xl font-bold dark:text-white">Community</h2></div>
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
        <div
          className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex gap-6 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => setView('chat')}
        >
          <div className="w-12 h-12 bg-blue-50 dark:bg-slate-700 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <MessageCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg dark:text-white mb-1">Chat</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">Open je gesprekken en contact met Artes Moderatie.</p>
          </div>
        </div>
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

function CommunityDetail({ id, setView, authUser, functionsBase }) {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <button onClick={() => setView('community')} className="flex items-center text-slate-500 hover:text-slate-800 font-medium">
        <ChevronLeft className="w-4 h-4 mr-1" /> Terug
      </button>
      <div>
        <h2 className="text-2xl font-bold dark:text-white">Community: {id}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Praat mee of neem contact op met Artes Moderatie.</p>
      </div>
      <div className="min-h-[60vh]">
        {authUser ? (
          <ChatPanel authUser={authUser} functionsBase={functionsBase} />
        ) : (
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
            Log in om de chat te openen.
          </div>
        )}
      </div>
    </div>
  );
}
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
function PhotoDetailModal({ post, onClose, authUser, moderationApiBase }) {
  const [reportState, setReportState] = useState({ status: 'idle', error: null });
  const [editState, setEditState] = useState({ saving: false, error: null, success: false });
  const [deleteState, setDeleteState] = useState({ confirm: false, deleting: false, error: null });
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post?.title || '');
  const [editDescription, setEditDescription] = useState(post?.description || '');
  const canReport = Boolean(authUser && moderationApiBase);
  const isOwner = Boolean(authUser?.uid && post?.authorId === authUser?.uid);

  useEffect(() => {
    setIsEditing(false);
    setEditState({ saving: false, error: null, success: false });
    setDeleteState({ confirm: false, deleting: false, error: null });
    setEditTitle(post?.title || '');
    setEditDescription(post?.description || '');
  }, [post?.id]);

  const handleReport = async () => {
    if (!canReport || reportState.status === 'pending' || reportState.status === 'sent') return;
    const shouldReport = window.confirm('Weet je zeker dat je deze foto wilt rapporteren?');
    if (!shouldReport) return;
    setReportState({ status: 'pending', error: null });
    try {
      const contributorUids = Array.isArray(post.credits)
        ? post.credits.map((credit) => credit?.uid).filter(Boolean)
        : [];
      const reviewerTargets = new Set([post.authorId, ...contributorUids].filter(Boolean));
      const token = await authUser.getIdToken();
      const response = await fetch(`${moderationApiBase}/reportPost`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          postId: post.id,
          imageUrl: post.imageUrl,
          title: post.title || null,
          authorId: post.authorId || null,
          authorName: post.authorName || null,
          contributorUids: Array.from(reviewerTargets),
        }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || 'Rapporteren mislukt.');
      }
      setReportState({ status: 'sent', error: null });
    } catch (error) {
      setReportState({ status: 'idle', error: error.message || 'Rapporteren mislukt.' });
    }
  };

  const handleSave = async () => {
    if (!isOwner || editState.saving) return;
    setEditState({ saving: true, error: null, success: false });
    try {
      await updatePost(post.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setEditState({ saving: false, error: null, success: true });
      setIsEditing(false);
    } catch (error) {
      setEditState({ saving: false, error: error.message || 'Opslaan mislukt.', success: false });
    }
  };

  const handleDelete = async () => {
    if (!isOwner || deleteState.deleting) return;
    setDeleteState((prev) => ({ ...prev, deleting: true, error: null }));
    try {
      await deletePost(post.id);
      setDeleteState({ confirm: false, deleting: false, error: null });
      onClose();
    } catch (error) {
      setDeleteState((prev) => ({
        ...prev,
        deleting: false,
        error: error.message || 'Verwijderen mislukt.',
      }));
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-10">
      <img src={post.imageUrl} className="max-h-full" />
      <div className="absolute top-4 left-4 flex items-center gap-3 text-xs text-white/70">
        <button
          type="button"
          onClick={handleReport}
          disabled={!canReport || reportState.status === 'pending'}
          className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 hover:bg-white/20 disabled:opacity-60"
        >
          <AlertTriangle className="w-4 h-4" />
          Rapporteer foto
        </button>
        {reportState.status === 'sent' && (
          <span className="text-emerald-200">Melding verstuurd.</span>
        )}
        {reportState.error && (
          <span className="text-red-200">{reportState.error}</span>
        )}
      </div>
      {isOwner && (
        <div className="absolute bottom-6 left-6 right-6 md:right-auto md:max-w-md bg-black/70 text-white p-4 rounded-2xl border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-white/60">Jouw upload</p>
              <p className="text-sm font-semibold">Beheer je post</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEditing((prev) => !prev);
                  setEditState({ saving: false, error: null, success: false });
                }}
                className="text-xs px-3 py-1 rounded-full bg-white/10 hover:bg-white/20"
              >
                {isEditing ? 'Annuleren' : 'Bewerken'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteState((prev) => ({ ...prev, confirm: !prev.confirm, error: null }))}
                className="text-xs px-3 py-1 rounded-full bg-red-500/20 text-red-100 hover:bg-red-500/30"
              >
                Verwijderen
              </button>
            </div>
          </div>

          {isEditing && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-white/70">Titel</label>
                <input
                  className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-white"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-white/70">Beschrijving</label>
                <textarea
                  className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 p-2 text-sm text-white"
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  rows={3}
                />
              </div>
              {editState.error && <p className="text-xs text-red-200">{editState.error}</p>}
              {editState.success && <p className="text-xs text-emerald-200">Wijzigingen opgeslagen.</p>}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={editState.saving}
                  className="text-xs px-4 py-1.5 rounded-full bg-emerald-500/80 hover:bg-emerald-500 disabled:opacity-60"
                >
                  {editState.saving ? 'Opslaan...' : 'Opslaan'}
                </button>
              </div>
            </div>
          )}

          {deleteState.confirm && (
            <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-3 space-y-2">
              <p className="text-xs text-red-100">
                Weet je zeker dat je deze post wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
              </p>
              {deleteState.error && <p className="text-xs text-red-200">{deleteState.error}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteState((prev) => ({ ...prev, confirm: false }))}
                  className="text-xs px-3 py-1 rounded-full bg-white/10 hover:bg-white/20"
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteState.deleting}
                  className="text-xs px-3 py-1 rounded-full bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
                >
                  {deleteState.deleting ? 'Verwijderen...' : 'Bevestig verwijderen'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <button onClick={onClose} className="absolute top-4 right-4 text-white"><X/></button>
    </div>
  );
}
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
  const resolvePostTimestamp = (post) => {
    if (post?.createdAt?.seconds) return post.createdAt.seconds * 1000;
    if (post?.createdAt?.toMillis) return post.createdAt.toMillis();
    if (typeof post?.createdAt === 'number') return post.createdAt;
    return 0;
  };
  const previewMode = userProfile.quickProfilePreviewMode || 'latest';
  const manualIds = Array.isArray(userProfile.quickProfilePostIds) ? userProfile.quickProfilePostIds : [];
  const previewPosts = useMemo(() => {
    if (previewMode === 'manual' && manualIds.length) {
      const manualPosts = manualIds
        .map((id) => userPosts.find((post) => post.id === id))
        .filter(Boolean);
      if (manualPosts.length) return manualPosts.slice(0, 3);
    }
    if (previewMode === 'best') {
      return [...userPosts]
        .sort((a, b) => (b.likes || 0) - (a.likes || 0))
        .slice(0, 3);
    }
    return [...userPosts]
      .sort((a, b) => resolvePostTimestamp(b) - resolvePostTimestamp(a))
      .slice(0, 3);
  }, [manualIds, previewMode, userPosts]);
  const headerImage = userProfile.headerImage || userProfile.avatar;
  const headerPosition = userProfile.headerPosition || 'center';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6">
      <div className="bg-white dark:bg-slate-900 rounded-[32px] w-full max-w-4xl shadow-2xl overflow-hidden border border-white/10">
        <div className="relative h-80 w-full">
          <img src={headerImage} className="w-full h-full object-cover scale-105" style={{ objectPosition: headerPosition }} />
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
function SettingsModal({ onClose, moderatorAccess, onOpenModeration, onOpenSupport, darkMode, onToggleDark, onLogout }) { 
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
            <div className="bg-white dark:bg-slate-900 w-80 h-full p-6 flex flex-col gap-6 text-slate-900 dark:text-slate-100">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-xl">Instellingen</h3>
                  <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><X/></button>
                </div>
                <div className="space-y-4">
                    <h4 className="text-xs uppercase font-bold text-slate-400">Account</h4>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded flex justify-between"><span>Meldingen</span><Bell className="w-4 h-4"/></div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded flex justify-between"><span>Privacy</span><Lock className="w-4 h-4"/></div>
                    <button
                      type="button"
                      onClick={onLogout}
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left text-rose-600 dark:text-rose-300"
                    >
                      <span>Log uit</span>
                      <LogOut className="w-4 h-4" />
                    </button>
                    <h4 className="text-xs uppercase font-bold text-slate-400">Weergave</h4>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={onToggleDark}
                        className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                      >
                        {darkMode ? 'Light mode' : 'Dark mode'}
                      </button>
                      {darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-500" />}
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded flex justify-between"><span>Taal</span><Globe className="w-4 h-4"/></div>
                    {moderatorAccess === true && (
                      <>
                        <h4 className="text-xs uppercase font-bold text-slate-400">Moderatie</h4>
                        <button
                          type="button"
                          onClick={onOpenModeration}
                          className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left"
                        >
                          <span>Artes Moderatie</span>
                          <Shield className="w-4 h-4"/>
                        </button>
                        <p className="text-xs text-slate-500 dark:text-slate-300">
                          Open het moderatieportaal om chats, reviews en rapportages te beheren.
                        </p>
                      </>
                    )}
                    <h4 className="text-xs uppercase font-bold text-slate-400">Overig</h4>
                    <button
                      type="button"
                      onClick={onOpenSupport}
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left"
                    >
                      <span>Support</span>
                      <HelpCircle className="w-4 h-4" />
                    </button>
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
