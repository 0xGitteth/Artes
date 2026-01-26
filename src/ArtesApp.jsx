import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Image as ImageIcon, Search, Users, Plus, Hand, Cloud, Bookmark,
  Settings, LogOut, Shield, Camera, Handshake, ChevronLeft,
  X, AlertTriangle, AlertOctagon, UserPlus, Link as LinkIcon,
  Maximize2, Share2, MoreHorizontal, LayoutGrid, User, CheckCircle,
  Briefcase, Building2, Star, Edit3, Moon, Sun, ArrowRight, Info, ExternalLink, Trash2, MapPin, Bell, Lock, HelpCircle, Mail, Globe, Loader2, MessageCircle, GitMerge
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
  createClaimInvite,
  isModerator,
  ensureSupportThreadExists,
  migrateRemoveGeneralTheme,
  getContributorByAlias,
  createContributorWithAliases,
  CLAIMS_COLLECTIONS,
  getFirebaseStorageInstance,
} from './firebase';
import {
  collection,
  doc,
  addDoc,
  endAt,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  startAt,
  writeBatch,
  setDoc,
  where,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import ChatPanel from './components/ChatPanel';
import ModerationSupportChat from './components/ModerationSupportChat';
import SupportLanding from './components/SupportLanding';
import { normalizeDomain, normalizeEmail, normalizeInstagram } from './utils/contributorClaims';

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

const COMMUNITY_ICON_OPTIONS = [
  { key: 'shield', label: 'Shield', icon: Shield },
  { key: 'handshake', label: 'Handshake', icon: Handshake },
  { key: 'camera', label: 'Camera', icon: Camera },
  { key: 'users', label: 'Users', icon: Users },
  { key: 'star', label: 'Star', icon: Star },
  { key: 'globe', label: 'Globe', icon: Globe },
  { key: 'message', label: 'Message', icon: MessageCircle },
];

const COMMUNITY_ICON_MAP = COMMUNITY_ICON_OPTIONS.reduce((acc, option) => {
  acc[option.key] = option.icon;
  return acc;
}, {});

const DEFAULT_COMMUNITY_CONFIG = {
  communities: [
    {
      id: 'safety',
      title: 'Veiligheid & Consent',
      description: 'Over grenzen, afspraken en veilig werken.',
      iconKey: 'shield',
      topics: ['Consent', 'Grenzen', 'Veilig werken'],
    },
    {
      id: 'network',
      title: 'Netwerk & Collabs',
      description: 'Vind je team voor de volgende shoot.',
      iconKey: 'handshake',
      topics: ['Samenwerkingen', 'Crew gezocht', 'Portfolioshoots'],
    },
    {
      id: 'tech',
      title: 'Techniek & Gear',
      description: "Alles over licht, camera's en lenzen.",
      iconKey: 'camera',
      topics: ['Lichtopstellingen', 'Gear tips', 'Workflow'],
    },
  ],
};

const DEFAULT_CHALLENGE_CONFIG = {
  title: 'Monthly Challenge',
  theme: 'Shadow Play',
  description: 'Deel je beste interpretatie van dit thema en inspireer de community.',
};

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

const sanitizeHandle = (value) => (value || '').replace(/^@+/, '').trim();

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

const resolveCommunityIcon = (iconKey) => COMMUNITY_ICON_MAP[iconKey] || Users;

const normalizeCommunityConfig = (config = {}) => {
  const base = config && Array.isArray(config.communities) ? config : DEFAULT_COMMUNITY_CONFIG;
  const communities = (base.communities || []).map((community, index) => ({
    id: community?.id || `community_${index + 1}`,
    title: community?.title || '',
    description: community?.description || community?.desc || '',
    iconKey: community?.iconKey || community?.icon || 'users',
    topics: Array.isArray(community?.topics) ? community.topics.filter(Boolean) : [],
  }));
  return { communities };
};

const normalizeChallengeConfig = (config = {}) => ({
  title: config?.title || DEFAULT_CHALLENGE_CONFIG.title,
  theme: config?.theme || DEFAULT_CHALLENGE_CONFIG.theme,
  description: config?.description || DEFAULT_CHALLENGE_CONFIG.description,
});

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
  const themes = Array.isArray(profileData?.themes) ? profileData.themes : [];
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
  const [uploadContext, setUploadContext] = useState({ isChallenge: false });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [quickProfileId, setQuickProfileId] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [shadowProfile, setShadowProfile] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [moderationModal, setModerationModal] = useState(null);
  const [moderationActionPending, setModerationActionPending] = useState(false);
  const [moderatorAccess, setModeratorAccess] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [supportThreadId, setSupportThreadId] = useState(null);
  const [claimInviteToken, setClaimInviteToken] = useState(null);
  const ensuredSupportThreadUidRef = useRef(null);
  const userProfile = profile;
  const [communityConfig, setCommunityConfig] = useState(DEFAULT_COMMUNITY_CONFIG);
  const [challengeConfig, setChallengeConfig] = useState(DEFAULT_CHALLENGE_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);
  const handleOpenUploadModal = useCallback((options = {}) => {
    setUploadContext({ isChallenge: false, ...options });
    setShowUploadModal(true);
  }, []);

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
  const getClaimTokenFromPath = useCallback((path) => {
    if (!path?.startsWith('/claim/')) return null;
    const tokenPart = path.replace('/claim/', '');
    const token = tokenPart.split('/')[0];
    return token || null;
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

  const handleSaveCommunityConfig = useCallback(async (communityDraft, challengeDraft) => {
    const db = getFirebaseDbInstance();
    const normalizedCommunity = normalizeCommunityConfig(communityDraft);
    const normalizedChallenge = normalizeChallengeConfig(challengeDraft);
    const batch = writeBatch(db);
    batch.set(doc(db, 'config', 'community'), normalizedCommunity);
    batch.set(doc(db, 'config', 'challenge'), normalizedChallenge);
    await batch.commit();
    setCommunityConfig(normalizedCommunity);
    setChallengeConfig(normalizedChallenge);
  }, []);

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
        ensuredSupportThreadUidRef.current = null;
        const path = window.location.pathname || '/';
        const claimToken = getClaimTokenFromPath(path);
        setClaimInviteToken(claimToken);
        const unauthView = claimToken
          ? 'claim'
          : path.startsWith('/support')
          ? 'support'
          : path.startsWith('/chat') || path.startsWith('/messages')
            ? 'chat'
            : 'login';
        setView(unauthView);
        setProfileLoading(false);
        return;
      }
      try {
        if (u?.uid && ensuredSupportThreadUidRef.current !== u.uid) {
          ensuredSupportThreadUidRef.current = u.uid;
          ensureSupportThreadExists(u.uid).catch((error) => {
            console.error('[ArtesApp] Failed to ensure support thread', error);
          });
        }
        await migrateArtifactsUserData(u);
        const profileData = await ensureUserProfile(u);
        const normalized = normalizeProfileData(profileData, u.uid);
        setProfile(normalized);
        const onboardingComplete = profileData?.onboardingComplete === true;
        const baseView = onboardingComplete ? 'gallery' : 'onboarding';
        const path = window.location.pathname || '/';
        const claimToken = getClaimTokenFromPath(path);
        setClaimInviteToken(claimToken);
        const routedView = claimToken
          ? 'claim'
          : path.startsWith('/moderation')
          ? 'moderation'
          : path.startsWith('/vouch')
            ? 'vouch'
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
  }, [ensureModerationThread, getClaimTokenFromPath]);

  useEffect(() => {
    let active = true;
    const loadConfig = async () => {
      setConfigLoading(true);
      try {
        const db = getFirebaseDbInstance();
        const [communityDoc, challengeDoc] = await Promise.all([
          getDoc(doc(db, 'config', 'community')),
          getDoc(doc(db, 'config', 'challenge')),
        ]);
        if (!active) return;
        const communityData = communityDoc.exists() ? communityDoc.data() : null;
        const challengeData = challengeDoc.exists() ? challengeDoc.data() : null;
        setCommunityConfig(normalizeCommunityConfig(communityData));
        setChallengeConfig(normalizeChallengeConfig(challengeData));
      } catch (error) {
        console.error('Failed to load community config', error);
        if (!active) return;
        setCommunityConfig(DEFAULT_COMMUNITY_CONFIG);
        setChallengeConfig(DEFAULT_CHALLENGE_CONFIG);
      } finally {
        if (active) {
          setConfigLoading(false);
        }
      }
    };

    loadConfig();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!profile?.preferences?.theme) return;
    setDarkMode(profile.preferences.theme === 'dark');
  }, [profile?.preferences?.theme]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname || '/';
      if (path.startsWith('/claim/')) {
        setClaimInviteToken(getClaimTokenFromPath(path));
        setView('claim');
      } else if (path.startsWith('/moderation')) {
        setView('moderation');
      } else if (path.startsWith('/vouch')) {
        setView('vouch');
      } else if (path.startsWith('/support')) {
        setView('support');
      } else if (path.startsWith('/chat') || path.startsWith('/messages')) {
        setView('chat');
      } else if (view === 'moderation' || view === 'vouch' || view === 'support' || view === 'chat') {
        setView('gallery');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [view, getClaimTokenFromPath]);

  useEffect(() => {
    if (view === 'claim') {
      return;
    }
    if (view === 'moderation') {
      window.history.pushState({}, '', '/moderation');
    } else if (view === 'vouch') {
      window.history.pushState({}, '', '/vouch');
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
      || window.location.pathname === '/vouch'
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
    return onSnapshot(
      q,
      (snapshot) => {
        setUploads(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', 'Uploads listener (ArtesApp)'),
    );
  }, [authUser?.uid]);

  useEffect(() => {
    if (!authUser?.uid) return;
    let unsubscribe = null;
    let active = true;

    const setup = async () => {
      const db = getFirebaseDbInstance();
      try {
        const moderationDoc = await getDoc(doc(db, 'config', 'moderation'));
        const moderatorEmails = moderationDoc.exists() ? (moderationDoc.data().moderatorEmails || []) : [];
        
        console.log("MOD CHECK:", {
          email: authUser?.email,
          emailVerified: authUser?.emailVerified,
          moderatorEmailsCount: moderatorEmails?.length || 0,
          isModeratorClient: !!(authUser?.email && moderatorEmails.includes(authUser.email)),
        });
        
        const isModeratorClient = authUser?.email && moderatorEmails.includes(authUser.email);

        if (!isModeratorClient) {
          console.log('Moderation unread listener skipped: not a moderator');
          return;
        }

        const threadId = `moderation_${authUser.uid}`;
        const messagesRef = collection(db, 'threads', threadId, 'messages');
        const q = query(messagesRef, where('unread', '==', true), orderBy('createdAt', 'desc'), limit(1));

        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            if (!active) return;
            if (snapshot.empty) return;
            const docSnap = snapshot.docs[0];
            if (moderationModal?.id === docSnap.id) return;
            setModerationModal({ id: docSnap.id, ...docSnap.data() });
          },
          (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', 'Moderation unread listener (ArtesApp)'),
        );
      } catch (error) {
        console.error('Failed to setup moderation unread listener check', error);
      }
    };

    setup();

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
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

  // Live snapshot listener for own profile updates
  // This ensures UI updates immediately when profile is saved, not just on tab switch
  useEffect(() => {
    if (!authUser?.uid) return;
    
    const db = getFirebaseDbInstance();
    if (import.meta.env.DEV) {
      console.log('[ArtesApp] Setting up live profile listener for uid:', authUser.uid);
    }
    
    const unsubscribe = onSnapshot(
      doc(db, 'users', authUser.uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          if (import.meta.env.DEV) {
            console.log('[ArtesApp] Profile snapshot: doc does not exist');
          }
          return;
        }
        const normalized = normalizeProfileData(snapshot.data(), authUser.uid);
        if (import.meta.env.DEV) {
          console.log('[ArtesApp] Profile snapshot update received:', {
            themes: normalized.themes,
            displayName: normalized.displayName,
            bio: normalized.bio?.substring(0, 30),
          });
        }
        setProfile(normalized);
      },
      (error) => {
        console.error('[ArtesApp] Profile snapshot error:', error.code, error.message);
      }
    );
    
    return () => {
      if (import.meta.env.DEV) {
        console.log('[ArtesApp] Cleaning up profile listener for uid:', authUser.uid);
      }
      unsubscribe();
    };
  }, [authUser?.uid]);

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
      if (import.meta.env.DEV) {
        console.log('[ArtesApp] Saving theme preference:', nextTheme);
      }
      await updateUserProfile(authUser.uid, { preferences: nextPreferences });
      if (import.meta.env.DEV) {
        console.log('[ArtesApp] Theme save completed, snapshot listener will sync');
      }
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
    const finalProfile = {
      uid: authUser?.uid,
      displayName: profileData.displayName || 'Nieuwe Maker',
      bio: profileData.bio,
      roles,
      themes: Array.isArray(profileData.themes) ? profileData.themes : [],
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
      
      // Create support thread for the user after onboarding
      try {
        await ensureSupportThreadExists(authUser.uid);
        if (import.meta.env.DEV) {
          console.log('[ArtesApp] Created support thread after onboarding');
        }
      } catch (error) {
        console.error('[ArtesApp] Error creating support thread:', error);
        // Don't block onboarding if thread creation fails
      }
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

          {!profileLoading && view === 'claim' && (
            <ClaimInvitePage
              token={claimInviteToken}
              authUser={authUser}
              userProfile={profile}
              functionsBase={functionsBase}
              setView={setView}
            />
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
              functionsBase={functionsBase}
            />
          )}
          
          {!profileLoading && view === 'gallery' && (
            <Gallery 
              posts={posts} 
              onUserClick={setQuickProfileId}
              onShadowClick={setShadowProfile}
              onPostClick={setSelectedPost}
              onChallengeClick={() => setView('challenge_timeline')}
              profile={profile}
            />
          )}

          {!profileLoading && view === 'moderation' && (
            <ModerationPortal
              moderationApiBase={moderationApiBase}
              functionsBase={functionsBase}
              authUser={authUser}
              isModerator={moderatorAccess}
              uploads={uploads}
              moderationModal={moderationModal}
              moderationActionPending={moderationActionPending}
              onModerationAction={handleModerationAction}
              onCloseModerationModal={() => handleModerationAction('dismiss')}
              communityConfig={communityConfig}
              challengeConfig={challengeConfig}
              configLoading={configLoading}
              onSaveCommunityConfig={handleSaveCommunityConfig}
            />
          )}

          {!profileLoading && view === 'discover' && (
            <Discover
              users={users}
              posts={posts}
              currentUserId={authUser?.uid}
              onUserClick={setQuickProfileId}
              onPostClick={setSelectedPost}
              setView={setView}
            />
          )}
          
          {!profileLoading && view === 'community' && (
            <CommunityList
              setView={setView}
              communities={communityConfig.communities}
              challenge={challengeConfig}
              configLoading={configLoading}
              onStartChallengeUpload={() => handleOpenUploadModal({ isChallenge: true })}
            />
          )}
          {!profileLoading && view === 'support' && (
            <SupportLanding onOpenChat={handleOpenSupportChat} canOpenChat={Boolean(authUser)} />
          )}
          {!profileLoading && view === 'vouch' && (
            <VouchRequestsPanel
              authUser={authUser}
              functionsBase={functionsBase}
            />
          )}
          {!profileLoading && view === 'chat' && (
            authUser ? (
              <div className="max-w-6xl mx-auto px-4 py-6 h-[75vh]">
                <ChatPanel
                  authUser={authUser}
                  functionsBase={functionsBase}
                  initialThreadId={supportThreadId}
                  userProfile={userProfile}
                />
              </div>
            ) : (
              <div className="max-w-2xl mx-auto px-4 py-6">
                <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
                  Log in om de chat te openen.
                </div>
              </div>
            )
          )}
          {!profileLoading && view === 'challenge_timeline' && (
            <ChallengeDetail
              setView={setView}
              posts={posts.filter(p => p.isChallenge)}
              onPostClick={setSelectedPost}
              challenge={challengeConfig}
            />
          )}
          
          {!profileLoading && view.startsWith('community_') && (() => {
            const communityView = view.slice('community_'.length);
            const [communityId, topicTitleEncoded] = communityView.split('__topic__');
            const initialTopicTitle = topicTitleEncoded ? decodeURIComponent(topicTitleEncoded) : null;
            return (
              <CommunityDetail
                id={communityId}
                setView={setView}
                authUser={authUser}
                functionsBase={functionsBase}
                userProfile={userProfile}
                communities={communityConfig.communities}
                initialTopicTitle={initialTopicTitle}
              />
            );
          })()}

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
             <button onClick={() => handleOpenUploadModal()} className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl shadow-blue-600/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95">
               <Plus className="w-7 h-7" />
             </button>
           </div>
        )}

        {/* Modals */}
        {showUploadModal && (
          <UploadModal
            onClose={() => setShowUploadModal(false)}
            user={user}
            profile={profile}
            users={users}
            isChallenge={uploadContext.isChallenge}
          />
        )}
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
            onOpenVouchRequests={() => {
              setShowSettingsModal(false);
              setView('vouch');
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
        {shadowProfile && (
          <ShadowProfileModal
            name={shadowProfile.name}
            contributorId={shadowProfile.contributorId}
            posts={posts}
            onClose={() => setShadowProfile(null)}
            onPostClick={setSelectedPost}
            authUser={authUser}
            userProfile={userProfile}
            functionsBase={functionsBase}
            setView={setView}
          />
        )}

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

function Onboarding({ setView, users, onSignup, onCompleteProfile, onDeclineDidit, authUser, authError, profile, functionsBase }) {
    const [step, setStep] = useState(() => Math.max(1, profile?.onboardingStep ?? 1));
    const [roles, setRoles] = useState([]);
    const MATCH_STEP = 1.5;
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
    const [contributorMatches, setContributorMatches] = useState([]);
    const [matchLoading, setMatchLoading] = useState(false);
    const [matchError, setMatchError] = useState(null);
    const [pendingClaimContributorId, setPendingClaimContributorId] = useState(profile?.pendingClaimContributorId || null);
    const [pendingClaimContributorName, setPendingClaimContributorName] = useState(null);
    const claimRequestInFlightRef = useRef(false);
    const enableEmail = import.meta.env.VITE_ENABLE_EMAIL_SIGNIN !== 'false';
    const isGoogleUser = authUser?.providerData?.some((provider) => provider?.providerId === 'google.com')
      || profile?.authProvider === 'google.com';
    const normalizeDisplayName = (value) => String(value || '').trim().toLowerCase();
    const resolvedPendingClaimContributorId = pendingClaimContributorId || profile?.pendingClaimContributorId || null;
    const resolvedPendingClaimContributorName = pendingClaimContributorName || profile?.pendingClaimContributorName || null;

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
        if (step === MATCH_STEP && profile.onboardingStep === 2) return;
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

    useEffect(() => {
      if (!profile?.pendingClaimContributorId) return;
      setPendingClaimContributorId(profile.pendingClaimContributorId);
    }, [profile?.pendingClaimContributorId]);

    useEffect(() => {
      if (!profile?.pendingClaimContributorName) return;
      setPendingClaimContributorName(profile.pendingClaimContributorName);
    }, [profile?.pendingClaimContributorName]);

    const fetchContributorMatches = async (displayName) => {
      const normalized = normalizeDisplayName(displayName);
      if (!normalized) return [];
      const db = getFirebaseDbInstance();
      const contributorsRef = collection(db, CLAIMS_COLLECTIONS.contributors);
      const q = query(
        contributorsRef,
        orderBy('displayNameLower'),
        startAt(normalized),
        endAt(`${normalized}\uf8ff`),
        limit(5),
      );
      const snapshot = await getDocs(q);
      return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((item) => {
          const candidate = normalizeDisplayName(item.displayNameLower || item.displayName);
          return candidate === normalized || candidate.startsWith(normalized);
        });
    };

    const handleStartPendingClaim = useCallback(async () => {
      if (!authUser?.uid || !resolvedPendingClaimContributorId || !profile?.ageVerified) return;
      if (!functionsBase) return;
      if (claimRequestInFlightRef.current) return;
      claimRequestInFlightRef.current = true;
      try {
        const authToken = await authUser.getIdToken();
        const response = await fetch(`${functionsBase}/createClaimRequest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            contributorId: resolvedPendingClaimContributorId,
            mode: 'link',
            method: 'onboarding',
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Claim verzoek mislukt.');
        }
        await updateUserProfile(authUser.uid, {
          pendingClaimContributorId: null,
          pendingClaimContributorName: null,
        });
        setPendingClaimContributorId(null);
        setPendingClaimContributorName(null);
      } catch (error) {
        console.error('[Onboarding] Failed to start claim request', error);
        claimRequestInFlightRef.current = false;
      }
    }, [
      authUser?.uid,
      resolvedPendingClaimContributorId,
      resolvedPendingClaimContributorName,
      profile?.ageVerified,
      functionsBase,
    ]);

    const handleSelectContributor = useCallback(async (match) => {
      const contributorId = match?.id || match?.contributorId || null;
      if (!contributorId) {
        setMatchError('Geen geldig contributorprofiel gevonden.');
        return;
      }
      setPendingClaimContributorId(contributorId);
      setPendingClaimContributorName(match?.displayName || null);
      try {
        if (authUser?.uid) {
          await updateUserProfile(authUser.uid, {
            pendingClaimContributorId: contributorId,
            pendingClaimContributorName: match?.displayName || null,
          });
        }
      } catch (error) {
        console.error('[Onboarding] Failed to store pending claim', error);
        setMatchError(error?.message || 'Claim opslaan mislukt.');
      } finally {
        setStep(2);
      }
    }, [authUser?.uid]);

    const handleSkipContributorMatch = () => {
      setStep(2);
    };

    useEffect(() => {
      if (!resolvedPendingClaimContributorId || !profile?.ageVerified) return;
      handleStartPendingClaim();
    }, [resolvedPendingClaimContributorId, profile?.ageVerified, handleStartPendingClaim]);

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
                setMatchError(null);
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
                setMatchLoading(true);
                let matches = [];
                try {
                  matches = await fetchContributorMatches(profileData.displayName);
                } catch (matchErr) {
                  console.error('[Onboarding] Contributor match lookup failed', matchErr);
                  setMatchError('Zoekactie naar bestaande profielen mislukt.');
                }
                if (matches.length > 0) {
                  setContributorMatches(matches);
                  setStep(MATCH_STEP);
                } else {
                  setStep(2);
                }
              } catch (e) {
                setError(e.message);
              } finally {
                setMatchLoading(false);
                setPending(false);
              }
          }} className="w-full" disabled={pending || (!accountCreated && (!email || !password))}> {pending ? 'Bezig...' : accountCreated ? 'Ga verder' : 'Account aanmaken'} </Button>
        </div>
      </div>
    );

    if (step === MATCH_STEP) return (
      <div className="max-w-2xl mx-auto py-12 px-4 animate-in slide-in-from-right duration-300">
        <h2 className="text-sm font-bold text-blue-600 uppercase tracking-wide mb-1">Stap 1/5</h2>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-4">Ben jij misschien al toegevoegd?</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          We vonden bestaande profielen die lijken op je naam. Selecteer je profiel om later te claimen.
        </p>
        <div className="space-y-4">
          {matchError && <p className="text-sm text-red-500">{matchError}</p>}
          {matchLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="grid gap-4">
              {contributorMatches.map((match) => (
                <div
                  key={match.id}
                  className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col gap-3"
                >
                  <div>
                    <p className="text-lg font-semibold text-slate-900 dark:text-white">{match.displayName}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {match.instagramHandle && <span>@{match.instagramHandle}</span>}
                      {match.website && <span>{match.website}</span>}
                      {match.email && <span>{match.email}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button onClick={() => handleSelectContributor(match)} className="flex-1">
                      Dit ben ik
                    </Button>
                  </div>
                </div>
              ))}
              {contributorMatches.length === 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-6 text-center text-sm text-slate-500 dark:text-slate-300">
                  Geen matches gevonden.
                </div>
              )}
            </div>
          )}
        </div>
        <div className="mt-6">
          <Button variant="secondary" onClick={handleSkipContributorMatch} className="w-full">
            Geen van deze
          </Button>
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
                    <div
                      key={i}
                      className="cursor-pointer group"
                      onClick={() =>
                        c.uid
                          ? onUserClick(c.uid)
                          : onShadowClick({ name: c.name, contributorId: c.contributorId || null })
                      }
                    >
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

function Discover({ users, posts, currentUserId, onUserClick, onPostClick, setView }) {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [activeThemes, setActiveThemes] = useState([]);
  const [activeRole, setActiveRole] = useState(null);
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [showAllRoles, setShowAllRoles] = useState(false);

  const visibleUsers = useMemo(
    () => users.filter((u) => !currentUserId || u.uid !== currentUserId),
    [users, currentUserId]
  );
  const visiblePosts = useMemo(
    () => posts.filter((p) => !currentUserId || p.authorId !== currentUserId),
    [posts, currentUserId]
  );

  const displayedThemes = showAllThemes ? THEMES : THEMES.slice(0, 5);
  const displayedRoles = showAllRoles ? ROLES : ROLES.slice(0, 5);
  
  const toggleTheme = (t) => setActiveThemes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  const mixedContent = useMemo(() => {
     if (tab !== 'all') return [];
     const res = [];
     const max = Math.max(visibleUsers.length, visiblePosts.length);
     for(let i=0; i<max; i++) {
        if(visiblePosts[i]) res.push({type: 'post', data: visiblePosts[i]});
        if(visibleUsers[i]) res.push({type: 'user', data: visibleUsers[i]});
     }
     return res.filter(i => (i.type === 'post' ? i.data.title : i.data.displayName).toLowerCase().includes(search.toLowerCase()));
  }, [visibleUsers, visiblePosts, search, tab]);

  const filteredPosts = visiblePosts.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) && (activeThemes.length === 0 || p.styles?.some(s => activeThemes.includes(s))));
  const filteredUsers = visibleUsers.filter((u) => (
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
                {themes && themes.length > 0 ? (
                  themes.map((theme) => (
                    <span key={theme} className={`px-3 py-1 rounded-full text-xs font-semibold border ${getThemeStyle(theme)}`}>
                      {theme}
                    </span>
                  ))
                ) : null}
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
  const reviewCasesListenerLogRef = useRef(null);

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
      if (reviewCasesListenerLogRef.current !== reason) {
        console.log(`[ModerationPanel] reviewCases listener ${reason}`);
        reviewCasesListenerLogRef.current = reason;
      }
    }
    if (!shouldStart) return;
    const db = getFirebaseDbInstance();
    const q = query(collection(db, 'reviewCases'), where('status', '==', 'inReview'), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        setCases(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', 'Moderation reviewCases listener (ArtesApp)'),
    );
  }, [authUser, isModerator]);

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

function ContributorMergeTool({ authUser, functionsBase }) {
  const [primaryContributorId, setPrimaryContributorId] = useState('');
  const [secondaryContributorId, setSecondaryContributorId] = useState('');
  const [primaryQuery, setPrimaryQuery] = useState('');
  const [secondaryQuery, setSecondaryQuery] = useState('');
  const [primaryMatches, setPrimaryMatches] = useState([]);
  const [secondaryMatches, setSecondaryMatches] = useState([]);
  const [primaryLoading, setPrimaryLoading] = useState(false);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [mergeState, setMergeState] = useState({ pending: false, error: '', success: '' });
  const [mergeSummary, setMergeSummary] = useState(null);

  const normalizeTerm = (value) => String(value || '').trim().toLowerCase();

  const searchContributors = useCallback(async (term, setMatches, setLoading) => {
    const normalized = normalizeTerm(term);
    if (!normalized) {
      setMatches([]);
      return;
    }
    setLoading(true);
    try {
      const db = getFirebaseDbInstance();
      const contributorsRef = collection(db, CLAIMS_COLLECTIONS.contributors);
      const q = query(
        contributorsRef,
        orderBy('displayNameLower'),
        startAt(normalized),
        endAt(`${normalized}\uf8ff`),
        limit(5),
      );
      const snapshot = await getDocs(q);
      setMatches(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
    } catch (error) {
      console.error('[ContributorMergeTool] search failed', error);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectMatch = (match, setId, setQuery, setMatches) => {
    setId(match.id);
    setQuery(match.displayName || match.id);
    setMatches([]);
  };

  const handleMerge = async () => {
    if (!authUser?.uid) {
      setMergeState({ pending: false, error: 'Log in om te mergen.', success: '' });
      return;
    }
    if (!functionsBase) {
      setMergeState({ pending: false, error: 'Merge endpoint ontbreekt.', success: '' });
      return;
    }
    const primaryId = primaryContributorId.trim();
    const secondaryId = secondaryContributorId.trim();
    if (!primaryId || !secondaryId) {
      setMergeState({ pending: false, error: 'Vul beide contributor IDs in.', success: '' });
      return;
    }
    if (primaryId === secondaryId) {
      setMergeState({ pending: false, error: 'Primary en secondary mogen niet gelijk zijn.', success: '' });
      return;
    }
    if (!window.confirm('Weet je zeker dat je deze contributors wilt mergen? Dit kan niet ongedaan gemaakt worden.')) {
      return;
    }
    setMergeState({ pending: true, error: '', success: '' });
    setMergeSummary(null);
    try {
      const token = await authUser.getIdToken();
      const response = await fetch(`${functionsBase}/mergeContributors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          primaryContributorId: primaryId,
          secondaryContributorId: secondaryId,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || 'Merge mislukt.');
      }
      setMergeSummary(data);
      setMergeState({ pending: false, error: '', success: 'Merge uitgevoerd.' });
    } catch (error) {
      setMergeState({ pending: false, error: error.message || 'Merge mislukt.', success: '' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold dark:text-white">Merge contributors</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Verplaats posts en aliases van secondary naar primary en markeer secondary als merged.
            </p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center">
            <GitMerge className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">Primary contributor</p>
              <input
                className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                placeholder="Primary contributor ID"
                value={primaryContributorId}
                onChange={(event) => setPrimaryContributorId(event.target.value)}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">Zoek op naam</p>
              <div className="mt-2 flex gap-2">
                <input
                  className="flex-1 p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                  placeholder="Naam of Instagram"
                  value={primaryQuery}
                  onChange={(event) => setPrimaryQuery(event.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => searchContributors(primaryQuery, setPrimaryMatches, setPrimaryLoading)}
                  disabled={primaryLoading}
                >
                  {primaryLoading ? 'Zoeken...' : 'Zoek'}
                </Button>
              </div>
              {primaryMatches.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {primaryMatches.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => handleSelectMatch(match, setPrimaryContributorId, setPrimaryQuery, setPrimaryMatches)}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{match.displayName || match.id}</p>
                      <p className="text-xs text-slate-500">{match.id}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">Secondary contributor</p>
              <input
                className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                placeholder="Secondary contributor ID"
                value={secondaryContributorId}
                onChange={(event) => setSecondaryContributorId(event.target.value)}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-300">Zoek op naam</p>
              <div className="mt-2 flex gap-2">
                <input
                  className="flex-1 p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                  placeholder="Naam of Instagram"
                  value={secondaryQuery}
                  onChange={(event) => setSecondaryQuery(event.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => searchContributors(secondaryQuery, setSecondaryMatches, setSecondaryLoading)}
                  disabled={secondaryLoading}
                >
                  {secondaryLoading ? 'Zoeken...' : 'Zoek'}
                </Button>
              </div>
              {secondaryMatches.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {secondaryMatches.map((match) => (
                    <button
                      key={match.id}
                      type="button"
                      onClick={() => handleSelectMatch(match, setSecondaryContributorId, setSecondaryQuery, setSecondaryMatches)}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{match.displayName || match.id}</p>
                      <p className="text-xs text-slate-500">{match.id}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {mergeState.error && (
          <p className="text-sm text-red-500">{mergeState.error}</p>
        )}
        {mergeState.success && (
          <p className="text-sm text-emerald-500">{mergeState.success}</p>
        )}
        {mergeSummary && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-600 dark:text-slate-300">
            <p>Posts bijgewerkt: {mergeSummary.updatedPosts || 0}</p>
            <p>Aliases verplaatst: {mergeSummary.movedAliases || 0}</p>
            {mergeSummary.skippedAliases ? <p>Aliases overgeslagen: {mergeSummary.skippedAliases}</p> : null}
          </div>
        )}

        <Button onClick={handleMerge} disabled={mergeState.pending} className="w-full">
          {mergeState.pending ? 'Merge uitvoeren...' : 'Merge uitvoeren'}
        </Button>
      </div>
    </div>
  );
}

function ModerationPortal({
  moderationApiBase,
  functionsBase,
  authUser,
  isModerator,
  uploads,
  moderationModal,
  moderationActionPending,
  onModerationAction,
  onCloseModerationModal,
  communityConfig,
  challengeConfig,
  configLoading,
  onSaveCommunityConfig,
}) {
  const [activeTab, setActiveTab] = useState('chat');
  const [communityDraft, setCommunityDraft] = useState(DEFAULT_COMMUNITY_CONFIG);
  const [challengeDraft, setChallengeDraft] = useState(DEFAULT_CHALLENGE_CONFIG);
  const [configErrors, setConfigErrors] = useState({ communities: [], challenge: {} });
  const [configSaveState, setConfigSaveState] = useState({ saving: false, error: null, success: false });
  const hasLoadedConfigRef = useRef(false);

  useEffect(() => {
    if (configLoading) return;
    if (!hasLoadedConfigRef.current) {
      setCommunityDraft(normalizeCommunityConfig(communityConfig));
      setChallengeDraft(normalizeChallengeConfig(challengeConfig));
      setConfigErrors({ communities: [], challenge: {} });
      hasLoadedConfigRef.current = true;
    }
  }, [communityConfig, challengeConfig, configLoading]);

  useEffect(() => {
    if (configSaveState.success) {
      setConfigSaveState((prev) => ({ ...prev, success: false }));
    }
  }, [communityDraft, challengeDraft, configSaveState.success]);

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

  const updateCommunityField = (index, field, value) => {
    setCommunityDraft((prev) => {
      const next = prev.communities.map((community, communityIndex) => (
        communityIndex === index ? { ...community, [field]: value } : community
      ));
      return { ...prev, communities: next };
    });
  };

  const handleCommunityTopicsChange = (index, value) => {
    const topics = value
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean);
    updateCommunityField(index, 'topics', topics);
  };

  const handleAddCommunity = () => {
    setCommunityDraft((prev) => ({
      ...prev,
      communities: [
        ...prev.communities,
        {
          id: `community_${prev.communities.length + 1}`,
          title: '',
          description: '',
          iconKey: 'users',
          topics: [],
        },
      ],
    }));
  };

  const handleRemoveCommunity = (index) => {
    setCommunityDraft((prev) => ({
      ...prev,
      communities: prev.communities.filter((_, communityIndex) => communityIndex !== index),
    }));
  };

  const validateConfigDraft = () => {
    const idCounts = communityDraft.communities.reduce((acc, community) => {
      const id = community.id?.trim();
      if (!id) return acc;
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});

    const communityErrors = communityDraft.communities.map((community) => {
      const errors = {};
      const trimmedId = community.id?.trim();
      if (!trimmedId) {
        errors.id = 'Vul een unieke sleutel in.';
      } else if (idCounts[trimmedId] > 1) {
        errors.id = 'Community ID moet uniek zijn.';
      }
      if (!community.title?.trim()) {
        errors.title = 'Titel is verplicht.';
      }
      if (!community.description?.trim()) {
        errors.description = 'Beschrijving is verplicht.';
      }
      if (!community.iconKey) {
        errors.iconKey = 'Kies een icoon.';
      }
      if (!community.topics || community.topics.length === 0) {
        errors.topics = 'Voeg minstens één topic toe.';
      }
      return errors;
    });

    const challengeErrors = {};
    if (!challengeDraft.title?.trim()) {
      challengeErrors.title = 'Titel is verplicht.';
    }
    if (!challengeDraft.theme?.trim()) {
      challengeErrors.theme = 'Thema is verplicht.';
    }
    if (!challengeDraft.description?.trim()) {
      challengeErrors.description = 'Beschrijving is verplicht.';
    }

    const hasCommunityErrors = communityErrors.some((errors) => Object.keys(errors).length > 0);
    const hasChallengeErrors = Object.keys(challengeErrors).length > 0;

    setConfigErrors({ communities: communityErrors, challenge: challengeErrors });

    return !(hasCommunityErrors || hasChallengeErrors);
  };

  const handleSaveConfig = async () => {
    if (configLoading || configSaveState.saving) return;
    if (!validateConfigDraft()) return;
    setConfigSaveState({ saving: true, error: null, success: false });
    try {
      await onSaveCommunityConfig(communityDraft, challengeDraft);
      setConfigSaveState({ saving: false, error: null, success: true });
    } catch (error) {
      console.error('Failed to save community config', error);
      setConfigSaveState({
        saving: false,
        error: 'Opslaan mislukt. Probeer het opnieuw.',
        success: false,
      });
    }
  };

  const tabs = [
    { id: 'chat', label: 'Berichten', icon: MessageCircle },
    { id: 'review', label: 'Review voor posten', icon: ImageIcon },
    { id: 'reports', label: 'Rapportages', icon: AlertTriangle },
    { id: 'community', label: 'Community', icon: Users },
    { id: 'merge', label: 'Merge', icon: GitMerge },
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

      {activeTab === 'community' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold dark:text-white">Community configuratie</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Beheer community-tegels en de wekelijkse challenge voor de community-pagina.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleSaveConfig}
                  disabled={configLoading || configSaveState.saving}
                  className="whitespace-nowrap"
                >
                  {configLoading
                    ? 'Configuratie laden...'
                    : configSaveState.saving
                      ? 'Opslaan...'
                      : 'Configuratie opslaan'}
                </Button>
              </div>
            </div>
            {configLoading && (
              <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Configuratie laden...
              </div>
            )}
            {configSaveState.error && (
              <div className="text-sm text-red-500">{configSaveState.error}</div>
            )}
            {configSaveState.success && (
              <div className="text-sm text-emerald-500">Configuratie opgeslagen.</div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
              <div>
                <h4 className="font-semibold dark:text-white">Monthly Challenge</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400">Teksten die bovenaan de community-pagina staan.</p>
              </div>
              <div className="grid gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Titel</label>
                  <input
                    className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                    value={challengeDraft.title}
                    onChange={(event) => setChallengeDraft((prev) => ({ ...prev, title: event.target.value }))}
                  />
                  {configErrors.challenge?.title && (
                    <p className="text-xs text-red-500 mt-1">{configErrors.challenge.title}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Thema</label>
                  <input
                    className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                    value={challengeDraft.theme}
                    onChange={(event) => setChallengeDraft((prev) => ({ ...prev, theme: event.target.value }))}
                  />
                  {configErrors.challenge?.theme && (
                    <p className="text-xs text-red-500 mt-1">{configErrors.challenge.theme}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Beschrijving</label>
                  <textarea
                    className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                    rows={4}
                    value={challengeDraft.description}
                    onChange={(event) => setChallengeDraft((prev) => ({ ...prev, description: event.target.value }))}
                  />
                  {configErrors.challenge?.description && (
                    <p className="text-xs text-red-500 mt-1">{configErrors.challenge.description}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold dark:text-white">Community-tegels</h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Voeg communities toe of pas bestaande aan.</p>
                </div>
                <Button variant="ghost" onClick={handleAddCommunity}>
                  <Plus className="w-4 h-4 mr-2" />
                  Community toevoegen
                </Button>
              </div>
              <div className="space-y-6">
                {communityDraft.communities.map((community, index) => {
                  const Icon = resolveCommunityIcon(community.iconKey);
                  const errors = configErrors.communities?.[index] || {};
                  return (
                    <div
                      key={`${community.id}-${index}`}
                      className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center">
                            <Icon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                              Community {index + 1}
                            </p>
                            <p className="text-xs text-slate-400">Pas titel, beschrijving en topics aan.</p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => handleRemoveCommunity(index)}
                          disabled={communityDraft.communities.length <= 1}
                        >
                          <Trash2 className="w-4 h-4 mr-1" />
                          Verwijderen
                        </Button>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Community ID</label>
                          <input
                            className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            value={community.id}
                            onChange={(event) => updateCommunityField(index, 'id', event.target.value)}
                          />
                          {errors.id && <p className="text-xs text-red-500 mt-1">{errors.id}</p>}
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Icon-key</label>
                          <select
                            className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            value={community.iconKey}
                            onChange={(event) => updateCommunityField(index, 'iconKey', event.target.value)}
                          >
                            {COMMUNITY_ICON_OPTIONS.map((option) => (
                              <option key={option.key} value={option.key}>{option.label}</option>
                            ))}
                          </select>
                          {errors.iconKey && <p className="text-xs text-red-500 mt-1">{errors.iconKey}</p>}
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Titel</label>
                          <input
                            className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            value={community.title}
                            onChange={(event) => updateCommunityField(index, 'title', event.target.value)}
                          />
                          {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title}</p>}
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Beschrijving</label>
                          <input
                            className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                            value={community.description}
                            onChange={(event) => updateCommunityField(index, 'description', event.target.value)}
                          />
                          {errors.description && <p className="text-xs text-red-500 mt-1">{errors.description}</p>}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Topics (komma-gescheiden)</label>
                        <input
                          className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                          value={community.topics.join(', ')}
                          onChange={(event) => handleCommunityTopicsChange(index, event.target.value)}
                        />
                        <p className="text-xs text-slate-400 mt-1">Bijv. consent, crew gezocht, portfolio shoots</p>
                        {errors.topics && <p className="text-xs text-red-500 mt-1">{errors.topics}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'merge' && (
        <ContributorMergeTool authUser={authUser} functionsBase={functionsBase} />
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

function UploadModal({ onClose, user, profile, users, isChallenge = false }) {
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
  const [newCredit, setNewCredit] = useState({
    role: 'model',
    name: '',
    instagramHandle: '',
    website: '',
    email: '',
  });
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCandidates, setInviteCandidates] = useState([]);
  const [inviteShareLinks, setInviteShareLinks] = useState([]);
  const [inviteShareOpen, setInviteShareOpen] = useState(false);
  const [inviteShareError, setInviteShareError] = useState('');
  const [inviteShareCopied, setInviteShareCopied] = useState('');
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
  const [allowExternalOverride, setAllowExternalOverride] = useState(false);

  // Contributor search logic
  const [contributorSearch, setContributorSearch] = useState('');
  const normalizeDisplayName = (value) => String(value || '').trim().toLowerCase();
  const getContributorMatches = (term) => {
    const normalizedTerm = normalizeDisplayName(term);
    if (!normalizedTerm) return [];
    return users.filter((u) => {
      const candidate = normalizeDisplayName(u.displayNameLower || u.displayName);
      return candidate === normalizedTerm || candidate.startsWith(normalizedTerm);
    }).slice(0, 5);
  };
  const searchResults = useMemo(() => {
    if (!contributorSearch) return [];
    return getContributorMatches(contributorSearch);
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

  const addCredit = async (foundUser) => {
     if(foundUser) {
        setCredits((prev) => ([...prev, { role: newCredit.role, name: foundUser.displayName, uid: foundUser.uid, contributorId: foundUser.contributorId || null }]));
        setContributorSearch('');
        setAllowExternalOverride(false);
        setNewCredit({ role: newCredit.role, name: '', instagramHandle: '', website: '', email: '' });
        setShowInvite(false);
        return;
     }

     const displayName = newCredit.name.trim();
     if(!displayName) return;
     const nameMatches = getContributorMatches(displayName);
     if (nameMatches.length > 0 && !allowExternalOverride) {
       setContributorSearch(displayName);
       setShowInvite(false);
       return;
     }

     const normalizedInstagram = normalizeInstagram(newCredit.instagramHandle);
     const normalizedWebsite = normalizeDomain(newCredit.website);
     const normalizedEmail = normalizeEmail(newCredit.email);
     const aliasCandidates = [
       normalizedInstagram ? { type: 'instagram', value: normalizedInstagram } : null,
       normalizedWebsite ? { type: 'domain', value: normalizedWebsite } : null,
       normalizedEmail ? { type: 'email', value: normalizedEmail } : null,
     ].filter(Boolean);

     let contributorId = null;
     for (const alias of aliasCandidates) {
       const lookup = await getContributorByAlias(alias.type, alias.value);
       if (import.meta.env.DEV) {
         console.log('[ContributorAlias] lookup', {
           type: alias.type,
           value: alias.value,
           hit: Boolean(lookup?.contributor?.id),
         });
       }
       if (lookup?.contributor?.id && !contributorId) {
         contributorId = lookup.contributor.id;
       } else if (lookup?.contributor?.id && contributorId && contributorId !== lookup.contributor.id) {
         if (import.meta.env.DEV) {
           console.warn('[ContributorAlias] multiple contributors found', {
             primary: contributorId,
             secondary: lookup.contributor.id,
           });
         }
       }
     }

     let createdAliasIds = [];
     if (!contributorId) {
       const result = await createContributorWithAliases({
         displayName,
         instagramHandle: normalizedInstagram || undefined,
         website: normalizedWebsite || undefined,
         email: normalizedEmail || undefined,
       });
       contributorId = result.contributorId;
       createdAliasIds = result.aliasIds;
       setInviteCandidates((prev) => {
         if (prev.some((entry) => entry.contributorId === contributorId)) return prev;
         return [...prev, { contributorId, displayName }];
       });
       if (import.meta.env.DEV) {
         console.log('[Contributor] created', contributorId);
       }
     }

     if (import.meta.env.DEV && createdAliasIds.length > 0) {
       console.log('[ContributorAlias] created', createdAliasIds);
     }

     setCredits((prev) => ([
       ...prev,
       {
         role: newCredit.role,
         name: displayName,
         contributorId,
         instagramHandle: normalizedInstagram || null,
         website: normalizedWebsite || null,
         email: normalizedEmail || null,
         isExternal: true,
       },
     ]));
     setContributorSearch('');
     setAllowExternalOverride(false);
     setNewCredit({ role: 'model', name: '', instagramHandle: '', website: '', email: '' });
     setShowInvite(false);
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
      const publishedDoc = await publishPost({
        title,
        description: desc,
        imageUrl: image,
        authorId: user.uid,
        authorName: profile.displayName,
        authorRole: uploaderRole,
        styles: selectedStyles,
        sensitive: triggerFlag,
        triggers: finalAppliedTriggers.map(getTriggerLabel),
        makerTags,
        appliedTriggers: finalAppliedTriggers,
        outcome: nextOutcome || 'unchecked',
        forbiddenReasons: effectiveForbiddenReasons,
        reviewCaseId: effectiveReviewCaseId,
        credits,
        likes: 0,
        isChallenge,
      });
      const postId = publishedDoc?.id || null;

      setErrors({});
      setImage(null);
      setTitle('');
      setDesc('');
      setSelectedStyles([]);
                      setCredits([{ role: defaultRole, name: profile.displayName, uid: profile.uid, isSelf: true }]);
      setNewCredit({ role: 'model', name: '', instagramHandle: '', website: '', email: '' });
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

      if (inviteCandidates.length > 0) {
        setInviteShareError('');
        setInviteShareCopied('');
        const baseUrl = window.location.origin;
        try {
          const inviteResults = await Promise.all(
            inviteCandidates.map(async (candidate) => {
              const result = await createClaimInvite({
                contributorId: candidate.contributorId,
                postId,
              });
              const path = result?.path || '';
              return {
                contributorId: candidate.contributorId,
                displayName: candidate.displayName,
                url: path ? new URL(path, baseUrl).toString() : '',
              };
            })
          );
          setInviteShareLinks(inviteResults.filter((entry) => entry.url));
          setInviteShareOpen(true);
        } catch (error) {
          console.error('[UploadModal] Failed to create claim invite', error);
          setInviteShareError(error?.message || 'Invite link maken mislukt.');
          setInviteShareOpen(true);
        } finally {
          setInviteCandidates([]);
        }
        return;
      }

      onClose();
    } catch (error) {
      console.error('Publish error', error);
      setPublishError('Er ging iets mis bij het publiceren. Probeer het opnieuw.');
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
       {inviteShareOpen && (
         <div className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center p-6">
           <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 w-full max-w-lg space-y-4">
             <div>
               <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Kopieer invite link</h3>
               <p className="text-sm text-slate-500 dark:text-slate-400">
                 Deel deze link zodat de contributor het profiel kan claimen.
               </p>
             </div>
             {inviteShareError && (
               <p className="text-sm text-rose-500">{inviteShareError}</p>
             )}
             {!inviteShareError && inviteShareLinks.length === 0 && (
               <p className="text-sm text-slate-500 dark:text-slate-400">Invite link laden...</p>
             )}
             {inviteShareLinks.length > 0 && (
               <div className="space-y-3">
                 {inviteShareLinks.map((invite) => (
                   <div key={invite.contributorId} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 flex flex-col gap-2">
                     <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                       {invite.displayName}
                     </div>
                     <div className="flex items-center gap-2">
                       <input
                         readOnly
                         value={invite.url}
                         className="flex-1 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-300"
                       />
                       <button
                         type="button"
                         onClick={async () => {
                           if (!invite.url) return;
                           await navigator.clipboard.writeText(invite.url);
                           setInviteShareCopied(invite.url);
                         }}
                         className="rounded-full bg-blue-600 text-white px-4 py-2 text-xs font-semibold"
                       >
                         Kopieer
                       </button>
                     </div>
                     {inviteShareCopied === invite.url && (
                       <p className="text-xs text-emerald-500">Gekopieerd!</p>
                     )}
                   </div>
                 ))}
               </div>
             )}
             <button
               type="button"
               onClick={() => {
                 setInviteShareOpen(false);
                 onClose();
               }}
               className="w-full rounded-full bg-slate-900 text-white px-4 py-2 text-sm font-semibold"
             >
               Sluiten
             </button>
           </div>
         </div>
       )}
       <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[85vh] rounded-3xl overflow-hidden flex flex-col">
          <div className="p-4 border-b flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h3 className="font-bold dark:text-white">Beeld publiceren</h3>
              {isChallenge && (
                <span className="text-xs uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                  Challenge
                </span>
              )}
            </div>
            <button onClick={onClose}><X className="dark:text-white"/></button>
          </div>
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
                            <select className="p-2 border rounded text-sm w-1/3" value={newCredit.role} onChange={e => setNewCredit((prev) => ({...prev, role: e.target.value}))}>{ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                            <div className="relative flex-1">
                                <input 
                                   className="w-full p-2 border rounded text-sm" 
                                   placeholder="Zoek naam..." 
                                   value={contributorSearch || newCredit.name} 
                                   onChange={e => {
                                      setContributorSearch(e.target.value);
                                      setNewCredit((prev) => ({...prev, name: e.target.value}));
                                      setAllowExternalOverride(false);
                                      if(!e.target.value) setShowInvite(false);
                                   }} 
                                />
                                {contributorSearch && searchResults.length > 0 && (
                                   <div className="absolute top-full left-0 right-0 bg-white border mt-1 rounded shadow-lg max-h-40 overflow-y-auto z-10">
                                      <p className="px-2 pt-2 text-[11px] text-slate-500">Selecteer een bestaande bijdrager.</p>
                                      {searchResults.map(u => (
                                         <div key={u.uid} className="p-2 hover:bg-slate-100 cursor-pointer text-sm" onClick={() => void addCredit(u)}>{u.displayName}</div>
                                      ))}
                                      <button
                                        type="button"
                                        className="w-full border-t text-xs text-slate-600 px-2 py-2 text-left hover:bg-slate-50"
                                        onClick={() => {
                                          setAllowExternalOverride(true);
                                          setShowInvite(true);
                                        }}
                                      >
                                        Toch extern toevoegen
                                      </button>
                                   </div>
                                )}
                                {contributorSearch && searchResults.length === 0 && (
                                    <div className="absolute top-full left-0 right-0 bg-white border mt-1 rounded shadow-lg p-2 z-10">
                                        <p className="text-xs text-orange-500 mb-2">Geen gebruiker gevonden.</p>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setAllowExternalOverride(true);
                                            setShowInvite(true);
                                          }}
                                          className="text-xs bg-slate-100 p-1 rounded w-full"
                                        >
                                          Voeg toe als extern
                                        </button>
                                    </div>
                                )}
                            </div>
                         </div>
                         
                         {showInvite && (
                            <div className="bg-yellow-50 p-3 rounded text-xs text-yellow-800 mb-2 border border-yellow-200">
                               <p className="mb-2 font-semibold">Ongeclaimd profiel aanmaken voor {newCredit.name}</p>
                               <input
                                 className="w-full p-2 rounded border mb-2"
                                 placeholder="Instagram handle (optioneel)"
                                 value={newCredit.instagramHandle}
                                 onChange={e => setNewCredit((prev) => ({...prev, instagramHandle: e.target.value}))}
                               />
                               <input
                                 className="w-full p-2 rounded border mb-2"
                                 placeholder="Website domein (optioneel)"
                                 value={newCredit.website}
                                 onChange={e => setNewCredit((prev) => ({...prev, website: e.target.value}))}
                               />
                               <input
                                 className="w-full p-2 rounded border mb-2"
                                 placeholder="Email (optioneel)"
                                 value={newCredit.email}
                                 onChange={e => setNewCredit((prev) => ({...prev, email: e.target.value}))}
                               />
                               <button onClick={() => void addCredit(null)} className="w-full bg-yellow-600 text-white py-1 rounded">Toevoegen</button>
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
       if (import.meta.env.DEV) {
         console.log('[EditProfileModal] Saving profile with payload:', { 
           displayName: payload.displayName, 
           themes: payload.themes, 
           roles: payload.roles 
         });
       }
       await updateUserProfile(user.uid, payload);
       if (import.meta.env.DEV) {
         console.log('[EditProfileModal] Profile save completed, snapshot listener will update UI');
       }
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
                     onClick={() => {
                       if (import.meta.env.DEV) {
                         console.log('[EditProfileModal] Opening QuickProfile for uid:', user?.uid);
                       }
                       onOpenQuickProfile?.();
                     }}
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

function CommunityList({ setView, communities, challenge, configLoading, onStartChallengeUpload }) {
  const safeCommunities = Array.isArray(communities) && communities.length
    ? communities
    : DEFAULT_COMMUNITY_CONFIG.communities;
  const challengeData = challenge || DEFAULT_CHALLENGE_CONFIG;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <div><h2 className="text-2xl font-bold dark:text-white">Community</h2></div>
      </div>

      <div className="flex justify-end mb-3">
        <Button
          className="h-8 px-3 text-sm rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-none"
          onClick={() => setView('chat')}
        >
          Chat openen
        </Button>
      </div>

      <div className="mb-8 cursor-pointer" onClick={() => setView('challenge_timeline')}>
         <div className="bg-gradient-to-r from-amber-100 to-orange-100 dark:from-amber-900/30 dark:to-orange-900/20 p-6 rounded-2xl border border-amber-200 dark:border-amber-800/30 flex items-center justify-between gap-4 shadow-sm hover:shadow-md transition-shadow">
            <div>
               <h3 className="font-bold text-amber-900 dark:text-amber-400 text-lg mb-1 flex items-center gap-2"><Star className="w-5 h-5 fill-amber-500 text-amber-500" /> {challengeData.title}</h3>
               <p className="text-sm text-amber-800 dark:text-amber-200/80 mb-0">Thema: &quot;{challengeData.theme}&quot;</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                className="bg-white/80 hover:bg-white text-amber-900 border border-amber-200 shadow-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartChallengeUpload?.();
                }}
              >
                Upload challenge
              </Button>
              <Button className="bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20">
                Bekijk inzendingen
              </Button>
            </div>
         </div>
      </div>

      <div className="space-y-4">
        {configLoading && (
          <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Communitydata laden...
          </div>
        )}
        {safeCommunities.map(comm => {
          const Icon = resolveCommunityIcon(comm.iconKey);
          const encodedTopicTitle = comm?.title ? `__topic__${encodeURIComponent(comm.title)}` : '';
          return (
            <div
              key={comm.id}
              className="bg-white dark:bg-slate-800 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex gap-6 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setView(`community_${comm.id}${encodedTopicTitle}`)}
            >
              <div className="w-12 h-12 bg-blue-50 dark:bg-slate-700 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0"><Icon className="w-6 h-6" /></div>
              <div><h3 className="font-bold text-lg dark:text-white mb-1">{comm.title}</h3><p className="text-slate-600 dark:text-slate-400 text-sm">{comm.description}</p></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CommunityDetail({ id, setView, authUser, functionsBase, userProfile, communities, initialTopicTitle }) {
  const db = getFirebaseDbInstance();
  const communityList = Array.isArray(communities) && communities.length
    ? communities
    : DEFAULT_COMMUNITY_CONFIG.communities;
  const selectedCommunity = communityList.find((community) => community.id === id);
  const communityTitle = selectedCommunity?.title || `Community: ${id}`;
  const communityDescription = selectedCommunity?.description || 'Praat mee of neem contact op met Artes Moderatie.';
  const communityTopics = selectedCommunity?.topics || [];
  const CommunityIcon = resolveCommunityIcon(selectedCommunity?.iconKey);
  const [topics, setTopics] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicError, setTopicError] = useState(null);
  const [activeTopicId, setActiveTopicId] = useState(null);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicBody, setNewTopicBody] = useState('');
  const [topicSaving, setTopicSaving] = useState(false);
  const fallbackTopics = communityTopics.length
    ? communityTopics.map((topic, index) => ({
      id: `suggested_${index}`,
      title: topic,
      body: 'Deel hier je vraag, tips of ervaringen met de community.',
      isSuggested: true,
    }))
    : [];
  const displayName = sanitizeHandle(userProfile?.displayName || userProfile?.username || authUser?.displayName || '');

  useEffect(() => {
    if (!db || !id) return undefined;
    setTopicsLoading(true);
    const topicsRef = collection(db, 'communities', id, 'topics');
    const topicsQuery = query(topicsRef, orderBy('createdAt', 'desc'));
    return onSnapshot(
      topicsQuery,
      (snapshot) => {
        const entries = snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          ...docSnapshot.data(),
        }));
        setTopics(entries);
        setTopicsLoading(false);
      },
      (error) => {
        console.error('Failed to load topics', error);
        setTopicError('Topics konden niet worden geladen.');
        setTopicsLoading(false);
      },
    );
  }, [db, id]);

  const topicsToRender = topics.length ? topics : fallbackTopics;

  useEffect(() => {
    if (!initialTopicTitle || activeTopicId || !topics.length) return;
    const matchingTopic = topics.find(
      (topic) => topic?.title?.toLowerCase() === initialTopicTitle.toLowerCase(),
    );
    if (matchingTopic) {
      setActiveTopicId(matchingTopic.id);
    }
  }, [activeTopicId, initialTopicTitle, topics]);

  const handleCreateTopic = async () => {
    if (!authUser) {
      setTopicError('Log in om een topic te starten.');
      return;
    }
    if (!newTopicTitle.trim() || !newTopicBody.trim()) {
      setTopicError('Vul een titel en uitleg in.');
      return;
    }
    if (!db) {
      setTopicError('Database niet beschikbaar.');
      return;
    }
    setTopicSaving(true);
    setTopicError(null);
    try {
      const topicsRef = collection(db, 'communities', id, 'topics');
      await addDoc(topicsRef, {
        title: newTopicTitle.trim(),
        body: newTopicBody.trim(),
        authorId: authUser.uid,
        authorName: displayName || sanitizeHandle(authUser?.email?.split('@')[0]) || 'Communitylid',
        createdAt: serverTimestamp(),
      });
      setNewTopicTitle('');
      setNewTopicBody('');
    } catch (error) {
      console.error('Failed to create topic', error);
      setTopicError('Topic kon niet worden opgeslagen.');
    } finally {
      setTopicSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <button onClick={() => setView('community')} className="flex items-center text-slate-500 hover:text-slate-800 font-medium">
        <ChevronLeft className="w-4 h-4 mr-1" /> Terug
      </button>
      <div>
        <h2 className="text-2xl font-bold dark:text-white">{communityTitle}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{communityDescription}</p>
      </div>
      {selectedCommunity && (
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-slate-800 flex items-center justify-center">
              <CommunityIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Topics</p>
              <div className="flex flex-wrap gap-2">
                {communityTopics.length > 0 ? (
                  communityTopics.map((topic) => (
                    <span
                      key={topic}
                      className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300"
                    >
                      {topic}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-400">Nog geen topics toegevoegd.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="min-h-[60vh] space-y-6">
        {activeTopicId ? (
          <CommunityTopicDetail
            communityId={id}
            topicId={activeTopicId}
            onBack={() => setActiveTopicId(null)}
            authUser={authUser}
            userProfile={userProfile}
          />
        ) : (
          <>
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Topics in {communityTitle}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Start een onderwerp of lees mee met anderen.</p>
                </div>
                {topicsLoading && (
                  <div className="flex items-center text-sm text-slate-500 dark:text-slate-400 gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Laden...
                  </div>
                )}
              </div>
              {topicsToRender.length > 0 ? (
                <div className="grid gap-3">
                  {topicsToRender.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      className="text-left p-4 rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-blue-400/60 hover:bg-blue-50/40 dark:hover:bg-slate-800 transition"
                      onClick={() => !topic.isSuggested && setActiveTopicId(topic.id)}
                      disabled={topic.isSuggested}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-base font-semibold text-slate-900 dark:text-white">{topic.title || 'Nieuw topic'}</p>
                          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {topic.body ? `${topic.body.slice(0, 140)}${topic.body.length > 140 ? '…' : ''}` : 'Nog geen uitleg toegevoegd.'}
                          </p>
                        </div>
                        {topic.isSuggested && (
                          <span className="text-xs uppercase tracking-wide text-slate-400">Suggestie</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nog geen topics. Start het eerste onderwerp.</p>
              )}
            </div>
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-4">
              <div>
                <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Start een nieuw topic</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400">Geef de community wat context en een duidelijke vraag.</p>
              </div>
              <div className="space-y-3">
                <input
                  value={newTopicTitle}
                  onChange={(event) => setNewTopicTitle(event.target.value)}
                  placeholder="Titel van het topic"
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2 text-sm text-slate-800 dark:text-slate-100"
                />
                <textarea
                  value={newTopicBody}
                  onChange={(event) => setNewTopicBody(event.target.value)}
                  placeholder="Geef een uitgebreide uitleg van je topic."
                  rows={4}
                  className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2 text-sm text-slate-800 dark:text-slate-100"
                />
              </div>
              {topicError && <p className="text-sm text-red-500">{topicError}</p>}
              {!authUser && <p className="text-sm text-slate-500 dark:text-slate-400">Log in om een topic te starten.</p>}
              <div className="flex justify-end">
                <button
                  type="button"
                  className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold disabled:opacity-60"
                  onClick={handleCreateTopic}
                  disabled={topicSaving}
                >
                  {topicSaving ? 'Opslaan...' : 'Topic plaatsen'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CommunityTopicDetail({ communityId, topicId, onBack, authUser, userProfile }) {
  const db = getFirebaseDbInstance();
  const [topic, setTopic] = useState(null);
  const [topicLoading, setTopicLoading] = useState(true);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const commentAuthorName = sanitizeHandle(
    userProfile?.displayName || userProfile?.username || authUser?.displayName || authUser?.email?.split('@')[0],
  );

  useEffect(() => {
    if (!db || !communityId || !topicId) return undefined;
    setTopicLoading(true);
    const topicRef = doc(db, 'communities', communityId, 'topics', topicId);
    return onSnapshot(
      topicRef,
      (snapshot) => {
        setTopic(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        setTopicLoading(false);
      },
      (error) => {
        console.error('Failed to load topic', error);
        setTopicLoading(false);
      },
    );
  }, [db, communityId, topicId]);

  useEffect(() => {
    if (!db || !communityId || !topicId) return undefined;
    const commentsRef = collection(db, 'communities', communityId, 'topics', topicId, 'comments');
    const commentsQuery = query(commentsRef, orderBy('createdAt', 'desc'));
    return onSnapshot(
      commentsQuery,
      (snapshot) => {
        setComments(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })));
      },
      (error) => {
        console.error('Failed to load comments', error);
      },
    );
  }, [db, communityId, topicId]);

  const handleAddComment = async () => {
    if (!authUser) {
      setCommentError('Log in om te reageren.');
      return;
    }
    if (!commentText.trim()) {
      setCommentError('Schrijf eerst een reactie.');
      return;
    }
    if (!db) {
      setCommentError('Database niet beschikbaar.');
      return;
    }
    setCommentSaving(true);
    setCommentError(null);
    try {
      const commentsRef = collection(db, 'communities', communityId, 'topics', topicId, 'comments');
      await addDoc(commentsRef, {
        text: commentText.trim(),
        authorId: authUser.uid,
        authorName: commentAuthorName || 'Communitylid',
        createdAt: serverTimestamp(),
      });
      setCommentText('');
    } catch (error) {
      console.error('Failed to add comment', error);
      setCommentError('Reactie kon niet worden opgeslagen.');
    } finally {
      setCommentSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="flex items-center text-slate-500 hover:text-slate-800 font-medium">
        <ChevronLeft className="w-4 h-4 mr-1" /> Terug naar topics
      </button>
      <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-2">
        {topicLoading ? (
          <div className="flex items-center text-sm text-slate-500 dark:text-slate-400 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Topic laden...
          </div>
        ) : (
          <>
            <h3 className="text-2xl font-semibold text-slate-900 dark:text-white">{topic?.title || 'Topic'}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{topic?.authorName || 'Communitylid'}</p>
            <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{topic?.body || 'Geen extra uitleg toegevoegd.'}</p>
          </>
        )}
      </div>
      <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 space-y-4">
        <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Reacties</h4>
        <div className="space-y-3">
          {comments.length > 0 ? (
            comments.map((comment) => (
              <div key={comment.id} className="rounded-2xl border border-slate-100 dark:border-slate-800 p-4">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {sanitizeHandle(comment.authorName || 'Communitylid')}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{comment.text}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Wees de eerste die reageert.</p>
          )}
        </div>
        <div className="space-y-2">
          <textarea
            value={commentText}
            onChange={(event) => setCommentText(event.target.value)}
            rows={3}
            placeholder="Deel je reactie..."
            className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2 text-sm text-slate-800 dark:text-slate-100"
          />
          {commentError && <p className="text-sm text-red-500">{commentError}</p>}
          {!authUser && <p className="text-sm text-slate-500 dark:text-slate-400">Log in om te reageren.</p>}
          <div className="flex justify-end">
            <button
              type="button"
              className="px-4 py-2 rounded-full bg-blue-600 text-white text-sm font-semibold disabled:opacity-60"
              onClick={handleAddComment}
              disabled={commentSaving}
            >
              {commentSaving ? 'Plaatsen...' : 'Plaats reactie'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
function ChallengeDetail({ setView, posts, onPostClick, challenge }) {
   const challengeData = challenge || DEFAULT_CHALLENGE_CONFIG;
   return (
      <div className="max-w-4xl mx-auto px-4 py-6">
         <button onClick={() => setView('community')} className="flex items-center text-slate-500 hover:text-slate-800 mb-6 font-medium"><ChevronLeft className="w-4 h-4 mr-1"/> Terug</button>
         <div className="bg-amber-100 dark:bg-amber-900/20 p-8 rounded-3xl border border-amber-200 dark:border-amber-800 mb-8 text-center relative overflow-hidden">
            <p className="text-sm uppercase tracking-widest text-amber-700 dark:text-amber-200 mb-2">{challengeData.title}</p>
            <h1 className="text-4xl font-bold text-amber-900 dark:text-amber-100 mb-2">{challengeData.theme}</h1>
            <p className="text-sm text-amber-800 dark:text-amber-200/80">{challengeData.description}</p>
         </div>
         <div className="grid grid-cols-2 md:grid-cols-3 gap-1 md:gap-4">
            {posts.map(post => (
              <div
                key={post.id}
                onClick={() => onPostClick(post)}
                className={`aspect-square bg-slate-200 rounded-lg overflow-hidden cursor-pointer ${post.isChallenge ? 'ring-4 ring-amber-400' : ''}`}
              >
                <img src={post.imageUrl} className="w-full h-full object-cover" />
              </div>
            ))}
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

  // All hooks must be called in the same order on every render
  // Moved BEFORE the early return to prevent "Rendered more hooks" error
  const roles = userProfile?.roles || [];
  const themes = userProfile?.themes || [];
  const roleLabel = (roleId) => ROLES.find((x) => x.id === roleId)?.label || 'Onbekende rol';
  const userPosts = posts.filter((post) => post.authorId === userId);
  const resolvePostTimestamp = (post) => {
    if (post?.createdAt?.seconds) return post.createdAt.seconds * 1000;
    if (post?.createdAt?.toMillis) return post.createdAt.toMillis();
    if (typeof post?.createdAt === 'number') return post.createdAt;
    return 0;
  };
  const previewMode = userProfile?.quickProfilePreviewMode || 'latest';
  const manualIds = Array.isArray(userProfile?.quickProfilePostIds) ? userProfile.quickProfilePostIds : [];
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
  const headerImage = userProfile?.headerImage || userProfile?.avatar;
  const headerPosition = userProfile?.headerPosition || 'center';

  // Early return after all hooks
  if (!userProfile) {
    return (
      <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 w-full max-w-md text-center shadow-2xl">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-300">Profiel laden...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-6">
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
            {themes && themes.length > 0 ? (
              themes.map((theme) => (
                <span key={theme} className={`px-3 py-1 rounded-full text-xs font-semibold border ${getThemeStyle(theme)}`}>
                  {theme}
                </span>
              ))
            ) : null}
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
function ShadowProfileModal({
  name,
  contributorId,
  posts,
  onClose,
  onPostClick,
  authUser,
  userProfile,
  functionsBase,
  setView,
}) {
    const shadowPosts = posts.filter(p => p.credits && p.credits.some((c) => (
      (contributorId && c.contributorId === contributorId) || c.name === name
    )));
    const [claimPanelOpen, setClaimPanelOpen] = useState(false);
    const [claimBusy, setClaimBusy] = useState(false);
    const [claimError, setClaimError] = useState('');
    const [claimSuccess, setClaimSuccess] = useState('');
    const [claimRequestId, setClaimRequestId] = useState(null);
    const [claimCode, setClaimCode] = useState('');
    const [claimCodeExpiresAt, setClaimCodeExpiresAt] = useState(null);
    const [claimMethod, setClaimMethod] = useState('');
    const [claimProofFile, setClaimProofFile] = useState(null);
    const [claimProofUploading, setClaimProofUploading] = useState(false);
    const [claimProofError, setClaimProofError] = useState('');
    const [claimProofSuccess, setClaimProofSuccess] = useState('');
    const [contributorInfo, setContributorInfo] = useState(null);
    const [loadingContributor, setLoadingContributor] = useState(false);
    const [inviteLink, setInviteLink] = useState('');
    const [inviteLoading, setInviteLoading] = useState(false);
    const [inviteError, setInviteError] = useState('');
    const [inviteCopied, setInviteCopied] = useState(false);

    const normalizeExternalLink = (link) => {
      if (!link) return null;
      const trimmed = link.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('@')) {
        const handle = trimmed.replace(/^@+/, '');
        return { type: 'instagram', label: `@${handle}`, url: `https://instagram.com/${handle}` };
      }
      if (/instagram\.com/i.test(trimmed)) {
        const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const handle = url.split('instagram.com/')[1]?.split(/[/?#]/)[0];
        return { type: 'instagram', label: handle ? `@${handle}` : url, url };
      }
      if (/^https?:\/\//i.test(trimmed)) {
        return { type: 'website', label: trimmed.replace(/^https?:\/\//i, ''), url: trimmed };
      }
      if (trimmed.includes('.')) {
        return { type: 'website', label: trimmed, url: `https://${trimmed}` };
      }
      return { type: 'instagram', label: `@${trimmed}`, url: `https://instagram.com/${trimmed}` };
    };

    const externalLinks = useMemo(() => {
      const collected = new Map();
      shadowPosts.forEach((post) => {
        post.credits?.forEach((credit) => {
          const matches = (contributorId && credit.contributorId === contributorId) || credit.name === name;
          if (!matches) return;
          if (credit.instagramHandle) {
            const handle = credit.instagramHandle.replace(/^@+/, '');
            const url = `https://instagram.com/${handle}`;
            collected.set(url, { type: 'instagram', label: `@${handle}`, url });
          }
          if (credit.website) {
            const url = /^https?:\/\//i.test(credit.website) ? credit.website : `https://${credit.website}`;
            const label = credit.website.replace(/^https?:\/\//i, '');
            collected.set(url, { type: 'website', label, url });
          }
          if (credit.email) {
            const url = `mailto:${credit.email}`;
            collected.set(url, { type: 'email', label: credit.email, url });
          }
          if (credit.link) {
            const normalized = normalizeExternalLink(credit.link);
            if (normalized) collected.set(normalized.url, normalized);
          }
        });
      });
      return Array.from(collected.values());
    }, [contributorId, name, shadowPosts]);

    useEffect(() => {
      let isMounted = true;
      if (!contributorId) {
        setContributorInfo(null);
        return () => {};
      }
      const loadContributor = async () => {
        setLoadingContributor(true);
        try {
          const db = getFirebaseDbInstance();
          const snapshot = await getDoc(doc(db, CLAIMS_COLLECTIONS.contributors, contributorId));
          if (!isMounted) return;
          setContributorInfo(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        } catch (error) {
          if (isMounted) {
            console.error('[ShadowProfileModal] Failed to load contributor', error);
            setContributorInfo(null);
          }
        } finally {
          if (isMounted) setLoadingContributor(false);
        }
      };
      loadContributor();
      return () => {
        isMounted = false;
      };
    }, [contributorId]);

    const isLoggedIn = Boolean(authUser?.uid);
    const requiresIdCheck = isLoggedIn && (!userProfile?.ageVerified || (userProfile?.onboardingStep ?? 0) < 2);
    const claimedByUid = contributorInfo?.claimedByUid || contributorInfo?.claimedBy || null;
    const claimedByOther = Boolean(claimedByUid && claimedByUid !== authUser?.uid);

    const hasInstagramAlias = Boolean(contributorInfo?.instagramHandle)
      || externalLinks.some((link) => link.type === 'instagram');
    const hasWebsiteAlias = Boolean(contributorInfo?.website)
      || externalLinks.some((link) => link.type === 'website');
    const hasEmailAlias = Boolean(contributorInfo?.email)
      || externalLinks.some((link) => link.type === 'email');

    const claimMethods = useMemo(() => {
      const methods = [];
      if (hasInstagramAlias) {
        methods.push({
          key: 'instagramScreenshot',
          title: 'Instagram screenshot',
          description: 'Plaats de code in je Instagram bio en upload een screenshot.',
          placeholder: false,
        });
      }
      if (hasWebsiteAlias) {
        methods.push({
          key: 'websiteToken',
          title: 'Website token',
          description: 'Voeg een token toe aan je website of domein.',
          placeholder: true,
        });
      }
      if (hasEmailAlias) {
        methods.push({
          key: 'emailLink',
          title: 'Email link',
          description: 'Ontvang een bevestigingslink per mail.',
          placeholder: true,
        });
      }
      methods.push({
        key: 'vouch',
        title: 'Vouch via community',
        description: 'Vraag bestaande members om jouw claim te bevestigen.',
        placeholder: false,
      });
      if (!hasInstagramAlias && !hasWebsiteAlias && !hasEmailAlias) {
        methods.push({
          key: 'moderator',
          title: 'Naar moderator',
          description: 'Laat een moderator je claim handmatig beoordelen.',
          placeholder: true,
        });
      }
      return methods;
    }, [hasInstagramAlias, hasWebsiteAlias, hasEmailAlias]);

    const startClaimRequest = useCallback(async ({ mode, method, status, statusReason }) => {
      if (!authUser?.uid) {
        setClaimError('Log in om te claimen.');
        return;
      }
      if (!functionsBase) {
        setClaimError('Claim service is niet beschikbaar.');
        return;
      }
      setClaimBusy(true);
      setClaimError('');
      setClaimSuccess('');
      setClaimProofError('');
      setClaimProofSuccess('');
      try {
        const authToken = await authUser.getIdToken();
        const response = await fetch(`${functionsBase}/createClaimRequest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            contributorId: contributorId || null,
            mode,
            method,
            status,
            statusReason,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Claim verzoek mislukt.');
        }
        setClaimRequestId(data?.requestId || null);
        setClaimCode(data?.claimCode || '');
        setClaimCodeExpiresAt(data?.claimCodeExpiresAt || null);
        setClaimMethod(method || '');
        setClaimSuccess('Claim verzoek verzonden.');
      } catch (error) {
        console.error('[ShadowProfileModal] Claim request failed', error);
        setClaimError(error?.message || 'Claim verzoek mislukt.');
      } finally {
        setClaimBusy(false);
      }
    }, [authUser?.uid, contributorId, name]);

    const handleStartVouchClaim = () => {
      startClaimRequest({ mode: 'link', method: 'vouch' });
    };

    const handleStartInstagramScreenshotClaim = () => {
      startClaimRequest({ mode: 'link', method: 'instagramScreenshot' });
    };

    const handleDisputeClaim = () => {
      startClaimRequest({ mode: 'link', method: 'dispute', status: 'needsModeration', statusReason: 'dispute' });
    };

    const handleOpenIdCheck = async () => {
      if (!authUser?.uid) return;
      try {
        await updateUserProfile(authUser.uid, {
          onboardingStep: 2,
          onboardingComplete: false,
        });
      } catch (error) {
        console.error('[ShadowProfileModal] Failed to route to ID check', error);
      }
      if (setView) setView('onboarding');
    };

    const handleShareInvite = async () => {
      if (!contributorId) return;
      if (!authUser?.uid) {
        setInviteError('Log in om een invite link te delen.');
        return;
      }
      setInviteLoading(true);
      setInviteError('');
      try {
        const result = await createClaimInvite({ contributorId });
        const path = result?.path || '';
        if (!path) throw new Error('Invite link maken mislukt.');
        const url = new URL(path, window.location.origin).toString();
        setInviteLink(url);
        setInviteCopied(false);
      } catch (error) {
        console.error('[ShadowProfileModal] Failed to create invite', error);
        setInviteError(error?.message || 'Invite link maken mislukt.');
      } finally {
        setInviteLoading(false);
      }
    };

    const handleUploadClaimProof = async () => {
      if (!authUser?.uid || !claimRequestId || !claimProofFile) {
        setClaimProofError('Selecteer eerst een screenshot.');
        return;
      }
      setClaimProofUploading(true);
      setClaimProofError('');
      setClaimProofSuccess('');
      try {
        const storage = getFirebaseStorageInstance();
        const path = `claimProofs/${claimRequestId}/${authUser.uid}.png`;
        const fileRef = storageRef(storage, path);
        await uploadBytes(fileRef, claimProofFile, { contentType: claimProofFile.type || 'image/png' });
        setClaimProofSuccess('Screenshot geüpload. We controleren deze automatisch.');
      } catch (error) {
        console.error('[ShadowProfileModal] Claim proof upload failed', error);
        setClaimProofError(error?.message || 'Upload mislukt.');
      } finally {
        setClaimProofUploading(false);
      }
    };

    const claimCodeExpiryLabel = useMemo(() => {
      if (!claimCodeExpiresAt) return null;
      const date = claimCodeExpiresAt?.toDate ? claimCodeExpiresAt.toDate() : new Date(claimCodeExpiresAt);
      if (!date || Number.isNaN(date.getTime())) return null;
      return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    }, [claimCodeExpiresAt]);

    return (
      <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4">
        <div className="bg-slate-900 w-full max-w-4xl h-full rounded-3xl overflow-hidden flex flex-col">
          <div className="relative h-64 bg-indigo-900 flex items-center justify-center flex-col text-white px-6 text-center">
            <div className="text-4xl font-bold mb-2">{name}</div>
            <p className="text-sm text-white/80">
              Ongeclaimd profiel. Laat deze persoon weten dat er een profiel is aangemaakt zodat ze het kunnen claimen.
            </p>
            {externalLinks.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm">
                {externalLinks.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-white hover:bg-white/20 transition"
                  >
                    {link.type === 'instagram' ? 'Instagram' : link.type === 'email' ? 'Email' : 'Website'}: {link.label}
                  </a>
                ))}
              </div>
            )}
            {contributorId && (
              <div className="mt-4 w-full max-w-2xl space-y-2">
                <button
                  type="button"
                  onClick={handleShareInvite}
                  disabled={inviteLoading}
                  className="inline-flex items-center justify-center rounded-full bg-white text-indigo-900 px-5 py-2 text-sm font-semibold shadow-sm hover:bg-indigo-50 transition disabled:opacity-60"
                >
                  {inviteLoading ? 'Invite link maken...' : 'Deel invite link'}
                </button>
                {inviteLink && (
                  <div className="flex flex-col sm:flex-row items-center gap-2">
                    <input
                      readOnly
                      value={inviteLink}
                      className="w-full rounded-full border border-white/30 bg-white/10 px-3 py-2 text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(inviteLink);
                        setInviteCopied(true);
                      }}
                      className="rounded-full bg-white/90 text-indigo-900 px-4 py-2 text-xs font-semibold"
                    >
                      Kopieer
                    </button>
                  </div>
                )}
                {inviteCopied && (
                  <p className="text-xs text-emerald-200">Invite link gekopieerd.</p>
                )}
                {inviteError && (
                  <p className="text-xs text-rose-200">{inviteError}</p>
                )}
              </div>
            )}
            <div className="mt-5 w-full max-w-2xl">
              {loadingContributor && (
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/70">
                  Claim status laden...
                </div>
              )}
              {!loadingContributor && claimedByOther && (
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-left space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Dit profiel is al geclaimd</p>
                    <p className="text-xs text-white/70">Denk je dat dit toch jouw profiel is?</p>
                  </div>
                  {!isLoggedIn && (
                    <p className="text-xs text-white/70">Log in om te claimen.</p>
                  )}
                  <button
                    type="button"
                    onClick={handleDisputeClaim}
                    disabled={!isLoggedIn || claimBusy}
                    className="inline-flex items-center justify-center rounded-full bg-white text-indigo-900 px-5 py-2 text-sm font-semibold shadow-sm hover:bg-indigo-50 transition disabled:opacity-60"
                  >
                    Dit ben ik toch
                  </button>
                  {claimError && (
                    <p className="text-xs text-rose-200">{claimError}</p>
                  )}
                  {claimSuccess && (
                    <p className="text-xs text-emerald-200">{claimSuccess} {claimRequestId && `#${claimRequestId}`}</p>
                  )}
                </div>
              )}
              {!loadingContributor && !claimedByOther && (
                <div className="rounded-2xl bg-white/10 px-4 py-3 text-left space-y-3">
                  {!isLoggedIn && (
                    <p className="text-sm text-white/80">Log in om te claimen.</p>
                  )}
                  {isLoggedIn && requiresIdCheck && (
                    <div className="space-y-2">
                      <p className="text-sm text-white/90">Voltooi eerst de ID check.</p>
                      <button
                        type="button"
                        onClick={handleOpenIdCheck}
                        className="inline-flex items-center justify-center rounded-full bg-white text-indigo-900 px-5 py-2 text-sm font-semibold shadow-sm hover:bg-indigo-50 transition"
                      >
                        Ga naar stap 2
                      </button>
                    </div>
                  )}
                  {isLoggedIn && !requiresIdCheck && (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setClaimPanelOpen((prev) => !prev)}
                        className="inline-flex items-center justify-center rounded-full bg-white text-indigo-900 px-5 py-2 text-sm font-semibold shadow-sm hover:bg-indigo-50 transition"
                      >
                        Claim dit profiel
                      </button>
                      {claimPanelOpen && (
                        <div className="grid gap-3 text-left">
                          {claimMethods.map((method) => (
                            <div
                              key={method.key}
                              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-white">{method.title}</p>
                                  <p className="text-xs text-white/70">{method.description}</p>
                                </div>
                                {method.placeholder ? (
                                  <span className="text-[10px] uppercase tracking-wide text-white/60">Binnenkort</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={method.key === 'instagramScreenshot' ? handleStartInstagramScreenshotClaim : handleStartVouchClaim}
                                    disabled={claimBusy}
                                    className="rounded-full bg-white text-indigo-900 px-4 py-2 text-xs font-semibold shadow-sm hover:bg-indigo-50 transition disabled:opacity-60"
                                  >
                                    Start claim
                                  </button>
                                )}
                              </div>
                              {method.key === 'instagramScreenshot' && claimCode && claimMethod === 'instagramScreenshot' && (
                                <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/80 space-y-2">
                                  <p className="font-semibold text-white">Plaats deze code in je Instagram bio:</p>
                                  <div className="flex items-center gap-2">
                                    <span className="rounded-full bg-white text-indigo-900 px-3 py-1 text-xs font-semibold">
                                      {claimCode}
                                    </span>
                                    {claimCodeExpiryLabel && (
                                      <span className="text-[11px] text-white/70">Geldig tot {claimCodeExpiryLabel}</span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-white/70">
                                    Maak daarna een screenshot van je bio en upload deze hieronder.
                                  </p>
                                  <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      onChange={(event) => {
                                        const file = event.target.files?.[0] || null;
                                        setClaimProofFile(file);
                                      }}
                                      className="w-full text-xs text-white"
                                    />
                                    <button
                                      type="button"
                                      onClick={handleUploadClaimProof}
                                      disabled={claimProofUploading || !claimProofFile}
                                      className="rounded-full bg-white text-indigo-900 px-4 py-2 text-xs font-semibold shadow-sm hover:bg-indigo-50 transition disabled:opacity-60"
                                    >
                                      {claimProofUploading ? 'Uploaden...' : 'Upload screenshot'}
                                    </button>
                                  </div>
                                  {claimProofError && (
                                    <p className="text-[11px] text-rose-200">{claimProofError}</p>
                                  )}
                                  {claimProofSuccess && (
                                    <p className="text-[11px] text-emerald-200">{claimProofSuccess}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {claimError && (
                    <p className="text-xs text-rose-200">{claimError}</p>
                  )}
                  {claimSuccess && (
                    <p className="text-xs text-emerald-200">{claimSuccess} {claimRequestId && `#${claimRequestId}`}</p>
                  )}
                </div>
              )}
            </div>
            <button onClick={onClose} className="absolute top-4 right-4">
              <X />
            </button>
          </div>
          <div className="flex-1 p-6 overflow-y-auto no-scrollbar">
            <div className="grid grid-cols-3 gap-2">
              {shadowPosts.map(p => (
                <div key={p.id} onClick={() => onPostClick(p)} className="aspect-square bg-slate-800">
                  <img src={p.imageUrl} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
}

function ClaimInvitePage({
  token,
  authUser,
  userProfile,
  functionsBase,
  setView,
}) {
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimSuccess, setClaimSuccess] = useState('');
  const [claimRequestId, setClaimRequestId] = useState(null);
  const [claimCode, setClaimCode] = useState('');
  const [claimCodeExpiresAt, setClaimCodeExpiresAt] = useState(null);
  const [claimProofFile, setClaimProofFile] = useState(null);
  const [claimProofUploading, setClaimProofUploading] = useState(false);
  const [claimProofError, setClaimProofError] = useState('');
  const [claimProofSuccess, setClaimProofSuccess] = useState('');
  const [useInstagramProof, setUseInstagramProof] = useState(false);

  const requiresIdCheck = Boolean(authUser?.uid && (!userProfile?.ageVerified || (userProfile?.onboardingStep ?? 0) < 2));

  useEffect(() => {
    let active = true;
    if (!token || !functionsBase) {
      setPreview(null);
      setPreviewError(token ? 'Invite preview is niet beschikbaar.' : 'Invite link is ongeldig.');
      return () => {};
    }

    const loadPreview = async () => {
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const response = await fetch(`${functionsBase}/getClaimInvitePreview?token=${encodeURIComponent(token)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Invite preview laden mislukt.');
        }
        if (!active) return;
        setPreview(data);
      } catch (error) {
        if (!active) return;
        setPreview(null);
        setPreviewError(error?.message || 'Invite preview laden mislukt.');
      } finally {
        if (active) setPreviewLoading(false);
      }
    };

    loadPreview();

    return () => {
      active = false;
    };
  }, [token, functionsBase]);

  const handleLogin = () => {
    if (setView) setView('login');
  };

  const handleOpenIdCheck = async () => {
    if (!authUser?.uid) return;
    try {
      await updateUserProfile(authUser.uid, {
        onboardingStep: 2,
        onboardingComplete: false,
      });
    } catch (error) {
      console.error('[ClaimInvitePage] Failed to route to ID check', error);
    }
    if (setView) setView('onboarding');
  };

  const handleStartClaim = async () => {
    if (!authUser?.uid || !preview?.contributorId || !functionsBase || !token) {
      setClaimError('Log in om te claimen.');
      return;
    }
    setClaimBusy(true);
    setClaimError('');
    setClaimSuccess('');
    try {
      const authToken = await authUser.getIdToken();
      const response = await fetch(`${functionsBase}/createClaimRequest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          contributorId: preview.contributorId,
          mode: 'link',
          inviteToken: token,
          method: useInstagramProof ? 'instagramScreenshot' : 'vouch',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Claim verzoek mislukt.');
      }
      setClaimRequestId(data?.requestId || null);
      setClaimCode(data?.claimCode || '');
      setClaimCodeExpiresAt(data?.claimCodeExpiresAt || null);
      setClaimSuccess('Claim verzoek verzonden.');
    } catch (error) {
      setClaimError(error?.message || 'Claim verzoek mislukt.');
    } finally {
      setClaimBusy(false);
    }
  };

  const handleUploadClaimProof = async () => {
    if (!authUser?.uid || !claimRequestId || !claimProofFile) {
      setClaimProofError('Selecteer eerst een screenshot.');
      return;
    }
    setClaimProofUploading(true);
    setClaimProofError('');
    setClaimProofSuccess('');
    try {
      const storage = getFirebaseStorageInstance();
      const path = `claimProofs/${claimRequestId}/${authUser.uid}.png`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, claimProofFile, { contentType: claimProofFile.type || 'image/png' });
      setClaimProofSuccess('Screenshot geüpload. We controleren deze automatisch.');
    } catch (error) {
      setClaimProofError(error?.message || 'Upload mislukt.');
    } finally {
      setClaimProofUploading(false);
    }
  };

  const claimCodeExpiryLabel = useMemo(() => {
    if (!claimCodeExpiresAt) return null;
    const date = claimCodeExpiresAt?.toDate ? claimCodeExpiresAt.toDate() : new Date(claimCodeExpiresAt);
    if (!date || Number.isNaN(date.getTime())) return null;
    return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }, [claimCodeExpiresAt]);

  const proofMethodLabels = {
    instagram: 'Instagram',
    website: 'Website',
    email: 'Email',
    vouch: 'Vouch',
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Claim invite</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {preview?.displayName || 'Ongeclaimd profiel'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-300 mt-2">
            Gebruik deze link om het profiel te claimen. We tonen alleen minimale informatie voordat je inlogt.
          </p>
        </div>

        {previewLoading && (
          <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Preview laden...
          </div>
        )}
        {previewError && (
          <div className="text-sm text-rose-500">{previewError}</div>
        )}

        {preview && (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Beschikbare methodes</p>
              <div className="flex flex-wrap gap-2">
                {preview.availableProofMethods?.map((method) => (
                  <span
                    key={method}
                    className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-3 py-1 rounded-full"
                  >
                    {proofMethodLabels[method] || method}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <p className="font-semibold text-slate-700 dark:text-slate-200">Hints</p>
              {preview?.hints?.instagramHandle && (
                <p>Instagram: {preview.hints.instagramHandle}</p>
              )}
              {preview?.hints?.websiteDomain && (
                <p>Website: {preview.hints.websiteDomain}</p>
              )}
              {preview?.hints?.emailMasked && (
                <p>Email: {preview.hints.emailMasked}</p>
              )}
              {!preview?.hints?.instagramHandle && !preview?.hints?.websiteDomain && !preview?.hints?.emailMasked && (
                <p>Geen publieke hints beschikbaar.</p>
              )}
            </div>
            {authUser && preview.availableProofMethods?.includes('instagram') && (
              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={useInstagramProof}
                  onChange={(event) => setUseInstagramProof(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  Voeg optioneel Instagram screenshot bewijs toe. We genereren een code die je in je bio zet en daarna upload je een screenshot.
                </span>
              </label>
            )}
          </div>
        )}

        {!authUser && (
          <button
            type="button"
            onClick={handleLogin}
            className="w-full rounded-full bg-blue-600 text-white px-6 py-3 text-sm font-semibold hover:bg-blue-700 transition"
          >
            Inloggen of account maken
          </button>
        )}

        {authUser && (
          <div className="space-y-3">
            {requiresIdCheck ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">Voltooi eerst de ID check (stap 2).</p>
                <button
                  type="button"
                  onClick={handleOpenIdCheck}
                  className="w-full rounded-full bg-slate-900 text-white px-6 py-3 text-sm font-semibold hover:bg-slate-800 transition"
                >
                  Ga naar stap 2
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStartClaim}
                disabled={claimBusy || !preview?.contributorId}
                className="w-full rounded-full bg-emerald-600 text-white px-6 py-3 text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-60"
              >
                {claimBusy ? 'Claim verzoek versturen...' : 'Start claim'}
              </button>
            )}
            {claimError && (
              <p className="text-sm text-rose-500">{claimError}</p>
            )}
            {claimSuccess && (
              <p className="text-sm text-emerald-500">
                {claimSuccess} {claimRequestId && `#${claimRequestId}`}
              </p>
            )}
            {claimSuccess && useInstagramProof && claimCode && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p className="font-semibold text-slate-700 dark:text-slate-200">Zet deze code in je Instagram bio</p>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-600 text-white px-3 py-1 text-xs font-semibold">
                    {claimCode}
                  </span>
                  {claimCodeExpiryLabel && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">Geldig tot {claimCodeExpiryLabel}</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Upload daarna een screenshot van je bio (we gebruiken dit om je claim te verifiëren).
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setClaimProofFile(file);
                    }}
                    className="w-full text-xs text-slate-600 dark:text-slate-300"
                  />
                  <button
                    type="button"
                    onClick={handleUploadClaimProof}
                    disabled={claimProofUploading || !claimProofFile}
                    className="rounded-full bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-60"
                  >
                    {claimProofUploading ? 'Uploaden...' : 'Upload screenshot'}
                  </button>
                </div>
                {claimProofError && (
                  <p className="text-xs text-rose-500">{claimProofError}</p>
                )}
                {claimProofSuccess && (
                  <p className="text-xs text-emerald-500">{claimProofSuccess}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function SettingsModal({ onClose, moderatorAccess, onOpenModeration, onOpenSupport, onOpenVouchRequests, darkMode, onToggleDark, onLogout }) { 
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
                      onClick={onOpenVouchRequests}
                      className="w-full p-3 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left"
                    >
                      <span>Vouch verzoeken</span>
                      <MessageCircle className="w-4 h-4" />
                    </button>
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
function VouchRequestsPanel({ authUser, functionsBase }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [error, setError] = useState('');

  const loadRequests = useCallback(async () => {
    if (!authUser?.uid || !functionsBase) return;
    setLoading(true);
    setError('');
    try {
      const token = await authUser.getIdToken();
      const response = await fetch(`${functionsBase}/getVouchRequests`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Vouch verzoeken ophalen mislukt.');
      }
      const data = await response.json();
      setRequests(Array.isArray(data?.requests) ? data.requests : []);
    } catch (err) {
      setError(err.message || 'Vouch verzoeken ophalen mislukt.');
    } finally {
      setLoading(false);
    }
  }, [authUser, functionsBase]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const submitVote = async (requestId, vote) => {
    if (!authUser?.uid || !functionsBase) return;
    setActionLoadingId(requestId);
    setError('');
    try {
      const token = await authUser.getIdToken();
      const response = await fetch(`${functionsBase}/submitClaimVouch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, vote }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Stemmen mislukt.');
      }
      setRequests((prev) => prev.filter((item) => item.id !== requestId));
    } catch (err) {
      setError(err.message || 'Stemmen mislukt.');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Vouch verzoeken</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Help mee door claims te bevestigen of af te wijzen.
        </p>
      </div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={loadRequests}
          className="px-4 py-2 text-sm font-semibold rounded-full bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? 'Laden...' : 'Ververs'}
        </button>
        {error && (
          <span className="text-sm text-rose-500">{error}</span>
        )}
      </div>
      {loading && requests.length === 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
          Vouch verzoeken laden...
        </div>
      )}
      {!loading && requests.length === 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 text-sm text-slate-500 dark:text-slate-400">
          Geen openstaande vouch verzoeken.
        </div>
      )}
      <div className="grid gap-4">
        {requests.map((request) => (
          <div
            key={request.id}
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Contributor claim</p>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {request.contributorName || request.contributorId}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Mode: {request.mode === 'merge' ? 'Merge' : 'Link'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>👍 {request.yesCount || 0}</span>
                <span>👎 {request.noCount || 0}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => submitVote(request.id, 'yes')}
                disabled={actionLoadingId === request.id}
                className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 py-2 text-sm font-semibold hover:bg-emerald-100 disabled:opacity-60"
              >
                Vouch ✅
              </button>
              <button
                type="button"
                onClick={() => submitVote(request.id, 'no')}
                disabled={actionLoadingId === request.id}
                className="flex-1 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 py-2 text-sm font-semibold hover:bg-rose-100 disabled:opacity-60"
              >
                Afwijzen ❌
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function WelcomeTour({ onClose, setView }) {
  const [step, setStep] = useState(0);
  const steps = [
    {
      title: 'Welkom bij Artes!',
      desc: (
        <>
          Dit is een demoversie. Feedback is welkom via Instagram{' '}
          <a
            href="https://instagram.com/maraeliza.portfolio"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:text-blue-700"
          >
            @maraeliza.portfolio
          </a>
          .
        </>
      ),
      icon: Info,
      action: null,
    },
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
