import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Image as ImageIcon, Search, Users, Plus, Bookmark,
  Settings, LogOut, Shield, Camera, Handshake, ChevronLeft,
  X, AlertTriangle, AlertOctagon, UserPlus, Link as LinkIcon,
  Maximize2, Share2, MoreHorizontal, LayoutGrid, User, CheckCircle,
  Briefcase, Building2, Star, Edit3, Moon, Sun, ArrowRight, Info, ExternalLink, Trash2, MapPin, Bell, Lock, HelpCircle, Mail, Globe, Loader2, MessageCircle, GitMerge, Smartphone
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
  getFirebaseAuthInstance,
  createClaimInvite,
  startEmailClaimProof,
  startWebsiteClaimProof,
  verifyEmailClaimProof,
  verifyWebsiteClaimProof,
  createDiditSession,
  refreshDiditSession,
  isModerator,
  ensureSupportThreadExists,
  migrateRemoveGeneralTheme,
  getContributorByAlias,
  createContributorWithAliases,
  createContributorContentRequest,
  CLAIMS_COLLECTIONS,
  getClaimRequestRef,
  getFirebaseStorageInstance,
  getFirebaseFunctionsInstance,
  getAppConfig,
  setFanStatus,
  subscribeToFanCounts,
  subscribeToFanStatus,
  subscribeToFollowingIds,
  getFanDebugContext,
  subscribeToComments,
  subscribeToLikes,
  toggleLike,
} from './firebase';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  endAt,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  serverTimestamp,
  startAt,
  writeBatch,
  setDoc,
  where,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import ChatPanel from './components/ChatPanel';
import ModerationSupportChat from './components/ModerationSupportChat';
import LikeIcon from './components/icons/LikeIcon';
import CommentIcon from './components/icons/CommentIcon';
import SupportLanding from './components/SupportLanding';
import SearchWithAutocomplete from './components/SearchWithAutocomplete';
import PhotoDetailModal from './components/PhotoDetailModal';
import PostImageDisplay from './components/PostImageDisplay';
import AdaptivePhotoGrid from './components/AdaptivePhotoGrid';
import { getAdaptivePhotoTileSpan } from './utils/adaptivePhotoGrid';
import { shouldIgnoreTileActivation } from './utils/domInteraction';
import { isPanoramaImage } from './utils/imageMeta';
import PostCreditDisplay from './components/PostCreditDisplay';
import SensitiveOverlay from './components/SensitiveOverlay';
import AppLogo from './components/branding/AppLogo';
import ProfileImageCropper from './components/ProfileImageCropper';
import { normalizeDomain, normalizeEmail, normalizeInstagram } from './utils/contributorClaims';
import { ROLE_OPTIONS } from './utils/roles';
import { debugAllowed } from './utils/debugAccess';
import { canAccessFirestore, canStartModeration, devLog, isOnboardingComplete } from './utils/firestoreGate';
import { pickPreferredDisplayName, resolvePostAuthorDisplayName } from './utils/profileDisplayName';
import { resolvePublicDisplayName } from './utils/publicIdentity';
import { isCodexDevIdentity, readTokenClaims } from './utils/codexDevIdentity';
import {
  CONSENT_EXCEPTION_REASONS,
  CONTRIBUTOR_CONSENT_STATUSES,
  MAKER_FUNCTION_IDS,
  MAKER_ROLE_IDS,
  buildUploadConsent,
  getMissingMakerPromptState,
  getSelfMakerRoles,
  getVisiblePersonPromptState,
  hasMakerCredit,
  hasVisibleSubjectCredit,
  isMakerRole,
  normalizeCreditAfterRoleChange,
  normalizeConsentException,
  normalizeConsentCredit,
  validateUploadConsent,
} from './utils/uploadConsent';

// --- Constants & Styling ---

const ROLES = ROLE_OPTIONS;

const MAKER_FUNCTION_LABELS = {
  maker: 'Maker / content maker',
  rightsHolder: 'Rechthebbende',
  productionOwner: 'Productie-eigenaar',
};

const getMakerFunctionLabel = (makerFunction) => ROLES.find((role) => role.id === makerFunction)?.label
  || MAKER_FUNCTION_LABELS[makerFunction]
  || makerFunction;

const DIDIT_SUPPORT_EMAIL = 'admin@artes.app';
const DIDIT_APPROVED_STATUSES = ['approved'];
const DIDIT_REJECTED_STATUSES = ['declined'];

const normalizeDiditStatus = (statusValue) => String(statusValue || '').trim().toLowerCase() || null;

const getTimestampMs = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};


const isPostVisibleOnProfile = (post, targetUid, targetContributorId = null) => {
  if (!post || !targetUid) return false;
  if (post.authorId === targetUid) return true;
  if (!Array.isArray(post.credits)) return false;
  return post.credits.some((credit) => {
    if (!credit) return false;
    if (credit.uid === targetUid) return true;
    return Boolean(targetContributorId && credit.contributorId && credit.contributorId === targetContributorId);
  });
};

// Uploader + collaborators zien dezelfde gedeelde post op hun profielgrid.
const getProfileVisiblePosts = (posts, targetUid, targetContributorId = null) => {
  const filteredPosts = (Array.isArray(posts) ? posts : []).filter((post) => isPostVisibleOnProfile(post, targetUid, targetContributorId));
  const uniquePosts = Array.from(new Map(filteredPosts.map((post) => [post.id, post])).values());
  const resolvePostTimestamp = (post) => {
    if (post?.createdAt?.seconds) return post.createdAt.seconds * 1000;
    if (post?.createdAt?.toMillis) return post.createdAt.toMillis();
    if (typeof post?.createdAt === 'number') return post.createdAt;
    return 0;
  };
  return uniquePosts.sort((a, b) => resolvePostTimestamp(b) - resolvePostTimestamp(a));
};
const formatDateTimeNl = (value) => {
  const ms = getTimestampMs(value);
  if (!ms) return 'Onbekend';
  return new Date(ms).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const hasCompletedOnboarding = isOnboardingComplete;

const DIAG_TRACE_ID = `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const computeOnboardingStep = (profileData, authUserData, queryParams, authIsReady = true) => {
  const debugPayload = {
    authIsReady,
    authUid: authUserData?.uid || null,
    onboardingComplete: isOnboardingComplete(profileData),
    storedStepRaw: profileData?.onboardingStep ?? null,
    ageVerified: profileData?.ageVerified ?? null,
    isAdult: profileData?.isAdult ?? null,
    diditStatus: profileData?.diditStatus ?? null,
    idvStatus: profileData?.idv?.status ?? null,
    requestedStepRaw: queryParams?.get?.('step') ?? null,
  };
  if (!authIsReady) {
    if (import.meta.env.DEV) devLog('[onboarding-step:compute]', { traceId: DIAG_TRACE_ID, ...debugPayload, resolvedStep: null, reason: 'auth-not-ready' });
    return null;
  }
  if (!authUserData) {
    if (import.meta.env.DEV) devLog('[onboarding-step:compute]', { traceId: DIAG_TRACE_ID, ...debugPayload, resolvedStep: 1, reason: 'no-auth-user' });
    return 1;
  }

  if (isOnboardingComplete(profileData)) {
    if (import.meta.env.DEV) devLog('[onboarding-step:compute]', { traceId: DIAG_TRACE_ID, ...debugPayload, resolvedStep: 5, reason: 'onboarding-complete' });
    return 5;
  }
  const statusFromProfile = normalizeDiditStatus(profileData?.didit?.status || profileData?.idv?.status || profileData?.diditStatus);
  const ageVerified = profileData?.ageVerified;
  const isAdult = profileData?.isAdult;
  const storedStep = Number(profileData?.onboardingStep || 0);
  const requestedStep = Number.parseInt(queryParams?.get('step') || '', 10);

  let resolvedStep = 2;
  let reason = 'default-step-2';
  if (storedStep >= 3) {
    resolvedStep = Math.min(storedStep, 4);
    reason = 'stored-step';
  } else if (ageVerified === true && isAdult === true) {
    resolvedStep = 3;
    reason = 'adult-verified';
  } else if (ageVerified === false || DIDIT_REJECTED_STATUSES.includes(statusFromProfile || '')) {
    resolvedStep = 2;
    reason = 'age-not-verified-or-rejected';
  } else if (Number.isFinite(requestedStep) && requestedStep === 1 && !authUserData?.uid) {
    resolvedStep = 1;
    reason = 'requested-step-1-without-uid';
  }
  if (import.meta.env.DEV) {
    devLog('[onboarding-step:compute]', {
      traceId: DIAG_TRACE_ID,
      ...debugPayload,
      normalizedDiditStatus: statusFromProfile,
      storedStep,
      requestedStep,
      resolvedStep,
      reason,
      highlightStep3: resolvedStep === 3,
    });
  }
  return resolvedStep;
};

const PROOF_STATUS_LABELS = {
  pending: 'In afwachting',
  verified: 'Geverifieerd',
  failed: 'Mislukt',
};

const formatProofTimestamp = (value) => {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('nl-NL', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getProofStatusSummary = (proofData, method) => {
  if (!proofData) return null;
  const methodData = method === 'website' ? proofData.website : proofData.email;
  if (!methodData && !proofData?.[`${method}Verified`]) return null;
  const verified = method === 'website' ? proofData.websiteVerified : proofData.emailVerified;
  const lastCheckedAt = methodData?.lastCheckedAt
    || methodData?.lastVerifyAttemptAt
    || methodData?.tokenCreatedAt
    || (method === 'website' ? proofData.websiteVerifiedAt : proofData.emailVerifiedAt);
  const lastResult = methodData?.lastCheckResult || null;
  let status = 'pending';
  if (verified || lastResult === 'verified') {
    status = 'verified';
  } else if (lastResult && lastResult !== 'pending') {
    status = 'failed';
  }
  return { status, lastCheckedAt };
};

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
const isRawVisionSource = (value) => ['labeldetection', 'visionlabel', 'vision', 'cloudvision'].includes(String(value || '').trim().toLowerCase());
const isLegacyDiagnosticStringTrigger = (value) => {
  const normalized = resolveTriggerKey(typeof value === 'string' ? value : '');
  return normalized === 'spidersInsects' || normalized === 'needlesInjections';
};
const sanitizeDiagnosticTriggerKeys = (items = []) => (Array.isArray(items) ? items : [])
  .filter((item) => {
    if (typeof item === 'string' && isLegacyDiagnosticStringTrigger(item)) return false;
    if (item && typeof item === 'object') {
      if (isRawVisionSource(item.source)) return false;
      const triggerKey = resolveTriggerKey(item?.trigger || item?.reason);
      const hasSource = Object.prototype.hasOwnProperty.call(item, 'source') && item.source !== null && item.source !== undefined && String(item.source).trim() !== '';
      if (!hasSource && (triggerKey === 'spidersInsects' || triggerKey === 'needlesInjections')) return false;
    }
    return true;
  })
  .map((item) => (typeof item === 'string' ? item : item?.trigger || item?.reason))
  .map(resolveTriggerKey)
  .filter(Boolean)
  .filter((item, index, arr) => arr.indexOf(item) === index);

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

const CANONICAL_TRIGGER_ALIASES = {
  nudityErotic: 'adultArtNude',
  'Naakt (erotisch)': 'adultArtNude',
  'Naakt (Artistiek)': 'adultArtNude',
  explicit18: 'adultEroticSuggestive',
  'Expliciet 18+': 'adultEroticSuggestive',
};

const TRIGGERS = [
  { id: 'adultArtNude', label: '18+ Artistiek naakt' },
  { id: 'adultEroticSuggestive', label: '18+ Erotisch / suggestief' },
  { id: 'kinkBdsm', label: 'Kink / BDSM' },
  { id: 'breathRestriction', label: 'Ademrestrictie' },
  { id: 'bloodInjury', label: 'Bloed / verwonding' },
  { id: 'horrorScare', label: 'Horror / schrik' },
  { id: 'needlesInjections', label: 'Naalden / injecties' },
  { id: 'spidersInsects', label: 'Spinnen / insecten' },
];

const TAXONOMY_CORRECTION_TYPES = {
  SAFE: 'safeCorrection',
  SENSITIVE: 'sensitiveCorrection',
  REVIEW_REQUIRED: 'reviewRequiredCorrection',
  FORBIDDEN: 'noCorrectionForbidden',
};
const SENSITIVE_THEME_KEYS = ['art nude', 'boudoir'];
const isSensitiveThemeValue = (theme) => SENSITIVE_THEME_KEYS.includes(String(theme || '').trim().toLowerCase());
const SENSITIVE_TRIGGER_KEY_ALIASES = {
  kinkbdsm: 'kinkBdsm',
  horrorscary: 'horrorScare',
};
const SENSITIVE_TRIGGER_KEYS = new Set(['adultArtNude', 'adultEroticSuggestive', 'kinkBdsm', 'breathRestriction', 'bloodInjury', 'horrorScare', 'needlesInjections', 'spidersInsects']);
const normalizeSensitiveTriggerKey = (key) => {
  const raw = String(key || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SENSITIVE_TRIGGER_KEY_ALIASES[normalized] || resolveTriggerKey(raw);
};

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

const MODERATOR_REASON_CODES = [
  { id: 'allowed_art_nude', label: 'Allowed: art nude' },
  { id: 'allowed_boudoir', label: 'Allowed: boudoir' },
  { id: 'allowed_non_sensitive', label: 'Allowed: non-sensitive' },
  { id: 'review_borderline_adult', label: 'Review: borderline adult' },
  { id: 'forbidden_explicit_sexual', label: 'Forbidden: explicit sexual' },
  { id: 'forbidden_non_consensual_context', label: 'Forbidden: non-consensual context' },
  { id: 'wrong_theme_or_label', label: 'Wrong theme or label' },
  { id: 'unclear_ai_result', label: 'Unclear AI result' },
];
const MODERATOR_REASON_CODES_BY_ACTION = {
  approved: ['allowed_art_nude', 'allowed_boudoir', 'allowed_non_sensitive', 'wrong_theme_or_label'],
  rejected: ['forbidden_explicit_sexual', 'forbidden_non_consensual_context', 'wrong_theme_or_label'],
  queueFreshEvaluation: ['review_borderline_adult', 'unclear_ai_result', 'wrong_theme_or_label'],
};
const MODERATOR_DECISION_ACTIONS = {
  approveAsIs: 'approveAsIs',
  approveWithTaxonomyCorrection: 'approveWithTaxonomyCorrection',
  requestUserCorrection: 'requestUserCorrection',
  rejectForbidden: 'rejectForbidden',
};

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
  const normalized = {};
  Object.entries(triggerVisibility || {}).forEach(([key, value]) => {
    const resolvedKey = resolveTriggerKey(key);
    normalized[resolvedKey] = value;
  });
  TRIGGERS.forEach((trigger) => {
    const stored = normalized?.[trigger.id];
    normalized[trigger.id] = TRIGGER_PREFERENCE_OPTIONS.some((opt) => opt.id === stored) ? stored : 'cover';
  });
  return normalized;
};

const resolveTriggerKey = (trigger) => {
  if (!trigger) return trigger;
  const aliasMatch = CANONICAL_TRIGGER_ALIASES[trigger];
  if (aliasMatch) return aliasMatch;
  const normalizedKey = String(trigger).trim().toLowerCase();
  const normalizedAlias = Object.entries(CANONICAL_TRIGGER_ALIASES)
    .find(([key]) => key.toLowerCase() === normalizedKey)?.[1];
  if (normalizedAlias) return normalizedAlias;
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

const shouldCoverPost = (post, triggerVisibility, revealedSensitivePostsById = {}) => {
  const contentPreference = getPostContentPreference(post, triggerVisibility);
  const isSensitivePost = getPostTriggerKeys(post).length > 0;
  const isRevealed = revealedSensitivePostsById?.[post?.id] === true;
  return isSensitivePost && contentPreference === 'cover' && !isRevealed;
};

const normalizeProfileData = (profileData = {}, fallbackSeed = 'artes', options = {}) => {
  // Profile expectations:
  // avatar: string (data URL or https) used as both profile photo and profile header.
  // quickProfilePreviewMode: "latest" | "best" | "manual".
  // quickProfilePostIds: array of post IDs to preview when mode is "manual".
  const seed = profileData?.uid || profileData?.displayName || fallbackSeed;
  const fallbackRoles = Array.isArray(options?.fallbackRoles) ? options.fallbackRoles : ['fan'];
  const roles = Array.isArray(profileData?.roles) && profileData.roles.length
    ? profileData.roles
    : fallbackRoles;
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
    uid: profileData?.uid ?? profileData?.id ?? null,
    displayName: profileData?.displayName || 'Onbekende maker',
    bio: profileData?.bio || 'Nog geen bio toegevoegd.',
    roles,
    themes,
    avatar: profileData?.avatar || profileData?.photoURL || buildDefaultAvatar(seed),
    headerImage: profileData?.headerImage || '',
    headerPosition: profileData?.headerPosition || 'center',
    quickProfilePreviewMode,
    quickProfilePostIds,
    linkedAgencyName: profileData?.linkedAgencyName ?? null,
    linkedCompanyName: profileData?.linkedCompanyName ?? null,
    linkedAgencyId: profileData?.linkedAgencyId ?? null,
    linkedCompanyId: profileData?.linkedCompanyId ?? null,
    linkedAgencyLink: profileData?.linkedAgencyLink ?? '',
    linkedCompanyLink: profileData?.linkedCompanyLink ?? '',
    preferences: {
      ...profileData?.preferences,
      triggerVisibility,
      theme: themePreference,
    },
  };
};

const resolveLinkedProfileName = (linkedId, fallbackName, allUsers = []) => {
  if (linkedId) {
    const linkedUser = allUsers.find((item) => item?.uid === linkedId);
    if (linkedUser?.displayName) return linkedUser.displayName;
  }
  return fallbackName || '';
};

const normalizeUserForCollections = (userData = {}) => {
  const canonicalUid = userData?.uid || userData?.id || null;
  const normalizedProfile = normalizeProfileData(
    { ...userData, uid: canonicalUid },
    canonicalUid || userData?.displayName || 'artes-user',
    { fallbackRoles: [] },
  );
  return {
    ...normalizedProfile,
    uid: canonicalUid,
    roles: Array.isArray(userData?.roles) ? userData.roles.filter(Boolean) : normalizedProfile.roles,
    themes: Array.isArray(userData?.themes) ? userData.themes.filter(Boolean) : [],
  };
};

const resolveProfileFromCollections = ({ userId, allUsers = [], currentUserId, currentProfile }) => {
  const normalizedAllUsers = Array.isArray(allUsers)
    ? allUsers.map((entry) => normalizeUserForCollections(entry))
    : [];
  const existing = normalizedAllUsers.find((u) => u.uid === userId || u.id === userId) || null;

  if (existing) {
    if (currentUserId && userId === currentUserId && currentProfile) {
      return normalizeProfileData(
        { ...existing, ...currentProfile, uid: currentUserId },
        currentUserId,
        { fallbackRoles: [] },
      );
    }
    return normalizeProfileData(existing, userId, { fallbackRoles: [] });
  }

  if (currentUserId && userId === currentUserId && currentProfile) {
    return normalizeProfileData({ ...currentProfile, uid: currentUserId }, userId, { fallbackRoles: [] });
  }

  return null;
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
  const baseStyle = "min-h-9 px-3 py-2 text-sm rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer md:min-h-0 md:px-6 md:py-3 md:text-base md:rounded-xl md:gap-2";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed",
    secondary: "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700",
    ghost: "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800",
    danger: "bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400",
    outline: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-white/40 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 backdrop-blur-md", 
  };
  
  if (asChild) return <span className={`${baseStyle} ${variants[variant]} ${className}`}>{children}</span>;
  return <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`} disabled={disabled}>{children}</button>;
};

const Badge = ({ children, colorClass, onClick, className = '' }) => (
  <span 
    onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border md:px-3 md:py-1 md:text-xs ${onClick ? 'cursor-pointer hover:opacity-80' : ''} ${colorClass} ${className}`}
  >
    {children}
  </span>
);

const Input = ({ label, type = "text", placeholder, value, onChange, error }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
    <input
      type={type}
      className={`w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all md:px-4 md:py-3 md:text-base md:rounded-xl ${error ? 'border-red-500 focus:ring-red-400' : 'border-slate-200 dark:border-slate-700'}`}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
    {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
  </div>
);

// --- Main App ---

export default function ArtesApp() {
  const buildVerificationGateState = (sourceUser) => {
    const providerIds = Array.isArray(sourceUser?.providerData)
      ? sourceUser.providerData.map((provider) => provider?.providerId).filter(Boolean)
      : [];
    return {
      hasUser: Boolean(sourceUser?.uid),
      emailVerified: sourceUser?.emailVerified === true,
      hasPasswordProvider: providerIds.includes('password'),
    };
  };
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [view, setView] = useState('loading');
  const [authUser, setAuthUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authPending, setAuthPending] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [appShortcutInfoMode, setAppShortcutInfoMode] = useState(null); // null | 'popup' | 'settings'
  const [verificationNote, setVerificationNote] = useState(null);
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationGateState, setVerificationGateState] = useState(() => buildVerificationGateState(null));
  const [appConfig, setAppConfig] = useState(null);
  
  // Modals & States
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadContext, setUploadContext] = useState({ isChallenge: false });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [quickProfileId, setQuickProfileId] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [shadowProfile, setShadowProfile] = useState(null);
  const [moderationModal, setModerationModal] = useState(null);
  const [moderationActionPending, setModerationActionPending] = useState(false);
  const [moderatorAccess, setModeratorAccess] = useState(null);
  const [isModeratorClient, setIsModeratorClient] = useState(false);
  const [moderationUnreadBlocked, setModerationUnreadBlocked] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [activeAppAnnouncement, setActiveAppAnnouncement] = useState(null);
  const [announcementVisible, setAnnouncementVisible] = useState(false);
  const [announcementDismissPending, setAnnouncementDismissPending] = useState(false);
  const [supportThreadId, setSupportThreadId] = useState(null);
  const [resolvedModerationThreadId, setResolvedModerationThreadId] = useState('');
  const [latestActionableReviewMs, setLatestActionableReviewMs] = useState(0);
  const [latestActionableSupportMs, setLatestActionableSupportMs] = useState(0);
  const [moderationLastSeenMs, setModerationLastSeenMs] = useState(0);
  const [pendingApprovedReminder, setPendingApprovedReminder] = useState(null);
  const [acknowledgedApprovedUploadIds, setAcknowledgedApprovedUploadIds] = useState(() => new Set());
  const [claimInviteToken, setClaimInviteToken] = useState(null);
  const ensuredSupportThreadUidRef = useRef(null);
  const authReadyRef = useRef(false);
  const authUserRef = useRef(null);
  const isModeratorClientRef = useRef(false);
  const moderationModalIdRef = useRef(null);
  const unsubRef = useRef(null);
  const moderationListenerKeyRef = useRef(null);
  const moderationBlockedKeysRef = useRef(new Set());
  const lastUidRef = useRef(null);
  const profileUnsubscribeRef = useRef(null);
  const profileActiveKeyRef = useRef(null);
  const profileBlockedKeysRef = useRef(new Set());
  const waitForAuthoritativeProfileRef = useRef(false);
  const appStartAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const viewRef = useRef('loading');
  const viewReasonRef = useRef('initial');
  const userProfile = profile;
  const appShortcutInfoStorageKey = useMemo(
    () => (authUser?.uid ? `artes.appShortcutInfoDismissed.${authUser.uid}` : null),
    [authUser?.uid],
  );
  const profileAgeVerified = profile?.ageVerified === true || profile?.isAdult === true;
  const profileAgeVerifiedStrict = profile?.ageVerified === true;
  const canReadFirestore = canAccessFirestore({ authReady, user: authUser });
  const moderatorResolvedTrue = isModeratorClient === true;
  const newestActionableModerationMs = Math.max(latestActionableReviewMs, latestActionableSupportMs);
  const hasNewModerationWork = moderatorAccess === true
    && newestActionableModerationMs > 0
    && newestActionableModerationMs > moderationLastSeenMs;
  const canStartModerationUnread = canStartModeration({
    authReady,
    user: { ...authUser, isModerator: moderatorResolvedTrue },
    profile,
    config: appConfig,
  }) && !!resolvedModerationThreadId;
  const onboardingLocked = Boolean(authUser?.uid && profile && !hasCompletedOnboarding(profile));
  const appAccessReady = authReady && Boolean(authUser?.uid) && !profileLoading && !onboardingLocked;
  const showActiveAppAnnouncement = Boolean(
    activeAppAnnouncement && announcementVisible
  );
  useEffect(() => {
    if (!appAccessReady || !canReadFirestore) {
      setActiveAppAnnouncement(null);
      setAnnouncementVisible(false);
      return;
    }
    let cancelled = false;
    const loadAnnouncement = async () => {
      try {
        const db = getFirebaseDbInstance();
        const announcementQuery = query(
          collection(db, 'announcements'),
          where('type', '==', 'appUpdate'),
          where('status', '==', 'active'),
          where('isCurrent', '==', true),
          limit(1),
        );
        const announcementSnap = await getDocs(announcementQuery);
        if (cancelled || announcementSnap.empty) {
          setActiveAppAnnouncement(null);
          setAnnouncementVisible(false);
          return;
        }
        const announcementDoc = announcementSnap.docs[0];
        const announcement = { id: announcementDoc.id, ...announcementDoc.data() };
        const readSnap = await getDoc(doc(db, 'users', authUser.uid, 'announcementReads', announcement.id));
        if (cancelled) return;
        setActiveAppAnnouncement(announcement);
        setAnnouncementVisible(!readSnap.exists());
      } catch (error) {
        if (import.meta.env.DEV) {
          console.debug('[announcement] load failed', error);
        }
      }
    };
    loadAnnouncement();
    return () => {
      cancelled = true;
    };
  }, [appAccessReady, canReadFirestore, authUser?.uid, moderationLastSeenMs]);

  const handleDismissAnnouncement = useCallback(async () => {
    if (!authUser?.uid || !activeAppAnnouncement?.id || announcementDismissPending) return;
    setAnnouncementDismissPending(true);
    try {
      const db = getFirebaseDbInstance();
      await setDoc(doc(db, 'users', authUser.uid, 'announcementReads', activeAppAnnouncement.id), {
        dismissedAt: serverTimestamp(),
        version: Number(activeAppAnnouncement.version || 1),
      }, { merge: true });
      setAnnouncementVisible(false);
    } finally {
      setAnnouncementDismissPending(false);
    }
  }, [authUser?.uid, activeAppAnnouncement, announcementDismissPending]);

  useEffect(() => {
    const uid = authUser?.uid || null;
    if (lastUidRef.current && lastUidRef.current !== uid) {
      moderationBlockedKeysRef.current?.clear?.();
      profileBlockedKeysRef.current?.clear?.();
    }
    lastUidRef.current = uid;
  }, [authUser?.uid]);

  const [communityConfig, setCommunityConfig] = useState(DEFAULT_COMMUNITY_CONFIG);
  const [challengeConfig, setChallengeConfig] = useState(DEFAULT_CHALLENGE_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);
  const handleOpenUploadModal = useCallback((options = {}) => {
    setUploadContext({ isChallenge: false, resumeUploadId: null, ...options });
    setShowUploadModal(true);
  }, []);

  // Data
  const [posts, setPosts] = useState([]);
  const [users, setUsers] = useState([]);
  const currentPublicProfile = useMemo(
    () => users.find((entry) => entry?.uid === authUser?.uid) || null,
    [users, authUser?.uid],
  );
  const [followingIds, setFollowingIds] = useState(() => new Set());
  const [followingLoaded, setFollowingLoaded] = useState(false);
  const [revealedSensitivePostsById, setRevealedSensitivePostsById] = useState({});
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
    const explicitBase = import.meta.env.VITE_FUNCTIONS_BASE_URL || import.meta.env.VITE_FUNCTIONS_BASE;
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
  const getStartupElapsedMs = useCallback(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return Math.round(now - appStartAtRef.current);
  }, []);
  const logStartup = useCallback((label, payload = {}) => {
    if (!import.meta.env.DEV) return;
    devLog('[startup-flow]', { traceId: DIAG_TRACE_ID, label, elapsedMs: getStartupElapsedMs(), ...payload });
  }, [getStartupElapsedMs]);
  const setViewWithReason = useCallback((nextView, reason, payload = {}) => {
    viewReasonRef.current = reason || 'unspecified';
    if (import.meta.env.DEV) {
      devLog('[view-transition:intent]', {
        from: viewRef.current,
        to: nextView,
        traceId: DIAG_TRACE_ID,
        reason: viewReasonRef.current,
        ...payload,
      });
    }
    setView(nextView);
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
    // Backend endpoint returns support-thread ids (support_<uid>).
    return data?.threadId || `support_${user.uid}`;
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

  const logListenerStart = useCallback((label, options = {}) => {
    if (!import.meta.env.DEV) return;
    const listenerUser = options.authUser ?? authUserRef.current;
    const listenerReady = options.authReady ?? authReadyRef.current;
    const listenerModeratorClient = options.isModeratorClient ?? isModeratorClientRef.current;
    devLog('[listener-start]', { label,
      authReady: listenerReady,
      uid: listenerUser?.uid || null,
      emailVerified: listenerUser?.emailVerified ?? null,
      isModeratorClient: Boolean(listenerModeratorClient),
    });
  }, []);

  const cleanupModerationListener = useCallback(() => {
    if (!unsubRef.current) return;
    const unsubscribe = unsubRef.current;
    unsubRef.current = null;
    unsubscribe();
  }, []);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    const previousView = viewRef.current;
    if (previousView !== view && import.meta.env.DEV) {
      devLog('[view-transition:commit]', {
        from: previousView,
        to: view,
        traceId: DIAG_TRACE_ID,
        reason: viewReasonRef.current || 'unknown',
      });
    }
    viewRef.current = view;
    viewReasonRef.current = 'unknown';
  }, [view]);

  useEffect(() => {
    isModeratorClientRef.current = isModeratorClient;
  }, [isModeratorClient]);

  useEffect(() => {
    moderationModalIdRef.current = moderationModal?.id || null;
  }, [moderationModal?.id]);

  const handleListenerError = useCallback((label, error) => {
    if (error?.code === 'permission-denied' && !authReady) {
      if (import.meta.env.DEV) {
        console.log(`[ArtesApp] ${label} skipped, auth not ready`);
      }
      return;
    }
    if (error?.code === 'permission-denied') {
      devLog('[listener-blocked]', { label, code: error?.code });
      return;
    }
    console.error('SNAPSHOT ERROR:', error?.code, error?.message, 'LABEL:', label);
  }, [authReady]);

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
    logStartup('auth-callback-start');
    initAuth().catch((error) => console.error('Auth init error', error));
    handleAuthRedirectResult().catch((error) => console.error('Auth redirect error', error));

    const unsubscribe = observeAuth(async (u) => {
      if (!active) return;
      logStartup('auth-resolved', {
        uid: u?.uid || null,
        emailVerified: u?.emailVerified ?? null,
      });
      if (import.meta.env.DEV) {
        const providers = Array.isArray(u?.providerData)
          ? u.providerData.map((provider) => provider?.providerId).filter(Boolean)
          : [];
        console.log('[ArtesApp] Auth state changed', {
          uid: u?.uid || null,
          email: u?.email || null,
          emailVerified: u?.emailVerified ?? false,
          provider: providers,
        });
      }
      if (!authReadyRef.current) {
        authReadyRef.current = true;
        setAuthReady(true);
      }
      logStartup('before-setView-loading', { currentView: viewRef.current });
      setProfileLoading(true);
      setViewWithReason('loading', 'observeAuth:init-loading');
      setUser(u);
      setAuthUser(u);
      setVerificationGateState(buildVerificationGateState(u));
      setResolvedModerationThreadId('');
      if (!u) {
        logStartup('before-setProfile-null', { codePath: 'observeAuth:no-user' });
        setProfile(null);
        ensuredSupportThreadUidRef.current = null;
        const path = window.location.pathname || '/';
        const claimToken = getClaimTokenFromPath(path);
        setClaimInviteToken(claimToken);
        const unauthView = claimToken
          ? 'claim'
          : path.startsWith('/claim-email')
            ? 'claimEmail'
          : path.startsWith('/support')
          ? 'support'
          : path.startsWith('/chat') || path.startsWith('/messages')
            ? 'chat'
            : 'login';
        logStartup('before-setView-unauth', { nextView: unauthView, path });
        setViewWithReason(unauthView, 'observeAuth:no-user-routing', { path });
        logStartup('before-setProfileLoading-false', { codePath: 'observeAuth:no-user' });
        setProfileLoading(false);
        return;
      }
      try {
        if (authReadyRef.current && u?.uid && ensuredSupportThreadUidRef.current !== u.uid) {
          ensuredSupportThreadUidRef.current = u.uid;
          ensureSupportThreadExists(u.uid, u).catch((error) => {
            if (error?.message?.includes('permission')) {
              if (import.meta.env.DEV) {
                console.log('[ArtesApp] Support thread creation deferred');
              }
            } else {
              console.error('[ArtesApp] Failed to ensure support thread', error);
            }
          });
        }
        await migrateArtifactsUserData(u);
        logStartup('bootstrap-reads-complete', { uid: u.uid, stage: 'migrateArtifactsUserData' });
        const profileData = await ensureUserProfile(u);
        logStartup('profile-loaded', {
          uid: u.uid,
          onboardingStep: profileData?.onboardingStep ?? null,
          onboardingComplete: profileData?.onboardingComplete ?? null,
          ageVerified: profileData?.ageVerified ?? null,
          isAdult: profileData?.isAdult ?? null,
        });
        const normalized = normalizeProfileData(profileData, u.uid);
        logStartup('before-setProfile', {
          uid: u.uid,
          onboardingStep: normalized?.onboardingStep ?? null,
          onboardingComplete: normalized?.onboardingComplete ?? null,
        });
        setProfile(normalized);
        const onboardingComplete = hasCompletedOnboarding(profileData);
        const baseView = onboardingComplete ? 'gallery' : 'onboarding';
        const path = window.location.pathname || '/';
        const claimToken = getClaimTokenFromPath(path);
        setClaimInviteToken(claimToken);
        const routedView = claimToken
          ? 'claim'
          : path.startsWith('/claim-email')
            ? 'claimEmail'
          : path.startsWith('/moderation')
            ? 'moderation'
          : path.startsWith('/vouch')
            ? 'vouch'
          : path.startsWith('/support')
            ? 'support'
            : path.startsWith('/chat') || path.startsWith('/messages')
              ? 'chat'
              : baseView;
        const nextView = onboardingComplete ? routedView : 'onboarding';
        logStartup('before-setView-authenticated', { nextView, onboardingComplete, path });
        setViewWithReason(nextView, 'observeAuth:authenticated-routing', { onboardingComplete, path });
        ensureModerationThread(u)
          .then((threadId) => {
            if (!threadId) return;
            setResolvedModerationThreadId(threadId);
          })
          .catch((error) => {
            console.error('Failed to ensure support thread', error);
          });
      } catch (e) {
        if (e?.code === 'permission-denied') {
          if (import.meta.env.DEV) {
            console.log('[ArtesApp] Profile init permission denied, waiting for authoritative profile');
          }
          waitForAuthoritativeProfileRef.current = true;
          logStartup('permission-denied-await-authoritative-profile', { uid: u.uid });
          return;
        } else {
          console.error('Failed to load profile', e);
          logStartup('before-setView-error-onboarding', { uid: u.uid, errorCode: e?.code || null });
          setViewWithReason('onboarding', 'observeAuth:error-fallback');
        }
      } finally {
        if (!waitForAuthoritativeProfileRef.current) {
          logStartup('before-setProfileLoading-false', { codePath: 'observeAuth:finally', uid: u?.uid || null });
          setProfileLoading(false);
        }
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [ensureModerationThread, getClaimTokenFromPath, logStartup, setViewWithReason]);

  useEffect(() => {
    if (!authReady) return;
    if (!canReadFirestore) {
      setCommunityConfig(DEFAULT_COMMUNITY_CONFIG);
      setChallengeConfig(DEFAULT_CHALLENGE_CONFIG);
      setConfigLoading(false);
      return;
    }
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
        if (error?.code === 'permission-denied') {
          if (import.meta.env.DEV) {
            console.log('[ArtesApp] Config load skipped, permission denied');
          }
        } else {
          console.error('Failed to load community config', error);
        }
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
  }, [authReady, canReadFirestore]);

  useEffect(() => {
    if (!profile?.preferences?.theme) return;
    setDarkMode(profile.preferences.theme === 'dark');
  }, [profile?.preferences?.theme]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname || '/';
      if (onboardingLocked) {
        setViewWithReason('onboarding', 'popstate:onboarding-locked', { path });
        return;
      }
      if (path.startsWith('/claim/')) {
        setClaimInviteToken(getClaimTokenFromPath(path));
        setViewWithReason('claim', 'popstate:claim-path', { path });
      } else if (path.startsWith('/claim-email')) {
        setViewWithReason('claimEmail', 'popstate:claim-email-path', { path });
      } else if (path.startsWith('/moderation')) {
        setViewWithReason('moderation', 'popstate:moderation-path', { path });
      } else if (path.startsWith('/vouch')) {
        setViewWithReason('vouch', 'popstate:vouch-path', { path });
      } else if (path.startsWith('/support')) {
        setViewWithReason('support', 'popstate:support-path', { path });
      } else if (path.startsWith('/chat') || path.startsWith('/messages')) {
        setViewWithReason('chat', 'popstate:chat-path', { path });
      } else if (view === 'moderation' || view === 'vouch' || view === 'support' || view === 'chat') {
        setViewWithReason('gallery', 'popstate:return-to-gallery', { path, previousView: view });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [view, getClaimTokenFromPath, onboardingLocked, setViewWithReason]);

  useEffect(() => {
    if (profileLoading || !authUser?.uid || !profile) return;
    if (view !== 'onboarding' || !hasCompletedOnboarding(profile)) return;
    const path = window.location.pathname || '/';
    const nextView = path.startsWith('/claim/') ? 'claim'
      : path.startsWith('/claim-email') ? 'claimEmail'
      : path.startsWith('/moderation') ? 'moderation'
      : path.startsWith('/vouch') ? 'vouch'
      : path.startsWith('/support') ? 'support'
      : (path.startsWith('/chat') || path.startsWith('/messages')) ? 'chat'
      : 'gallery';
    if (nextView === 'claim') {
      setClaimInviteToken(getClaimTokenFromPath(path));
    }
    setViewWithReason(nextView, 'onboarding-complete-redirect', { path });
  }, [profileLoading, authUser?.uid, profile, view, getClaimTokenFromPath, setViewWithReason]);

  useEffect(() => {
    if (view === 'claim' || view === 'claimEmail') {
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
  // No Firestore listeners before authReady.
  useEffect(() => {
    if (!authReady) {
      setFollowingIds(new Set());
      setFollowingLoaded(false);
      return () => {};
    }
    if (!user?.uid) {
      setFollowingIds(new Set());
      setFollowingLoaded(true);
      return () => {};
    }

    setFollowingLoaded(false);
    const unsubscribeFollowing = subscribeToFollowingIds((nextIds) => {
      setFollowingIds(new Set(nextIds || []));
      setFollowingLoaded(true);
    }, { expectedAuthUid: user.uid });

    return () => {
      unsubscribeFollowing?.();
    };
  }, [authReady, user?.uid]);

  useEffect(() => {
     if (!canAccessFirestore({ authReady, user })) return;
     logListenerStart('Posts listener (ArtesApp)');
     const unsubPosts = subscribeToPosts(setPosts, { authReady, user });
     logListenerStart('Users listener (ArtesApp)');
     const unsubUsers = subscribeToUsers(
       (nextUsers = []) => {
         const normalizedUsers = Array.isArray(nextUsers)
           ? nextUsers.map((nextUser) => normalizeUserForCollections(nextUser))
           : [];
         setUsers(normalizedUsers);
       },
       { authReady, user },
     );
     return () => { if (typeof unsubPosts === 'function') unsubPosts(); if (typeof unsubUsers === 'function') unsubUsers(); };
  }, [authReady, user, logListenerStart]);

  useEffect(() => {
    let active = true;

    const resolveModeratorStatus = async () => {
      setIsModeratorClient(false);
      if (!canReadFirestore || !authUser?.emailVerified || !profileAgeVerified) {
        return;
      }

      const db = getFirebaseDbInstance();
      try {
        const moderationDoc = await getDoc(doc(db, 'config', 'moderation'));
        if (!active) return;
        const moderatorEmails = moderationDoc.exists() ? (moderationDoc.data().moderatorEmails || []) : [];
        const resolvedIsModeratorClient = Boolean(authUser?.email && moderatorEmails.includes(authUser.email));
        setIsModeratorClient(resolvedIsModeratorClient);
      } catch (error) {
        if (!active) return;
        setIsModeratorClient(false);
        console.error('Failed to resolve moderator status', error);
      }
    };

    resolveModeratorStatus();

    return () => {
      active = false;
    };
  }, [canReadFirestore, authUser?.email, authUser?.emailVerified, profileAgeVerified]);

  useEffect(() => {
    let active = true;

    const setupModerationUnreadListener = () => {
      const listenerKey = `${authUser?.uid || 'none'}|${resolvedModerationThreadId || 'none'}`;

      cleanupModerationListener();
      if (!canStartModerationUnread) {
        setModerationUnreadBlocked(false);
        moderationListenerKeyRef.current = null;
        return;
      }

      if (moderationBlockedKeysRef.current.has(listenerKey)) {
        devLog('[listener-blocked]', { label: 'Moderation unread listener (ArtesApp)', key: listenerKey });
        return;
      }

      if (moderationListenerKeyRef.current === listenerKey) {
        return;
      }
      moderationListenerKeyRef.current = listenerKey;

      const db = getFirebaseDbInstance();
      const messagesRef = collection(db, 'threads', resolvedModerationThreadId, 'messages');
      const q = query(messagesRef, where('unread', '==', true), orderBy('createdAt', 'desc'), limit(1));

      logListenerStart('Moderation unread listener (ArtesApp)', {
        isModeratorClient: true,
      });
      unsubRef.current = onSnapshot(
        q,
        (snapshot) => {
          if (!active || snapshot.empty) return;
          const docSnap = snapshot.docs[0];
          if (moderationModalIdRef.current === docSnap.id) return;
          setModerationModal({ id: docSnap.id, ...docSnap.data() });
        },
        (err) => {
          cleanupModerationListener();
          if (err?.code === 'permission-denied') {
            moderationBlockedKeysRef.current.add(listenerKey);
            setModerationUnreadBlocked(true);
            devLog('[listener-blocked]', { label: 'Moderation unread listener (ArtesApp)', key: listenerKey, code: err?.code });
            return;
          }
          handleListenerError('Moderation unread listener (ArtesApp)', err);
        },
      );
    };

    setupModerationUnreadListener();

    return () => {
      active = false;
      cleanupModerationListener();
    };
  }, [
    canStartModerationUnread,
    authUser?.uid,
    logListenerStart,
    handleListenerError,
    resolvedModerationThreadId,
    cleanupModerationListener,
  ]);

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
    if (!authReady || !authUser?.uid || !functionsBase) return;
    let active = true;
    ensureModerationThread(authUser)
      .then((threadId) => {
        if (!active) return;
        if (!threadId) return;
        setResolvedModerationThreadId(threadId);
        setSupportThreadId(threadId);
      })
      .catch((error) => {
        if (!active) return;
        console.error('Failed to ensure moderation thread', error);
        setToastMessage('Support chat openen is mislukt.');
      });
    return () => {
      active = false;
    };
  }, [view, authReady, authUser, functionsBase, ensureModerationThread]);

  useEffect(() => {
    if (!authReady || !authUser) {
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
  }, [authReady, authUser?.uid, authUser?.email]);

  useEffect(() => {
    if (view !== 'moderation' || profileLoading) return;
    if (moderatorAccess === false) {
      setView('gallery');
      setToastMessage('Geen toegang');
    }
  }, [view, profileLoading, moderatorAccess]);

  useEffect(() => {
    if (!authReady || !authUser?.uid || moderatorAccess !== true) {
      setModerationLastSeenMs(0);
      return;
    }
    const db = getFirebaseDbInstance();
    return onSnapshot(
      doc(db, 'users', authUser.uid),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setModerationLastSeenMs(getTimestampMs(data?.moderation?.lastSeenAt));
      },
      () => setModerationLastSeenMs(0),
    );
  }, [authReady, authUser?.uid, moderatorAccess]);

  useEffect(() => {
    if (!authReady || !authUser?.uid || moderatorAccess !== true) {
      setLatestActionableReviewMs(0);
      return;
    }
    const db = getFirebaseDbInstance();
    const q = query(
      collection(db, 'reviewCases'),
      where('status', '==', 'inReview'),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    return onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setLatestActionableReviewMs(0);
          return;
        }
        const entry = snapshot.docs[0]?.data() || {};
        setLatestActionableReviewMs(getTimestampMs(entry.createdAt));
      },
      () => setLatestActionableReviewMs(0),
    );
  }, [authReady, authUser?.uid, moderatorAccess]);

  useEffect(() => {
    if (!authReady || !authUser?.uid || moderatorAccess !== true) {
      setLatestActionableSupportMs(0);
      return;
    }
    const db = getFirebaseDbInstance();
    const q = query(
      collection(db, 'threads'),
      where('type', '==', 'support'),
      where('hasUserMessage', '==', true),
      where('unreadForModerator', '>', 0),
      orderBy('unreadForModerator', 'desc'),
      orderBy('lastMessageAt', 'desc'),
      limit(1),
    );
    return onSnapshot(
      q,
      (snapshot) => {
        if (snapshot.empty) {
          setLatestActionableSupportMs(0);
          return;
        }
        const entry = snapshot.docs[0]?.data() || {};
        setLatestActionableSupportMs(getTimestampMs(entry.lastMessageAt));
      },
      () => setLatestActionableSupportMs(0),
    );
  }, [authReady, authUser?.uid, moderatorAccess]);

  const openModerationPortal = useCallback(async () => {
    setShowSettingsModal(false);
    if (moderatorAccess === true && authUser?.uid && authReady && canAccessFirestore({ authReady, user: authUser })) {
      try {
        const db = getFirebaseDbInstance();
        await setDoc(doc(db, 'users', authUser.uid), {
          moderation: {
            lastSeenAt: serverTimestamp(),
          },
        }, { merge: true });
        setModerationLastSeenMs(Date.now());
      } catch (error) {
        console.error('Failed to store moderation lastSeenAt', error);
      }
    }
    setView('moderation');
  }, [authReady, authUser, moderatorAccess]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Live snapshot listener for own profile updates
  // This ensures UI updates immediately when profile is saved, not just on tab switch
  useEffect(() => {
    const key = authUser?.uid ? `profile:${authUser.uid}` : null;

    if (!canAccessFirestore({ authReady, user: authUser }) || !key) {
      if (profileUnsubscribeRef.current) {
        profileUnsubscribeRef.current();
        profileUnsubscribeRef.current = null;
      }
      profileActiveKeyRef.current = null;
      return;
    }

    if (profileBlockedKeysRef.current.has(key)) {
      devLog('[listener-blocked]', { label: 'Profile listener (ArtesApp)', key });
      if (waitForAuthoritativeProfileRef.current) {
        waitForAuthoritativeProfileRef.current = false;
        logStartup('authoritative-profile-unavailable-blocked-key', { uid: authUser.uid, key });
        setProfileLoading(false);
        setViewWithReason('onboarding', 'profile-listener:authoritative-profile-unavailable', {
          path: window.location.pathname || '/',
          code: 'permission-denied',
        });
      }
      return;
    }

    if (profileActiveKeyRef.current === key && profileUnsubscribeRef.current) {
      return;
    }

    if (profileUnsubscribeRef.current) {
      profileUnsubscribeRef.current();
      profileUnsubscribeRef.current = null;
    }

    const db = getFirebaseDbInstance();
    profileActiveKeyRef.current = key;
    logListenerStart('Profile listener (ArtesApp)');

    profileUnsubscribeRef.current = onSnapshot(
      doc(db, 'users', authUser.uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          if (waitForAuthoritativeProfileRef.current) {
            waitForAuthoritativeProfileRef.current = false;
            const path = window.location.pathname || '/';
            logStartup('authoritative-profile-missing-doc', { uid: authUser.uid, path });
            setProfileLoading(false);
            setViewWithReason('onboarding', 'profile-listener:authoritative-profile-missing-doc', { path });
          }
          return;
        }
        const normalized = normalizeProfileData(snapshot.data(), authUser.uid);
        devLog('[onboarding-state]', {
          uid: authUser.uid,
          onboardingStep: normalized?.onboardingStep,
          onboardingComplete: normalized?.onboardingComplete === true,
        });
        setProfile(normalized);
        if (waitForAuthoritativeProfileRef.current) {
          waitForAuthoritativeProfileRef.current = false;
          const onboardingComplete = hasCompletedOnboarding(normalized);
          const path = window.location.pathname || '/';
          const claimToken = getClaimTokenFromPath(path);
          setClaimInviteToken(claimToken);
          const routedView = claimToken
            ? 'claim'
            : path.startsWith('/claim-email')
              ? 'claimEmail'
            : path.startsWith('/moderation')
              ? 'moderation'
            : path.startsWith('/vouch')
              ? 'vouch'
            : path.startsWith('/support')
              ? 'support'
              : path.startsWith('/chat') || path.startsWith('/messages')
                ? 'chat'
                : onboardingComplete ? 'gallery' : 'onboarding';
          const nextView = onboardingComplete ? routedView : 'onboarding';
          logStartup('before-setView-authoritative-profile', { uid: authUser.uid, nextView, onboardingComplete, path });
          setViewWithReason(nextView, 'profile-listener:authoritative-routing', { onboardingComplete, path });
          setProfileLoading(false);
        }
      },
      (error) => {
        if (error?.code === 'permission-denied') {
          if (profileUnsubscribeRef.current) {
            profileUnsubscribeRef.current();
            profileUnsubscribeRef.current = null;
          }
          profileBlockedKeysRef.current.add(key);
          devLog('[listener-blocked]', { label: 'Profile listener (ArtesApp)', key, code: error?.code });
          if (waitForAuthoritativeProfileRef.current) {
            waitForAuthoritativeProfileRef.current = false;
            logStartup('authoritative-profile-unavailable-permission-denied', {
              uid: authUser.uid,
              key,
              code: error?.code,
            });
            setProfileLoading(false);
            setViewWithReason('onboarding', 'profile-listener:authoritative-profile-unavailable', {
              path: window.location.pathname || '/',
              code: error?.code,
            });
          }
          return;
        }
        handleListenerError('Profile listener (ArtesApp)', error);
      }
    );

    return () => {
      if (profileUnsubscribeRef.current) {
        profileUnsubscribeRef.current();
        profileUnsubscribeRef.current = null;
      }
    };
  }, [authReady, authUser?.uid, getClaimTokenFromPath, logListenerStart, handleListenerError, logStartup, setViewWithReason]);

  const handleOpenSupportChat = () => {
    if (!authReady || !authUser?.uid || !functionsBase) {
      setToastMessage('Support chat is momenteel niet beschikbaar.');
      return;
    }
    setView('chat');
    ensureModerationThread(authUser)
      .then((threadId) => {
        if (threadId) {
          setResolvedModerationThreadId(threadId);
          setSupportThreadId(threadId);
        }
      })
      .catch((error) => {
        console.error('Failed to ensure moderation thread', error);
      });
  };

  const approvedReminderStorageKey = authUser?.uid
    ? `artes.approvedReminderAcknowledged.${authUser.uid}`
    : '';

  useEffect(() => {
    if (!approvedReminderStorageKey) {
      setAcknowledgedApprovedUploadIds(new Set());
      return;
    }
    try {
      const raw = window.localStorage.getItem(approvedReminderStorageKey);
      if (!raw) {
        setAcknowledgedApprovedUploadIds(new Set());
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setAcknowledgedApprovedUploadIds(new Set());
        return;
      }
      setAcknowledgedApprovedUploadIds(new Set(parsed.filter((value) => typeof value === 'string' && value.trim())));
    } catch {
      setAcknowledgedApprovedUploadIds(new Set());
    }
  }, [approvedReminderStorageKey]);

  const markApprovedUploadReminderAcknowledged = useCallback((uploadId) => {
    if (!uploadId) return;
    setAcknowledgedApprovedUploadIds((prev) => {
      if (prev.has(uploadId)) return prev;
      const next = new Set(prev);
      next.add(uploadId);
      if (approvedReminderStorageKey) {
        try {
          window.localStorage.setItem(approvedReminderStorageKey, JSON.stringify(Array.from(next)));
        } catch {
          // noop: localStorage can fail in restricted browser modes.
        }
      }
      return next;
    });
  }, [approvedReminderStorageKey]);

  const handleResumeApprovedUpload = useCallback((uploadId) => {
    if (!uploadId) return;
    markApprovedUploadReminderAcknowledged(uploadId);
    handleOpenUploadModal({ resumeUploadId: uploadId, isChallenge: false });
    setPendingApprovedReminder(null);
  }, [handleOpenUploadModal, markApprovedUploadReminderAcknowledged]);

  const handlePendingReminderToChat = useCallback(() => {
    setPendingApprovedReminder(null);
    handleOpenSupportChat();
  }, [handleOpenSupportChat]);

  useEffect(() => {
    if (!authReady || !authUser?.uid || !profile) {
      setPendingApprovedReminder(null);
      return;
    }
    let active = true;
    const db = getFirebaseDbInstance();

    const resolveTimestamp = (value) => {
      if (!value) return 0;
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') return value.seconds * 1000;
      if (typeof value === 'number') return value;
      return 0;
    };

    const loadPendingApprovedUpload = async () => {
      try {
        const snapshot = await getDocs(query(
          collection(db, 'uploads'),
          where('userId', '==', authUser.uid),
          where('reviewStatus', '==', 'approved'),
          where('publicationStatus', '==', 'pending'),
          limit(10),
        ));
        if (!active || snapshot.empty) {
          setPendingApprovedReminder(null);
          return;
        }

        const candidates = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .filter((item) => !acknowledgedApprovedUploadIds.has(item.id))
          .sort((a, b) => {
            const left = resolveTimestamp(b.reviewDecisionAt) || resolveTimestamp(b.approvedAt) || resolveTimestamp(b.createdAt);
            const right = resolveTimestamp(a.reviewDecisionAt) || resolveTimestamp(a.approvedAt) || resolveTimestamp(a.createdAt);
            return left - right;
          });

        if (!candidates.length) {
          setPendingApprovedReminder(null);
          return;
        }

        let openCandidate = null;
        for (const item of candidates) {
          const postSnap = await getDoc(doc(db, 'posts', item.id));
          if (!postSnap.exists()) {
            openCandidate = item;
            break;
          }
        }

        if (!active || !openCandidate) {
          setPendingApprovedReminder(null);
          return;
        }

        setPendingApprovedReminder({
          uploadId: openCandidate.id,
          count: candidates.length,
        });
      } catch (error) {
        if (!active) return;
        setPendingApprovedReminder(null);
      }
    };

    loadPendingApprovedUpload();
    return () => {
      active = false;
    };
  }, [acknowledgedApprovedUploadIds, authReady, authUser?.uid, profile?.uid]);

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
  const requiresEmailVerification = verificationGateState.hasUser
    && verificationGateState.hasPasswordProvider
    && !verificationGateState.emailVerified;

  useEffect(() => {
    if (!authReady || !authUser?.uid) {
      setAppConfig(null);
      return;
    }
    let active = true;
    getAppConfig()
      .then((config) => {
        if (active) setAppConfig(config);
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.log('[ArtesApp] config/app unavailable', error?.code || error?.message || error);
        }
        if (active) setAppConfig(null);
      });
    return () => {
      active = false;
    };
  }, [authReady, authUser?.uid]);

  const handleTourComplete = (targetView) => {
    setShowTour(false);
    if (appShortcutInfoStorageKey) {
      localStorage.setItem(appShortcutInfoStorageKey, '1');
    }
    if(typeof targetView === 'string') setView(targetView);
  };

  const handleDismissAppShortcutInfo = useCallback(() => {
    if (appShortcutInfoStorageKey) {
      localStorage.setItem(appShortcutInfoStorageKey, '1');
    }
    setAppShortcutInfoMode(null);
  }, [appShortcutInfoStorageKey]);

  const handleCloseAppShortcutInfoSettings = useCallback(() => {
    setAppShortcutInfoMode(null);
  }, []);

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
    if (!authReady || !authUser?.uid) {
      throw new Error('Je sessie is verlopen. Log opnieuw in en probeer het nogmaals.');
    }

    const finalProfile = {
      uid: authUser?.uid,
      displayName: profileData.displayName || 'Nieuwe Maker',
      bio: profileData.bio,
      roles,
      themes: Array.isArray(profileData.themes) ? profileData.themes : [],
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authUser?.uid || 'artes'}`,
      linkedAgencyName: profileData.linkedAgencyName,
      linkedCompanyName: profileData.linkedCompanyName,
      linkedAgencyId: profileData.linkedAgencyId || null,
      linkedCompanyId: profileData.linkedCompanyId || null,
      onboardingComplete: true,
      onboardingStep: 5,
      onboardingCompletedAt: serverTimestamp(),
      preferences: {
        ...profileData.preferences,
        triggerVisibility: normalizeTriggerPreferences(profileData.preferences?.triggerVisibility),
        theme: profileData.preferences?.theme || 'light',
      },
    };
    await updateUserProfile(authUser.uid, finalProfile);

    // Create support thread for the user after onboarding
    try {
      await ensureSupportThreadExists(authUser.uid, authUser);
      if (import.meta.env.DEV) {
        console.log('[ArtesApp] Created support thread after onboarding');
      }
    } catch (error) {
      console.error('[ArtesApp] Error creating support thread:', error);
      // Don't block onboarding if thread creation fails
    }

    const normalized = normalizeProfileData(finalProfile, authUser?.uid);
    setProfile(normalized);
    setDarkMode(finalProfile?.preferences?.theme === 'dark');
    setView('gallery');
    setShowTour(true);
    setAppShortcutInfoMode(null);
  };

  useEffect(() => {
    if (!authReady || !authUser?.uid || !profile || !hasCompletedOnboarding(profile) || showTour) return;
    if (!appShortcutInfoStorageKey) return;
    const dismissed = localStorage.getItem(appShortcutInfoStorageKey) === '1';
    if (!dismissed) {
      setAppShortcutInfoMode('popup');
    }
  }, [authReady, authUser?.uid, profile, showTour, appShortcutInfoStorageKey]);

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
      setVerificationGateState(buildVerificationGateState(refreshed));
      if (!refreshed?.emailVerified) {
        setVerificationNote('Je email is nog niet geverifieerd.');
        return;
      }
      const profileData = await ensureUserProfile(refreshed);
      const normalized = normalizeProfileData(profileData, refreshed?.uid);
      setProfile(normalized);
      const onboardingComplete = hasCompletedOnboarding(profileData);
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
    setVerificationGateState(buildVerificationGateState(null));
    setView('login');
  };

  const handleSettingsLogout = async () => {
    await firebaseLogout();
    setProfile(null);
    setAuthUser(null);
    setUser(null);
    setVerificationGateState(buildVerificationGateState(null));
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
          postDraft: moderationModal?.metadata?.postDraft || null,
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

  const [fullProfileFanBusy, setFullProfileFanBusy] = useState(false);
  const [fullProfileFanError, setFullProfileFanError] = useState('');
  const fullProfileTargetUid = useMemo(
    () => (view.startsWith('profile_') ? view.split('_')[1] : null),
    [view],
  );
  const fullProfileIsOwn = Boolean(fullProfileTargetUid && user?.uid && fullProfileTargetUid === user.uid);
  const fullProfileIsFan = Boolean(fullProfileTargetUid && followingIds.has(fullProfileTargetUid));

  useEffect(() => {
    setFullProfileFanError('');
    setFullProfileFanBusy(false);
  }, [fullProfileTargetUid]);

  const galleryTriggerVisibility = profile?.preferences?.triggerVisibility || normalizeTriggerPreferences();
  const galleryPosts = useMemo(() => {
    if (!authUser?.uid) return [];
    return posts
      .filter((post) => getPostContentPreference(post, galleryTriggerVisibility) !== 'hideFeed')
      .filter((post) => {
        const authorId = post?.authorId;
        if (!authorId) return false;
        return authorId === authUser.uid || followingIds.has(authorId);
      });
  }, [authUser?.uid, followingIds, galleryTriggerVisibility, posts]);

  const handleRevealSensitivePost = useCallback((postId) => {
    setRevealedSensitivePostsById((prev) => ({ ...prev, [postId]: true }));
  }, []);

  const handleOpenPost = useCallback((post) => {
    if (!post) return;
    if (getPostContentPreference(post, galleryTriggerVisibility) === 'hideFeed') {
      setToastMessage('Deze post is verborgen op basis van je trigger voorkeuren.');
      return;
    }
    setSelectedPost(post);
  }, [galleryTriggerVisibility]);

  useEffect(() => {
    if (!selectedPost) return;
    if (getPostContentPreference(selectedPost, galleryTriggerVisibility) === 'hideFeed') {
      setSelectedPost(null);
    }
  }, [galleryTriggerVisibility, selectedPost]);

  const handleFullProfileFanToggle = useCallback(async () => {
    if (!authUser?.uid || !fullProfileTargetUid || fullProfileIsOwn || fullProfileFanBusy) return;
    const nextFan = !followingIds.has(fullProfileTargetUid);
    setFullProfileFanError('');
    setFullProfileFanBusy(true);
    setFollowingIds((prev) => {
      const next = new Set(prev);
      if (nextFan) next.add(fullProfileTargetUid);
      else next.delete(fullProfileTargetUid);
      return next;
    });
    try {
      await setFanStatus(fullProfileTargetUid, nextFan);
    } catch (error) {
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (nextFan) next.delete(fullProfileTargetUid);
        else next.add(fullProfileTargetUid);
        return next;
      });
      setFullProfileFanError(error?.message || 'Kon fanstatus niet opslaan. Probeer opnieuw.');
    } finally {
      setFullProfileFanBusy(false);
    }
  }, [authUser?.uid, followingIds, fullProfileFanBusy, fullProfileIsOwn, fullProfileTargetUid]);

  const handleOpenDiscover = useCallback(() => {
    setView('discover');
  }, []);


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
        

        {/* Nav visible if profile loaded */}
        {profile && !onboardingLocked && (
          <NavBar 
             view={view} 
             setView={setView} 
             onOpenSettings={() => setShowSettingsModal(true)}
             showModerationDot={hasNewModerationWork}
          />
        )}

        <main className="h-full overflow-y-auto no-scrollbar pb-24 pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-16 scroll-smooth">
          {(view === 'loading' || profileLoading) && (
            <div className="h-full flex items-center justify-center">
              <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          )}
          
          {!profileLoading && view === 'login' && (
            <LoginScreen
              setView={setView}
              onLogin={handleLogin}
              error={authError}
              loading={authPending}
              authUser={authUser}
              appConfig={appConfig}
              onDevConfigLoaded={setAppConfig}
              functionsBase={functionsBase}
            />
          )}

          {!profileLoading && view === 'claim' && (
            <ClaimInvitePage
              token={claimInviteToken}
              authUser={authUser}
              userProfile={profile}
              functionsBase={functionsBase}
              setView={setView}
              authReady={authReady}
              logListenerStart={logListenerStart}
              handleListenerError={handleListenerError}
            />
          )}

          {!profileLoading && view === 'claimEmail' && (
            <ClaimEmailPage
              authUser={authUser}
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
              authReady={authReady}
              view={view}
              profileLoading={profileLoading}
              appConfig={appConfig}
            />
          )}
          
          {!profileLoading && view === 'gallery' && (
            <Gallery 
              posts={galleryPosts} 
              users={users}
              onUserClick={setQuickProfileId}
              onShadowClick={setShadowProfile}
              onPostClick={handleOpenPost}
              onChallengeClick={() => setView('challenge_timeline')}
              profile={profile}
              currentUser={authUser}
              followingLoaded={followingLoaded}
              onOpenDiscover={handleOpenDiscover}
              revealedSensitivePostsById={revealedSensitivePostsById}
              onRevealSensitivePost={handleRevealSensitivePost}
            />
          )}

          {!profileLoading && view === 'moderation' && (
            <ModerationPortal
              moderationApiBase={moderationApiBase}
              functionsBase={functionsBase}
              authUser={authUser}
              isModerator={moderatorAccess}
              authReady={authReady}
              isModeratorClient={isModeratorClient}
              profileAgeVerified={profileAgeVerified}
              profileAgeVerifiedStrict={profileAgeVerifiedStrict}
              profileIsAdult={profile?.isAdult === true}
              logListenerStart={logListenerStart}
              handleListenerError={handleListenerError}
              moderationModal={moderationModal}
              moderationActionPending={moderationActionPending}
              onCloseModerationModal={() => handleModerationAction('dismiss')}
              onResumeApprovedUpload={handleResumeApprovedUpload}
              communityConfig={communityConfig}
              challengeConfig={challengeConfig}
              configLoading={configLoading}
              onSaveCommunityConfig={handleSaveCommunityConfig}
              users={users}
            />
          )}

          {!profileLoading && view === 'discover' && (
            <Discover
              users={users}
              posts={posts}
              profile={profile}
              currentUserId={authUser?.uid}
              onUserClick={setQuickProfileId}
              onPostClick={handleOpenPost}
              setView={setView}
              revealedSensitivePostsById={revealedSensitivePostsById}
              onRevealSensitivePost={handleRevealSensitivePost}
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
                  onResumeApprovedUpload={handleResumeApprovedUpload}
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
              onPostClick={handleOpenPost}
              challenge={challengeConfig}
              triggerVisibility={galleryTriggerVisibility}
              revealedSensitivePostsById={revealedSensitivePostsById}
              onRevealSensitivePost={handleRevealSensitivePost}
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
                currentPublicProfile={currentPublicProfile}
                communities={communityConfig.communities}
                initialTopicTitle={initialTopicTitle}
                authReady={authReady}
                logListenerStart={logListenerStart}
                handleListenerError={handleListenerError}
              />
            );
          })()}

          {/* Wrapper logic for viewing profiles */}
          {!profileLoading && view === 'profile' && (
            <ImmersiveProfile 
              profile={profile} 
              isOwn={true} 
              posts={getProfileVisiblePosts(posts, user?.uid, profile?.contributorId)}
              onOpenSettings={() => setShowEditProfile(true)}
              onPostClick={handleOpenPost}
              allUsers={users}
              onLinkedProfileClick={(uid) => setView(`profile_${uid}`)}
              onChallengeClick={() => setView('challenge_timeline')}
              triggerVisibility={profile?.preferences?.triggerVisibility || normalizeTriggerPreferences()}
              revealedSensitivePostsById={revealedSensitivePostsById}
              onRevealSensitivePost={handleRevealSensitivePost}
            />
          )}
          
          {!profileLoading && view.startsWith('profile_') && (
            <FetchedProfile 
               userId={view.split('_')[1]} 
               posts={posts}
               onPostClick={handleOpenPost}
               allUsers={users}
               setView={setView}
               currentUserId={user?.uid}
               currentProfile={profile}
               triggerVisibility={profile?.preferences?.triggerVisibility || normalizeTriggerPreferences()}
               isFan={fullProfileIsFan}
               fanBusy={fullProfileFanBusy}
               fanError={fullProfileFanError}
               onToggleFan={handleFullProfileFanToggle}
               revealedSensitivePostsById={revealedSensitivePostsById}
               onRevealSensitivePost={handleRevealSensitivePost}
            />
          )}
        </main>

        {/* FAB */}
        {profile && view !== 'onboarding' && view !== 'login' && canUpload && (
           <div className="fixed bottom-6 right-6 z-40">
             <button onClick={() => handleOpenUploadModal()} className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-xl shadow-blue-600/30 flex items-center justify-center transition-colors md:w-14 md:h-14">
               <Plus className="w-6 h-6 md:w-7 md:h-7" />
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
            functionsBase={functionsBase}
            moderationApiBase={moderationApiBase}
            resumeUploadId={uploadContext.resumeUploadId}
          />
        )}
        {showSettingsModal && (
          <SettingsModal
            onClose={() => setShowSettingsModal(false)}
            moderatorAccess={moderatorAccess}
            onOpenModeration={openModerationPortal}
            onOpenSupport={() => {
              setShowSettingsModal(false);
              setView('support');
            }}
            onOpenAppShortcutInfo={() => {
              setShowSettingsModal(false);
              setAppShortcutInfoMode('settings');
            }}
            onOpenVouchRequests={() => {
              setShowSettingsModal(false);
              setView('vouch');
            }}
            darkMode={darkMode}
            onToggleDark={handleToggleDarkMode}
            onLogout={handleSettingsLogout}
            showModerationDot={hasNewModerationWork}
          />
        )}
        {showEditProfile && (
          <EditProfileModal
            onClose={() => setShowEditProfile(false)}
            profile={profile}
            user={user}
            posts={posts}
            users={users}
            onOpenQuickProfile={() => setQuickProfileId(user?.uid || null)}
            onProfileUpdated={(nextProfile) => {
              setProfile(nextProfile);
              setUsers((prev) => (Array.isArray(prev)
                ? prev.map((entry) => (entry?.uid === nextProfile?.uid
                  ? normalizeUserForCollections({ ...entry, ...nextProfile })
                  : entry))
                : prev));
            }}
          />
        )}
        {showTour && <WelcomeTour onClose={handleTourComplete} setView={setView} />}
        {appShortcutInfoMode === 'popup' && !showTour && (
          <AppShortcutInfoModal onClose={handleDismissAppShortcutInfo} primaryLabel="Niet meer tonen" secondaryLabel="Bekijk later" />
        )}
        {appShortcutInfoMode === 'settings' && (
          <AppShortcutInfoModal onClose={handleCloseAppShortcutInfoSettings} primaryLabel="Sluiten" />
        )}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
            {toastMessage}
          </div>
        )}

      {showActiveAppAnnouncement && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-xl border border-slate-200 dark:border-slate-700">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-lg dark:text-white">{activeAppAnnouncement.title || 'App update'}</h3>
              <button onClick={handleDismissAnnouncement} disabled={announcementDismissPending} className="text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{activeAppAnnouncement.body || ''}</p>
            </div>
            <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <Button onClick={handleDismissAnnouncement} disabled={announcementDismissPending}>
                {announcementDismissPending ? 'Opslaan...' : 'Sluiten'}
              </Button>
            </div>
          </div>
        </div>
      )}
        {pendingApprovedReminder && (
          <div className="fixed top-5 right-5 z-[75] w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-blue-200 bg-white/95 dark:bg-slate-900/95 dark:border-slate-700 shadow-2xl p-4">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Je goedgekeurde upload wacht nog op publicatie.</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Open de chat met Artes Moderatie en kies “Open in editor” om je post af te ronden.
            </p>
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-600"
                onClick={() => setPendingApprovedReminder(null)}
              >
                Sluiten
              </button>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-full bg-blue-600 text-white"
                onClick={handlePendingReminderToChat}
              >
                Naar chat
              </button>
            </div>
          </div>
        )}
        
        {quickProfileId && (
          <UserPreviewModal
            userId={quickProfileId}
            onClose={() => setQuickProfileId(null)}
            onFullProfile={() => { setView(`profile_${quickProfileId}`); setQuickProfileId(null); }}
            posts={posts}
            allUsers={users}
            currentUserId={user?.uid}
            currentProfile={profile}
            triggerVisibility={galleryTriggerVisibility}
            revealedSensitivePostsById={revealedSensitivePostsById}
            onRevealSensitivePost={handleRevealSensitivePost}
          />
        )}
        {selectedPost && (
          <PhotoDetailModal
            post={selectedPost}
            onClose={() => setSelectedPost(null)}
            currentUser={authUser}
            authUser={authUser}
            currentPublicProfile={currentPublicProfile}
            moderationApiBase={moderationApiBase}
            onChallengeClick={() => setView('challenge_timeline')}
            onUserClick={setQuickProfileId}
            onShadowClick={setShadowProfile}
            contentPreference={getPostContentPreference(selectedPost, galleryTriggerVisibility)}
            shouldCover={shouldCoverPost(selectedPost, galleryTriggerVisibility, revealedSensitivePostsById)}
            onRevealSensitivePost={handleRevealSensitivePost}
          />
        )}
        {shadowProfile && (
          <ShadowProfileModal
            name={shadowProfile.name}
            contributorId={shadowProfile.contributorId}
            posts={posts}
            onClose={() => setShadowProfile(null)}
            onPostClick={handleOpenPost}
            triggerVisibility={galleryTriggerVisibility}
            revealedSensitivePostsById={revealedSensitivePostsById}
            onRevealSensitivePost={handleRevealSensitivePost}
            authUser={authUser}
            userProfile={userProfile}
            functionsBase={functionsBase}
            setView={setView}
            authReady={authReady}
            logListenerStart={logListenerStart}
            handleListenerError={handleListenerError}
          />
        )}

      </div>
    </div>
  );
}

// --- SUB COMPONENTS ---

function LoginScreen({ setView, onLogin, error, loading, authUser, appConfig, onDevConfigLoaded, functionsBase }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState(null);
  const enableEmail = import.meta.env.VITE_ENABLE_EMAIL_SIGNIN !== 'false';
  const enableGoogle = import.meta.env.VITE_ENABLE_GOOGLE_SIGNIN !== 'false';
  const enableApple = import.meta.env.VITE_ENABLE_APPLE_SIGNIN === 'true';
  const auth = getFirebaseAuthInstance();
  const showCodexDevLogin = import.meta.env.DEV && debugAllowed() && Boolean(functionsBase);

  const handleCodexDevLogin = async () => {
    try {
      setLocalError(null);
      if (!functionsBase) {
        setLocalError('Codex dev login is niet beschikbaar: VITE_FUNCTIONS_BASE_URL ontbreekt.');
        return;
      }
      const response = await fetch(`${functionsBase}/createDevCodexToken`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.token) {
        throw new Error(data?.error || 'Codex dev login mislukt.');
      }
      await signInWithCustomToken(auth, data.token);
      const refreshedConfig = await getAppConfig({ forceRefresh: true });
      onDevConfigLoaded?.(refreshedConfig || null);
      console.log('Codex custom-token login successful');
    } catch (err) {
      setLocalError(err?.message || 'Codex dev login mislukt.');
    }
  };
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
       <div className="max-w-md w-full text-center">
          <div className="-mt-4 mb-4 flex justify-center">
            <AppLogo size={140} alt="Artes" className="mx-auto" />
          </div>
          <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-700">
             <div className="space-y-4">
               {showCodexDevLogin && !authUser && (
                 <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                   Je bent niet ingelogd. Gebruik Codex Dev login (vast) voor ontwikkeltoegang.
                 </div>
               )}
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
              {showCodexDevLogin && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleCodexDevLogin}
                    className="w-full border border-dashed border-blue-300 text-blue-700 dark:border-blue-500/60 dark:text-blue-200 rounded-xl py-3 text-sm font-semibold hover:bg-blue-50 dark:hover:bg-blue-500/10 transition"
                  >
                    Codex Dev login (vast)
                  </button>
                </div>
              )}
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

function Onboarding({ setView, users, onSignup, onCompleteProfile, onDeclineDidit, authUser, authError, profile, functionsBase, authReady, view, profileLoading, appConfig }) {
    const onboardingQueryParams = useMemo(() => {
      if (typeof window === 'undefined') return new URLSearchParams();
      return new URLSearchParams(window.location.search || '');
    }, []);
    const [step, setStep] = useState(() => computeOnboardingStep(profile, authUser, onboardingQueryParams, authReady) ?? 1);
    const [roles, setRoles] = useState([]);
    const MATCH_STEP = 1.5;
    const [profileData, setProfileData] = useState(() => ({
       displayName: profile?.displayName || '',
       bio: profile?.bio || '',
       insta: '',
       linkedAgencyName: profile?.linkedAgencyName || '',
       linkedCompanyName: profile?.linkedCompanyName || '',
       linkedAgencyId: profile?.linkedAgencyId || null,
       linkedCompanyId: profile?.linkedCompanyId || null,
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
    const [diditStatus, setDiditStatus] = useState(null);
    const [diditUiState, setDiditUiState] = useState('idle');
    const DIDIT_SAFE_ERROR_TITLE = 'Verificatiestatus kon niet worden gecontroleerd';
    const DIDIT_SAFE_ERROR_MESSAGE = 'We konden je verificatiesessie niet goed controleren. Probeer je status opnieuw te controleren. Blijft dit gebeuren? Mail naar admin@artes.app.';
    const normalizeCallableErrorCode = (code) => String(code || '').replace(/^functions\//, '');
    const isDiditSessionRefreshError = (errorCode) => ['permission-denied', 'failed-precondition', 'invalid-argument'].includes(normalizeCallableErrorCode(errorCode));
    const [diditSessionId, setDiditSessionId] = useState(null);
    const [diditRejectReason, setDiditRejectReason] = useState('');
    const [diditIsAdult, setDiditIsAdult] = useState(null);
    const [diditRefreshAttempted, setDiditRefreshAttempted] = useState(false);
    const [diditRefreshAttempts, setDiditRefreshAttempts] = useState(0);
    const [diditDebugResult, setDiditDebugResult] = useState('');
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
    const usesPasswordProvider = authUser?.providerData?.some((provider) => provider?.providerId === 'password')
      || profile?.authProvider === 'password';
    const requiresEmailVerificationForIdv = Boolean(authUser?.uid && usesPasswordProvider && !authUser?.emailVerified);
    const [isCodexDevAuth, setIsCodexDevAuth] = useState(false);
    useEffect(() => {
      let active = true;
      const resolveCodexDevAuth = async () => {
        if (!import.meta.env.DEV || !authUser?.uid) {
          if (active) setIsCodexDevAuth(false);
          return;
        }
        const claims = await readTokenClaims(authUser);
        if (!active) return;
        setIsCodexDevAuth(isCodexDevIdentity({ claims, uid: authUser.uid }));
      };
      resolveCodexDevAuth();
      return () => {
        active = false;
      };
    }, [authUser]);
    const allowDevSkipIdv = Boolean(import.meta.env.DEV && isCodexDevAuth && appConfig?.allowDevSkipIdv === true);
    const [emailVerificationPending, setEmailVerificationPending] = useState(false);
    const [emailVerificationMessage, setEmailVerificationMessage] = useState(null);
    const normalizeDisplayName = (value) => String(value || '').trim().toLowerCase();
    const resolvedPendingClaimContributorId = pendingClaimContributorId || profile?.pendingClaimContributorId || null;
    const resolvedPendingClaimContributorName = pendingClaimContributorName || profile?.pendingClaimContributorName || null;
    const profileIdvRef = useMemo(() => {
      if (!authUser?.uid) return null;
      const db = getFirebaseDbInstance();
      return doc(db, 'users', authUser.uid, 'idv', 'status');
    }, [authUser?.uid]);
    const diditReturnContext = useMemo(() => ({
      shouldHandle: onboardingQueryParams.get('diditReturn') === '1',
      sessionIdFromUrl: onboardingQueryParams.get('sessionId') || null,
    }), [onboardingQueryParams]);
    const shouldHandleDiditReturn = diditReturnContext.shouldHandle;

    useEffect(() => {
      if (!import.meta.env.DEV) return undefined;
      const snapshot = {
        traceId: DIAG_TRACE_ID,
        authReady,
        authUid: authUser?.uid || null,
        view,
        profileLoading,
        profileFields: {
          onboardingStep: profile?.onboardingStep ?? null,
          onboardingComplete: profile?.onboardingComplete ?? null,
          ageVerified: profile?.ageVerified ?? null,
          isAdult: profile?.isAdult ?? null,
          diditStatus: profile?.diditStatus ?? null,
          idvStatus: profile?.idv?.status ?? null,
        },
      };
      devLog('[onboarding:lifecycle] mount', snapshot);
      return () => {
        devLog('[onboarding:lifecycle] unmount', snapshot);
      };
    }, []);

    useEffect(() => {
      if (!accountCreated && step > 1) {
        if (import.meta.env.DEV) {
          devLog('[onboarding:step-effect] accountCreated-guard', {
            traceId: DIAG_TRACE_ID,
            previousStep: step,
            nextStep: 1,
            accountCreated,
          });
        }
        setStep(1);
      }
    }, [accountCreated, step]);

    useEffect(() => {
      if (authUser && !accountCreated) {
        setAccountCreated(true);
      }
    }, [authUser, accountCreated]);

    useEffect(() => {
      const resolvedStep = computeOnboardingStep(profile, authUser, onboardingQueryParams, authReady);
      if (!resolvedStep) return;
      setStep((prevStep) => {
        if (prevStep === MATCH_STEP && resolvedStep === 2) {
          if (import.meta.env.DEV) {
            devLog('[onboarding:step-effect] resolved-step-sync', {
              traceId: DIAG_TRACE_ID,
              effectRun: 'match-step-hold',
              previousStep: prevStep,
              nextStep: prevStep,
              resolvedStep,
            });
          }
          return prevStep;
        }
        if (resolvedStep <= prevStep) {
          if (import.meta.env.DEV) {
            devLog('[onboarding:step-effect] resolved-step-sync', {
              traceId: DIAG_TRACE_ID,
              effectRun: 'non-increasing-hold',
              previousStep: prevStep,
              nextStep: prevStep,
              resolvedStep,
            });
          }
          return prevStep;
        }
        if (import.meta.env.DEV) {
          devLog('[onboarding:step-effect] resolved-step-sync', {
            traceId: DIAG_TRACE_ID,
            effectRun: 'advance-step',
            previousStep: prevStep,
            nextStep: resolvedStep,
            resolvedStep,
          });
        }
        return resolvedStep;
      });
    }, [authReady, authUser, onboardingQueryParams, profile]);

    useEffect(() => {
      if (step !== 2) return;
      setDiditUiState('idle');
      setDiditError(null);
      setDiditDebugResult('');
    }, [step]);

    useEffect(() => {
      if (!authUser) return;
      setEmail(authUser.email || '');
      setProfileData((prev) => {
        const resolvedDisplayName = pickPreferredDisplayName(prev?.displayName, profile?.displayName, authUser.displayName);
        if (resolvedDisplayName === (prev?.displayName || '')) return prev;
        return { ...prev, displayName: resolvedDisplayName };
      });
    }, [authUser, profile?.displayName]);

    useEffect(() => {
      if (!isGoogleUser || !authUser?.uid || syncedGoogleProfile) return;
      setAccountCreated(true);
      setStep((prev) => {
        const nextStep = prev < 2 ? 2 : prev;
        if (import.meta.env.DEV) {
          devLog('[onboarding:step-effect] google-sync', {
            traceId: DIAG_TRACE_ID,
            previousStep: prev,
            nextStep,
            effectRun: 'google-profile-sync',
          });
        }
        return nextStep;
      });
      const existingAppDisplayName = String(profile?.displayName || '').trim();
      const googleDisplayName = String(authUser.displayName || '').trim();
      const googleSyncPayload = {
        onboardingStep: 2,
        onboardingComplete: false,
        email: authUser.email ?? null,
        authProvider: 'google.com',
      };

      // Google is fallback only and must not overwrite an existing app profile displayName.
      if (!existingAppDisplayName && googleDisplayName) {
        googleSyncPayload.displayName = googleDisplayName;
      }

      updateUserProfile(authUser.uid, googleSyncPayload).catch((e) => console.error('Failed to sync Google profile', e));
      setSyncedGoogleProfile(true);
    }, [isGoogleUser, authUser?.uid, authUser?.displayName, authUser?.email, profile?.displayName, syncedGoogleProfile]);

    useEffect(() => {
      if (!profile?.pendingClaimContributorId) return;
      setPendingClaimContributorId(profile.pendingClaimContributorId);
    }, [profile?.pendingClaimContributorId]);

    useEffect(() => {
      if (!profile?.pendingClaimContributorName) return;
      setPendingClaimContributorName(profile.pendingClaimContributorName);
    }, [profile?.pendingClaimContributorName]);

    useEffect(() => {
      const resolvedAgencyName = resolveLinkedProfileName(profileData.linkedAgencyId, profileData.linkedAgencyName, users);
      const resolvedCompanyName = resolveLinkedProfileName(profileData.linkedCompanyId, profileData.linkedCompanyName, users);
      if (resolvedAgencyName !== profileData.linkedAgencyName || resolvedCompanyName !== profileData.linkedCompanyName) {
        setProfileData((prev) => ({
          ...prev,
          linkedAgencyName: resolvedAgencyName,
          linkedCompanyName: resolvedCompanyName,
        }));
      }
    }, [
      users,
      profileData.linkedAgencyId,
      profileData.linkedCompanyId,
      profileData.linkedAgencyName,
      profileData.linkedCompanyName,
    ]);

    const clearDiditReturnParam = useCallback(() => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (url.searchParams.get('diditReturn') !== '1') return;
      url.searchParams.delete('diditReturn');
      url.searchParams.delete('sessionId');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }, []);

    useEffect(() => {
      if (!authUser?.uid || !profileIdvRef || allowDevSkipIdv) return;
      if (step !== 2) return;
      if (!authReady) return;
      if (allowDevSkipIdv) return;
      if (import.meta.env.DEV) {
        console.log('[Onboarding] Listening for Didit status updates');
      }
      const unsubscribe = onSnapshot(
        profileIdvRef,
        (snap) => {
          if (!snap.exists()) {
            setDiditStatus(null);
            setDiditSessionId(null);
            setDiditIsAdult(null);
            setDiditRejectReason('');
            setDiditPending(false);
            setDiditUiState('no_session');
            return;
          }

          const data = snap.data() || {};
          const status = normalizeDiditStatus(data.status);
          const isAdult = typeof data.isAdult === 'boolean' ? data.isAdult : null;
          const hasSession = Boolean(data.sessionId);
          setDiditStatus(status);
          setDiditSessionId(data.sessionId || null);
          setDiditIsAdult(isAdult);
          setDiditRejectReason(data.reason || '');
          if (import.meta.env.DEV) {
            console.log('[Onboarding] Didit status update', data);
          }

          const isApproved = DIDIT_APPROVED_STATUSES.includes(status || '');
          const isRejected = DIDIT_REJECTED_STATUSES.includes(status || '');

          const adultResolved = isAdult === true || profile?.isAdult === true;

          if (isApproved && adultResolved) {
            if (requiresEmailVerificationForIdv) return;
            setDiditPending(false);
            setDiditError(null);
            setDiditUiState('idle');
            clearDiditReturnParam();
            setStep((prevStep) => Math.max(prevStep, 3));
            return;
          }

          if (!hasSession && !status) {
            setDiditPending(false);
            setDiditUiState('no_session');
            return;
          }

          if (isRejected || (isApproved && isAdult === false)) {
            setDiditPending(false);
            setDiditUiState(isApproved && isAdult === false ? 'underage' : 'rejected');
            return;
          }

          if (isApproved && isAdult == null) {
            setDiditPending(false);
            setDiditUiState('verified_missing_age');
            if (import.meta.env.DEV) {
              console.log('[Onboarding] Verified status without adult flag', {
                status,
                isAdult,
                age: data.age ?? null,
                sessionId: data.sessionId || null,
              });
            }
            return;
          }

          if (status === 'in_review') {
            setDiditPending(false);
            setDiditUiState('in_review');
            return;
          }

          if (status === 'started' || status === 'in_progress' || status === 'unknown' || !status) {
            setDiditPending(false);
            setDiditUiState(hasSession ? 'pending' : 'no_session');
            return;
          }
          if (status === 'expired') {
            setDiditPending(false);
            setDiditUiState('expired');
            return;
          }
          if (status === 'abandoned') {
            setDiditPending(false);
            setDiditUiState('abandoned');
          }
        },
        (err) => {
          setDiditPending(false);
          const normalizedListenerErrorCode = normalizeCallableErrorCode(err?.code);
          if (normalizedListenerErrorCode === 'permission-denied' || normalizedListenerErrorCode === 'failed-precondition') {
            if (import.meta.env.DEV) {
              console.log('[Onboarding] Didit status listener skipped', normalizedListenerErrorCode || err?.code);
            }
            return;
          }
          setDiditError(err?.message || 'Kon de verificatiestatus niet laden.');
        },
      );
      return () => unsubscribe();
    }, [allowDevSkipIdv, authReady, authUser?.uid, clearDiditReturnParam, profile?.isAdult, profileIdvRef, requiresEmailVerificationForIdv, step]);

    const handleRefreshDiditStatus = useCallback(async () => {
      if (!authUser?.uid || !profileIdvRef || allowDevSkipIdv) return;
      try {
        setDiditPending(true);
        setDiditError(null);
        if (import.meta.env.DEV) {
          console.log('[Onboarding] Refreshing Didit session after return', {
            diditReturn: shouldHandleDiditReturn,
            hasSession: Boolean(diditSessionId || diditReturnContext.sessionIdFromUrl),
          });
        }

        let resolvedSessionId = null;
        let hasStoredSessionId = false;
        const currentSnap = await getDoc(profileIdvRef);
        if (currentSnap.exists()) {
          const currentData = currentSnap.data() || {};
          resolvedSessionId = currentData.sessionId || null;
          hasStoredSessionId = Boolean(currentData.sessionId);
          if (typeof currentData.isAdult === 'boolean') setDiditIsAdult(currentData.isAdult);
          if (currentData.status) setDiditStatus(normalizeDiditStatus(currentData.status));
          setDiditRejectReason(currentData.reason || '');
        }

        if (!resolvedSessionId) {
          resolvedSessionId = diditSessionId || diditReturnContext.sessionIdFromUrl || null;
        }

        await refreshDiditSession(hasStoredSessionId ? null : (resolvedSessionId || null));
      } catch (refreshError) {
        setDiditUiState('error');
        if (isDiditSessionRefreshError(refreshError?.code)) {
          setDiditError(DIDIT_SAFE_ERROR_MESSAGE);
        } else {
          setDiditError(refreshError?.message || 'Technische fout bij controleren van Didit. Probeer opnieuw of neem contact op met support.');
        }
      } finally {
        setDiditRefreshAttempts((previous) => previous + 1);
        setDiditRefreshAttempted(true);
        clearDiditReturnParam();
        setDiditPending(false);
      }
    }, [allowDevSkipIdv, authUser?.uid, clearDiditReturnParam, diditReturnContext.sessionIdFromUrl, diditSessionId, profileIdvRef, shouldHandleDiditReturn]);

    const handleDebugRefreshDiditStatus = useCallback(async () => {
      if (!import.meta.env.DEV || !authUser?.uid) return;
      setDiditDebugResult('');
      try {
        const db = getFirebaseDbInstance();
        const statusRef = doc(db, 'users', authUser.uid, 'idv', 'status');
        const statusSnap = await getDoc(statusRef);
        const sessionId = statusSnap.exists() ? statusSnap.data()?.sessionId || null : null;

        if (!sessionId) {
          setDiditDebugResult('DEBUG: geen sessionId gevonden in users/{uid}/idv/status.');
          return;
        }

        const functions = getFirebaseFunctionsInstance();
        const refreshDiditCallable = httpsCallable(functions, 'refreshDiditSession');
        const response = await refreshDiditCallable({});
        const payload = response?.data ?? response;
        setDiditDebugResult(`DEBUG result: ${JSON.stringify(payload)}`);
        console.log('[Onboarding][DEBUG] refreshDiditSession response', payload);
      } catch (debugError) {
        const message = debugError?.message || 'Onbekende fout';
        setDiditDebugResult(`DEBUG error: ${message}`);
        console.error('[Onboarding][DEBUG] refreshDiditSession error', debugError);
      }
    }, [authUser?.uid]);

    useEffect(() => {
      if (!authReady || !authUser?.uid || !shouldHandleDiditReturn || diditRefreshAttempted || allowDevSkipIdv) return;
      const hasKnownSession = Boolean(diditSessionId || diditReturnContext.sessionIdFromUrl || profile?.idv?.sessionId || profile?.didit?.status);
      if (!hasKnownSession) return;
      handleRefreshDiditStatus();
    }, [
      authReady,
      authUser?.uid,
      diditRefreshAttempted,
      diditReturnContext.sessionIdFromUrl,
      diditSessionId,
      handleRefreshDiditStatus,
      profile?.idv?.sessionId,
      shouldHandleDiditReturn,
      allowDevSkipIdv,
    ]);

    const fetchContributorMatches = async (displayName) => {
      if (!authReady) return [];
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

    const persistedDiditStatus = normalizeDiditStatus(
      profile?.didit?.status
      || profile?.idv?.status
      || profile?.diditStatus
      || diditStatus
    );
    const hasDiditStatus = Boolean(persistedDiditStatus);
    const hasRefreshableDiditSession = Boolean(diditSessionId || profile?.didit?.sessionId || profile?.idv?.sessionId);
    const hasDiditSession = hasDiditStatus || hasRefreshableDiditSession;
    const isRejectedState = diditUiState === 'rejected' || diditUiState === 'underage';
    const canRefreshDidit = hasRefreshableDiditSession && profile?.ageVerified !== true;
    const diditVerificationUrl = profile?.didit?.verificationUrl || profile?.idv?.verificationUrl || null;
    const showSupportActions = isRejectedState || diditUiState === 'error';
    const effectiveDiditState = (() => {
      if (profile?.ageVerified === true || persistedDiditStatus === 'approved') return 'approved';
      if (diditUiState === 'in_review') return 'in_review';
      if (diditUiState === 'rejected' || diditUiState === 'underage') return 'declined';
      if (diditUiState === 'expired') return 'expired';
      if (diditUiState === 'abandoned') return 'abandoned';
      if (diditUiState === 'error') return 'error';
      if (persistedDiditStatus && ['in_review', 'declined', 'expired', 'abandoned', 'error', 'started', 'in_progress', 'not_started'].includes(persistedDiditStatus)) {
        if ((persistedDiditStatus === 'not_started' || persistedDiditStatus === 'started') && hasRefreshableDiditSession) return 'in_progress';
        return persistedDiditStatus;
      }
      if (diditUiState === 'pending' || (hasRefreshableDiditSession && !persistedDiditStatus)) return 'in_progress';
      return 'not_started';
    })();
    const canReopenInProgress = effectiveDiditState === 'in_progress' && Boolean(diditVerificationUrl);


    const handleResendVerificationEmail = useCallback(async () => {
      try {
        setEmailVerificationPending(true);
        setEmailVerificationMessage(null);
        await resendVerificationEmail();
        setEmailVerificationMessage('Verificatiemail opnieuw verstuurd.');
      } catch (verificationError) {
        setEmailVerificationMessage(verificationError?.message || 'Opnieuw versturen is mislukt.');
      } finally {
        setEmailVerificationPending(false);
      }
    }, []);

    const handleRefreshEmailVerification = useCallback(async () => {
      try {
        setEmailVerificationPending(true);
        setEmailVerificationMessage(null);
        const refreshed = await reloadCurrentUser();
        if (!refreshed?.emailVerified) {
          setEmailVerificationMessage('Je email is nog niet geverifieerd.');
          return;
        }
        if (authUser?.uid) {
          await ensureUserProfile(refreshed);
        }
        setEmailVerificationMessage('Email geverifieerd. Je kunt nu door.');
      } catch (verificationError) {
        setEmailVerificationMessage(verificationError?.message || 'Status verversen is mislukt.');
      } finally {
        setEmailVerificationPending(false);
      }
    }, [authUser?.uid]);

    const handleDevSkipDidit = useCallback(async () => {
      if (!authUser?.uid || !allowDevSkipIdv) return;
      setDiditUiState('dev_skipped');
      setDiditError(null);
      await updateUserProfile(authUser.uid, { onboardingStep: 3 });
      setStep(3);
    }, [allowDevSkipIdv, authUser?.uid]);


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
        <h2 className={`text-sm font-bold uppercase mb-1 ${showSupportActions || diditUiState === 'error' ? 'text-red-600' : 'text-blue-600'}`}>Stap 2/5</h2>
        <h1 className="text-3xl font-bold dark:text-white mb-6">
          {diditUiState === 'underage'
            ? 'Niet voldaan aan de leeftijdseis'
            : diditUiState === 'rejected'
              ? 'Verificatie afgewezen'
              : diditUiState === 'error'
                ? 'Status kon niet worden opgehaald'
                : diditUiState === 'verified_missing_age'
                  ? 'Leeftijd nog niet vastgesteld'
                  : diditUiState === 'in_review'
                    ? 'Verificatie wordt gecontroleerd'
                    : 'Veiligheid & Waarden'}
        </h1>
        <div className={`bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-sm border space-y-6 ${(showSupportActions || diditUiState === 'error') ? 'border-red-200 dark:border-red-500/40' : 'dark:border-slate-700'}`}>
           <div className="flex gap-3"><Shield className="text-blue-500"/><p className="text-sm dark:text-slate-300">Bij Artes staan respect en consent centraal.</p></div>
           <div className="flex gap-3"><CheckCircle className="text-green-500"/><p className="text-sm dark:text-slate-300">Identificatie via Didit is verplicht voor veiligheid.</p></div>
           {requiresEmailVerificationForIdv && (
             <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-200">
               <p className="font-semibold mb-1">Verifieer eerst je email</p>
               <p>Accounts met email/wachtwoord moeten emailverificatie afronden vóór stap 2.</p>
               {emailVerificationMessage && <p className="mt-2 text-xs">{emailVerificationMessage}</p>}
               <div className="mt-3 flex flex-col gap-2">
                 <Button className="w-full" onClick={handleResendVerificationEmail} disabled={emailVerificationPending}>
                   Opnieuw verificatiemail sturen
                 </Button>
                 <Button variant="secondary" className="w-full" onClick={handleRefreshEmailVerification} disabled={emailVerificationPending}>
                   Status verversen
                 </Button>
               </div>
             </div>
           )}
           {allowDevSkipIdv && !requiresEmailVerificationForIdv && (
             <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200">
               <p className="font-semibold mb-1">Dev bypass actief</p>
               <p>Didit mag worden overgeslagen omdat config/app.allowDevSkipIdv aan staat.</p>
               <Button variant="secondary" className="w-full mt-3" onClick={handleDevSkipDidit}>
                 Sla Didit over en ga verder
               </Button>
             </div>
           )}
           {(diditUiState === 'pending' || diditUiState === 'in_review' || shouldHandleDiditReturn) && !diditError && (
             <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
               <p className="font-semibold">{diditUiState === 'in_review' ? 'Verificatie wordt gecontroleerd' : 'Verificatie bezig'}</p>
               <p>{diditUiState === 'in_review' ? 'Je verificatie is ontvangen en wordt handmatig gecontroleerd. Dit kan even duren. Je hoeft niets opnieuw te doen. Kom later terug of gebruik Status opnieuw controleren.' : 'Je verificatie is gestart. Rond de stappen bij Didit af. Als je al klaar bent, kun je hieronder je status opnieuw controleren.'}</p>
             </div>
           )}
           {(diditUiState === 'rejected' || diditUiState === 'underage') && (
             <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
               <div className="flex gap-3">
                 <AlertTriangle className="text-red-500" />
                 <p>
                   Reden: <span className="font-semibold">{diditRejectReason || 'Je verificatie is niet goedgekeurd. Neem contact op met support voor hulp.'}</span>
                 </p>
               </div>
             </div>
           )}
           {diditUiState === 'verified_missing_age' && (
             <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
               Didit gaf &quot;verified&quot; terug, maar leeftijd kon nog niet worden vastgesteld. Probeer opnieuw te controleren.
             </div>
           )}
           {diditPending && (
             <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
               <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
               We controleren je verificatiestatus...
             </div>
           )}
           {diditStatus && !diditError && (
             <p className="text-xs text-slate-500 dark:text-slate-400">Status: {diditStatus}</p>
           )}
           {diditError && (
             <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
               <p className="font-semibold">{diditError === DIDIT_SAFE_ERROR_MESSAGE ? DIDIT_SAFE_ERROR_TITLE : 'Status kon niet worden opgehaald'}</p>
               <p>{diditError}</p>
             </div>
           )}
           {diditUiState === 'no_session' && !hasDiditSession && (
             <p className="text-sm text-slate-600 dark:text-slate-300">Nog geen Didit sessie gevonden. Start de verificatie om verder te gaan.</p>
           )}
           {hasDiditStatus && !hasRefreshableDiditSession && profile?.ageVerified !== true && (
             <p className="text-xs text-slate-500 dark:text-slate-400">Status beschikbaar, maar er is geen actieve sessie om te verversen. Start een nieuwe verificatie.</p>
           )}
           <div className="flex flex-col gap-3">
             {['in_progress', 'in_review', 'expired', 'abandoned', 'error'].includes(effectiveDiditState) && canRefreshDidit && (
               <Button onClick={handleRefreshDiditStatus} className="w-full" disabled={diditPending || requiresEmailVerificationForIdv || allowDevSkipIdv}>
                 Status opnieuw controleren
               </Button>
             )}
             {((effectiveDiditState === 'in_progress' && canReopenInProgress) || ['not_started', 'declined', 'expired', 'abandoned'].includes(effectiveDiditState)) && (
               <Button
                 onClick={async () => {
                   if (!authUser?.uid) return;
                   try {
                     setDiditPending(true);
                     setDiditError(null);
                     setDiditUiState('idle');
                     if (effectiveDiditState === 'in_progress' && diditVerificationUrl) {
                       window.location.assign(diditVerificationUrl);
                       return;
                     }
                     const session = await createDiditSession({
                       returnToOrigin: window.location.origin,
                     });
                     if (session?.status === 'approved' || session?.ageVerified === true) {
                       setDiditStatus('approved');
                       setDiditUiState('idle');
                       setStep((prevStep) => Math.max(prevStep, 3));
                       setDiditPending(false);
                       return;
                     }
                     if (!session?.verificationUrl) {
                       throw new Error('Geen verificatielink ontvangen.');
                     }
                     if (import.meta.env.DEV) {
                       console.log('[Onboarding] Didit session created', session);
                     }
                     window.location.assign(session.verificationUrl);
                   } catch (error) {
                     setDiditUiState('error');
                     setDiditPending(false);
                     setDiditError(error?.message || 'Didit verificatie starten mislukt.');
                   }
                 }}
                 className="w-full"
                 disabled={diditPending || requiresEmailVerificationForIdv || allowDevSkipIdv}
               >
                 {effectiveDiditState === 'expired' ? 'Nieuwe verificatie starten' : effectiveDiditState === 'abandoned' ? 'Verificatie opnieuw starten' : effectiveDiditState === 'declined' ? 'Opnieuw proberen' : effectiveDiditState === 'in_progress' ? 'Verificatie opnieuw openen' : 'Start verificatie'}
               </Button>
             )}
             {(effectiveDiditState === 'not_started' || effectiveDiditState === 'declined') && (
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
             )}
             {(effectiveDiditState === 'declined' || effectiveDiditState === 'error') && (
               <Button variant="secondary" onClick={() => window.location.assign(`mailto:${DIDIT_SUPPORT_EMAIL}?subject=${encodeURIComponent('Vraag over afgewezen leeftijdsverificatie')}`)} className="w-full">
                 Mail support
               </Button>
             )}
             {showSupportActions && <p className="text-xs text-slate-500 select-all">{DIDIT_SUPPORT_EMAIL}</p>}
             {import.meta.env.DEV === true && (
               <>
                 <Button variant="secondary" onClick={handleDebugRefreshDiditStatus} className="w-full" disabled={diditPending}>
                   DEBUG: refresh Didit status
                 </Button>
                 {diditDebugResult && <p className="text-xs text-slate-500 dark:text-slate-400">{diditDebugResult}</p>}
               </>
             )}
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
                 <SearchWithAutocomplete
                   authReady={authReady}
                   authUser={authUser}
                   value={profileData.linkedAgencyName || ''}
                   onChange={(value) => {
                     setProfileData((prev) => ({ ...prev, linkedAgencyId: null, linkedAgencyName: value }));
                   }}
                   onSelect={(selectedUser) => {
                     const selectedName = selectedUser?.displayName || selectedUser?.username || '';
                     setProfileData((prev) => ({
                       ...prev,
                       linkedAgencyId: selectedUser?.uid || null,
                       linkedAgencyName: selectedName,
                     }));
                   }}
                   selectedLabel={profileData.linkedAgencyId ? (profileData.linkedAgencyName || '') : ''}
                   onClearSelection={() => setProfileData((prev) => ({ ...prev, linkedAgencyId: null }))}
                   placeholder="Zoek of typ agency naam"
                 />
             </div>
             <div className="flex-1">
                 <label className="block text-sm font-medium mb-1 dark:text-slate-300">Bedrijf/Studio (Optioneel)</label>
                 <SearchWithAutocomplete
                   authReady={authReady}
                   authUser={authUser}
                   value={profileData.linkedCompanyName || ''}
                   onChange={(value) => {
                     setProfileData((prev) => ({ ...prev, linkedCompanyId: null, linkedCompanyName: value }));
                   }}
                   onSelect={(selectedUser) => {
                     const selectedName = selectedUser?.displayName || selectedUser?.username || '';
                     setProfileData((prev) => ({
                       ...prev,
                       linkedCompanyId: selectedUser?.uid || null,
                       linkedCompanyName: selectedName,
                     }));
                   }}
                   selectedLabel={profileData.linkedCompanyId ? (profileData.linkedCompanyName || '') : ''}
                   onClearSelection={() => setProfileData((prev) => ({ ...prev, linkedCompanyId: null }))}
                   placeholder="Zoek of typ bedrijfsnaam"
                 />
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

    if (step === 5) {
      const effectiveRoles = roles.length
        ? roles
        : (Array.isArray(profile?.roles) ? profile.roles : []);
      return (
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
            <Button className="w-full" disabled={!accountCreated || pending || effectiveRoles.length === 0} onClick={async () => {
                try {
                  setPending(true);
                  setError(null);
                  await onCompleteProfile?.(profileData, effectiveRoles);
                  setError(null);
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
}

function Gallery({ posts, users, onUserClick, profile, onChallengeClick, onPostClick, onShadowClick, currentUser, followingLoaded, onOpenDiscover, revealedSensitivePostsById, onRevealSensitivePost }) {
  const [postEngagement, setPostEngagement] = useState({});
  const [likeBusyByPost, setLikeBusyByPost] = useState({});
  const triggerVisibility = useMemo(
    () => normalizeTriggerPreferences(profile?.preferences?.triggerVisibility),
    [profile?.preferences?.triggerVisibility],
  );
  const visiblePosts = useMemo(
    () => posts.filter((post) => getPostContentPreference(post, triggerVisibility) !== 'hideFeed'),
    [posts, triggerVisibility],
  );

  useEffect(() => {
    if (!visiblePosts.length) {
      setPostEngagement({});
      return () => {};
    }

    const unsubs = visiblePosts.flatMap((post) => {
      const likeUnsub = subscribeToLikes(post.id, (snap) => {
        setPostEngagement((prev) => ({
          ...prev,
          [post.id]: {
            ...(prev[post.id] || {}),
            likesCount: snap.size,
            liked: Boolean(currentUser?.uid && snap.docs.some((docSnap) => docSnap.id === currentUser.uid)),
          },
        }));
      });

      const commentsUnsub = subscribeToComments(post.id, (snap) => {
        setPostEngagement((prev) => ({
          ...prev,
          [post.id]: {
            ...(prev[post.id] || {}),
            commentsCount: snap.size,
          },
        }));
      });

      return [likeUnsub, commentsUnsub];
    });

    return () => {
      unsubs.forEach((unsub) => {
        if (typeof unsub === 'function') unsub();
      });
    };
  }, [currentUser?.uid, visiblePosts]);

  const handleLikeClick = async (event, post) => {
    event.stopPropagation();
    if (!currentUser?.uid) {
      onPostClick(post);
      return;
    }
    if (likeBusyByPost[post.id]) return;

    setLikeBusyByPost((prev) => ({ ...prev, [post.id]: true }));
    try {
      await toggleLike(post.id, currentUser.uid);
    } catch (error) {
      console.error('Timeline like failed', error);
    } finally {
      setLikeBusyByPost((prev) => ({ ...prev, [post.id]: false }));
    }
  };

  const showTimelineEmptyState = Boolean(currentUser?.uid && followingLoaded && visiblePosts.length === 0);

  return (
    <div className="max-w-2xl mx-auto px-2.5 py-3 space-y-5 md:px-4 md:py-6 md:space-y-12">
      {showTimelineEmptyState ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-center md:rounded-3xl md:p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            Je volgt nog niemand of er zijn nog geen posts van makers die je volgt.
          </p>
          <Button variant="secondary" onClick={onOpenDiscover}>
            Ontdek makers
          </Button>
        </div>
      ) : null}
      {visiblePosts.map((post) => {
        const shouldCover = shouldCoverPost(post, triggerVisibility, revealedSensitivePostsById);
        const authorDisplayName = resolvePostAuthorDisplayName({ post, users });
        const engagement = postEngagement[post.id] || {};
        const likesCount = Number.isFinite(engagement.likesCount) ? engagement.likesCount : Number(post.likes || 0);
        const commentsCount = Number.isFinite(engagement.commentsCount) ? engagement.commentsCount : Number(post.commentsCount || 0);
        const liked = engagement.liked === true;
        const likeBusy = likeBusyByPost[post.id] === true;

        const panorama = isPanoramaImage(post.imageMeta);

        return (
        <div key={post.id} className="relative group">
           <div
             data-dragged="false"
             className={`relative overflow-hidden rounded-sm bg-slate-200 dark:bg-slate-800 min-h-[190px] sm:min-h-[240px] md:min-h-[300px] shadow-sm cursor-pointer ${post.isChallenge ? 'ring-4 ring-amber-400' : ''}`}
             onClick={(event) => {
               if (event.currentTarget.dataset.dragged === 'true') {
                 event.currentTarget.dataset.dragged = 'false';
                 return;
               }
               onPostClick(post);
             }}
             onPointerDownCapture={panorama ? (event) => {
               event.currentTarget.dataset.pointerStartX = String(event.clientX);
               event.currentTarget.dataset.dragged = 'false';
             } : undefined}
             onPointerUpCapture={panorama ? (event) => {
               const startX = Number(event.currentTarget.dataset.pointerStartX || event.clientX);
               if (Math.abs(event.clientX - startX) > 12) {
                 event.currentTarget.dataset.dragged = 'true';
               }
             } : undefined}
           >
             <PostImageDisplay
               src={post.imageUrl}
               alt={post.title}
               imageMeta={post.imageMeta}
               className="w-full"
               imageClassName="relative z-0 block h-auto max-h-[520px] w-full object-cover md:max-h-none"
               panoramaFrameClassName="h-44 sm:h-56 md:h-56"
               shouldCover={shouldCover}
               overlay={<SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(post.id)} />}
             />
           </div>
           <div className="bg-white dark:bg-slate-800 rounded-b-lg shadow-xl p-2.5 mt-1.5 border border-slate-100 dark:border-slate-700 flex gap-2.5 md:rounded-b-xl md:p-5 md:mt-2 md:gap-6">
              <div className="flex-1 space-y-2 md:space-y-3">
                 <div className="flex gap-2 md:gap-3">
                   <button
                     type="button"
                     onClick={(event) => handleLikeClick(event, post)}
                     disabled={likeBusy}
                     className="inline-flex items-center gap-1.5 px-1 py-1 text-sm text-slate-600 dark:text-slate-300 transition disabled:opacity-60 md:gap-2 md:py-1.5"
                   >
                     <LikeIcon size={16} active={liked} disabled={likeBusy} />
                     <span>{likesCount}</span>
                   </button>
                   <button
                     type="button"
                     onClick={(event) => {
                       event.stopPropagation();
                       onPostClick(post);
                     }}
                     className="inline-flex items-center gap-1.5 px-1 py-1 text-sm text-slate-600 dark:text-slate-300 md:gap-2 md:py-1.5"
                   >
                     <CommentIcon size={16} active={false} />
                     <span>{commentsCount}</span>
                   </button>
                 </div>
                 <div><h3 className="text-base font-serif font-bold dark:text-white md:text-lg">{post.title}</h3><p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2 md:text-sm">{post.description}</p></div>
                 <div className="flex flex-wrap gap-1.5 md:gap-2">
                   {post.isChallenge && (
                     <Badge
                       colorClass="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-300/40"
                       onClick={() => onChallengeClick?.()}
                     >
                       Challenge
                     </Badge>
                   )}
                   {post.styles?.map(s => <Badge key={s} colorClass={getThemeStyle(s)}>{s}</Badge>)}
                 </div>
              </div>
              <PostCreditDisplay
                post={{ ...post, authorName: authorDisplayName }}
                onUserClick={onUserClick}
                onShadowClick={onShadowClick}
                className="gap-1 md:gap-2"
                roleClassName="text-[10px] uppercase font-bold text-slate-400 md:text-xs"
                nameClassName="text-[11px] font-medium text-slate-900 group-hover:text-blue-600 dark:text-white transition-colors md:text-xs"
              />
           </div>
        </div>
      );})}
    </div>
  );
}

function Discover({ users, posts, profile, currentUserId, onUserClick, onPostClick, setView, revealedSensitivePostsById, onRevealSensitivePost }) {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [activeThemes, setActiveThemes] = useState([]);
  const [activeRole, setActiveRole] = useState(null);
  const [showAllThemes, setShowAllThemes] = useState(false);
  const [showAllRoles, setShowAllRoles] = useState(false);
  const triggerVisibility = profile?.preferences?.triggerVisibility || normalizeTriggerPreferences();

  const normalizedUsers = useMemo(
    () => (Array.isArray(users) ? users.map((u) => normalizeUserForCollections(u)) : []),
    [users],
  );

  const visibleUsers = useMemo(
    () => normalizedUsers.filter((u) => !currentUserId || u.uid !== currentUserId),
    [normalizedUsers, currentUserId]
  );
  const visiblePosts = useMemo(
    () => posts.filter((post) => getPostContentPreference(post, triggerVisibility) !== 'hideFeed'),
    [posts, triggerVisibility]
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
    && (!activeRole || (Array.isArray(u.roles) && u.roles.includes(activeRole)))
    && (activeThemes.length === 0 || u.themes?.some((theme) => activeThemes.includes(theme)))
  ));

  return (
    <div className="max-w-5xl mx-auto px-2.5 pt-0 pb-3 md:px-4 md:py-6">
       {/* Mobile top-0 sticks to the padded scrollport edge, which is already below the fixed app header. */}
       <div className="sticky top-0 md:top-16 bg-[#F0F4F8] dark:bg-slate-900 z-20 pb-2 md:pb-4">
          <div className="relative mb-2 md:mb-4"><Search className="absolute left-3 top-2 h-4 w-4 text-slate-400 md:left-4 md:top-3.5 md:h-6 md:w-6"/><input className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border-none shadow-sm dark:bg-slate-800 dark:text-white md:pl-12 md:pr-4 md:py-3 md:text-base md:rounded-2xl" placeholder="Zoeken..." value={search} onChange={e => setSearch(e.target.value)}/></div>
          <div className="flex gap-1.5 mb-2 md:gap-2 md:mb-4">
             {['all', 'ideas', 'people'].map(t => <button key={t} onClick={() => setTab(t)} className={`px-2.5 py-1 rounded-md font-bold text-xs transition-all md:px-6 md:py-2 md:rounded-lg md:text-sm ${tab === t ? 'bg-white shadow text-blue-600 dark:bg-slate-700 dark:text-white' : 'text-slate-500'}`}>{t === 'all' ? 'Alles' : t === 'ideas' ? 'Ideeën' : 'Mensen'}</button>)}
          </div>
       </div>

       {tab === 'all' && <div className="grid grid-flow-dense grid-cols-2 items-start gap-2 sm:grid-cols-3 md:gap-3 lg:grid-cols-4 lg:gap-4">{mixedContent.map((item, i) => {
         const isPost = item.type === 'post';
         const shouldCover = isPost ? shouldCoverPost(item.data, triggerVisibility, revealedSensitivePostsById) : false;
         const postSpan = isPost ? getAdaptivePhotoTileSpan(item.data) : null;
         return (
          <article
            key={`${item.type}-${item.data.id || item.data.uid || i}`}
            role="button"
            tabIndex={0}
            onClick={(event) => {
              if (shouldIgnoreTileActivation(event.target, event.currentTarget)) return;
              isPost ? onPostClick(item.data) : onUserClick(item.data.uid);
            }}
            onKeyDown={(event) => {
              if (shouldIgnoreTileActivation(event.target, event.currentTarget)) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                isPost ? onPostClick(item.data) : onUserClick(item.data.uid);
              }
            }}
            className={`group relative ${isPost ? postSpan.className : 'col-span-1'} overflow-hidden rounded-lg bg-white text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 md:rounded-xl cursor-pointer`}
            data-tile-type={isPost ? postSpan.tileType : 'user'}
          >
             <div className="relative overflow-hidden">
               {shouldCover ? <SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(item.data.id)} /> : null}
               <img
                 src={isPost ? item.data.imageUrl : item.data.avatar}
                 alt={isPost ? item.data.title || '' : item.data.displayName || ''}
                 loading="lazy"
                 className={`relative z-0 block w-full ${isPost ? 'h-auto object-contain' : 'aspect-square h-auto object-cover'}`}
               />
             </div>
             <div className="px-2 py-1.5 font-bold text-[11px] truncate dark:text-white md:p-2 md:text-xs">{isPost ? item.data.title : item.data.displayName}</div>
          </article>
         );
       })}</div>}

       {tab === 'ideas' && <div>
          <div className="flex flex-wrap gap-1.5 mb-3 md:gap-2 md:mb-6">{displayedThemes.map(t => <button key={t} onClick={() => toggleTheme(t)} className={`px-2 py-1 rounded-full text-[11px] font-bold border transition-all md:px-4 md:py-2 md:text-xs ${activeThemes.includes(t) ? 'ring-2 ring-blue-500 ' + getThemeStyle(t) : 'bg-white dark:bg-slate-800 text-slate-500'}`}>{t}</button>)}<button onClick={() => setShowAllThemes(!showAllThemes)} className="text-[11px] font-bold text-blue-600 px-2 py-1 md:px-4 md:text-xs">Toon meer...</button></div>
          <AdaptivePhotoGrid
            posts={filteredPosts}
            onPostClick={onPostClick}
            getShouldCover={(post) => shouldCoverPost(post, triggerVisibility, revealedSensitivePostsById)}
            renderOverlay={(post) => <SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(post.id)} />}
            renderBadge={(post) => (post.isChallenge ? (
              <div className="absolute left-2 top-2 z-10">
                <Badge colorClass="bg-amber-100 text-amber-800 border-amber-300" onClick={() => setView('challenge_timeline')}>Challenge</Badge>
              </div>
            ) : null)}
          />
       </div>}

       {tab === 'people' && <div>
          <div className="space-y-2 mb-4 md:space-y-3 md:mb-6">
            <div className="flex flex-wrap gap-1.5 md:gap-2">
              <button
                onClick={() => setActiveThemes([])}
                className={`px-2 py-1 rounded-full text-[11px] font-bold border md:px-4 md:py-2 md:text-xs ${activeThemes.length === 0 ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
              >
                Alle thema&apos;s
              </button>
              {displayedThemes.map((theme) => (
                <button
                  key={theme}
                  onClick={() => toggleTheme(theme)}
                  className={`px-2 py-1 rounded-full text-[11px] font-bold border transition-all md:px-4 md:py-2 md:text-xs ${activeThemes.includes(theme) ? 'ring-2 ring-blue-500 ' + getThemeStyle(theme) : 'bg-white dark:bg-slate-800 text-slate-500'}`}
                >
                  {theme}
                </button>
              ))}
              <button onClick={() => setShowAllThemes(!showAllThemes)} className="text-[11px] font-bold text-blue-600 px-2 py-1 md:px-4 md:text-xs">Toon meer...</button>
            </div>
            <div className="flex flex-wrap gap-1.5 md:gap-2">
              <button
                onClick={() => setActiveRole(null)}
                className={`px-2 py-1 rounded-full text-[11px] font-bold border md:px-4 md:py-2 md:text-xs ${!activeRole ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
              >
                Iedereen
              </button>
              {displayedRoles.map(r => <button key={r.id} onClick={() => setActiveRole(r.id)} className={`px-2 py-1 rounded-full text-[11px] font-bold border md:px-4 md:py-2 md:text-xs ${activeRole === r.id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500'}`}>{r.label}</button>)}
              <button onClick={() => setShowAllRoles(!showAllRoles)} className="text-[11px] font-bold text-blue-600 px-2 py-1 md:px-4 md:text-xs">Toon meer...</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">{filteredUsers.map((u) => {
            const primaryRole = Array.isArray(u.roles) && u.roles.length ? u.roles[0] : null;
            const primaryRoleLabel = primaryRole ? ROLES.find((r) => r.id === primaryRole)?.label : null;
            return (
              <div key={u.uid} onClick={() => onUserClick(u.uid)} className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm cursor-pointer md:rounded-2xl"><div className="aspect-square relative"><img src={u.avatar} className="w-full h-full object-cover"/><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-2 md:p-3"><span className="text-white font-bold">{u.displayName}</span><span className="text-white/70 text-xs">{primaryRoleLabel || 'Lid'}</span></div></div></div>
            );
          })}</div>
       </div>}
    </div>
  );
}

function NavBar({ view, setView, onOpenSettings, showModerationDot = false }) {
   const mobileNavItems = [
      { id: 'gallery', label: 'Galerij', icon: ImageIcon },
      { id: 'discover', label: 'Ontdekken', icon: Search },
      { id: 'community', label: 'Community', icon: Users },
      { id: 'profile', label: 'Profiel', icon: User },
   ];

   return (
      <div className="fixed top-0 left-0 right-0 h-[calc(3.5rem+env(safe-area-inset-top))] md:h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 z-40 flex items-end md:items-center justify-between px-3 md:px-6 pb-2 md:pb-0 pt-[env(safe-area-inset-top)] md:pt-0">
         <button
           type="button"
           className="cursor-pointer shrink-0"
           onClick={() => setView('gallery')}
           aria-label="Ga naar galerij"
         >
           <img src="/brand/logo.png" alt="Artes" className="h-7 w-auto md:h-9" />
         </button>
         <div className="hidden md:flex gap-6">
            {['gallery', 'discover', 'community'].map(v => <button key={v} onClick={() => setView(v)} className={`capitalize font-medium ${view === v ? 'text-blue-600' : 'text-slate-500'}`}>{v === 'discover' ? 'Ontdekken' : v === 'gallery' ? 'Galerij' : v}</button>)}
            <button onClick={() => setView('profile')} className={`capitalize font-medium ${view === 'profile' ? 'text-blue-600' : 'text-slate-500'}`}>Mijn Portfolio</button>
         </div>
         <div className="md:hidden flex flex-1 items-center justify-center gap-1 px-2">
            {mobileNavItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${view === id ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15' : 'text-slate-400'}`}
                aria-label={label}
                aria-current={view === id ? 'page' : undefined}
              >
                <Icon className="h-5 w-5" />
              </button>
            ))}
         </div>
         <button onClick={onOpenSettings} className="relative shrink-0 p-2 -mr-2 md:mr-0" aria-label="Instellingen openen">
           <Settings className="w-5 h-5 text-slate-500"/>
           {showModerationDot && <span className="absolute top-1 right-1 md:-top-1 md:-right-1 h-2.5 w-2.5 rounded-full bg-red-500" />}
         </button>
      </div>
   );
}

const seedCountsFromProfile = (profileData, normalizedProfileData = null) => {
  const source = normalizedProfileData || profileData;
  return {
    fansCount: Number(source?.fansCount ?? profileData?.fansCount ?? 0),
    fanOfCount: Number(source?.fanOfCount ?? profileData?.fanOfCount ?? 0),
  };
};

function ImmersiveProfile({ profile, isOwn, posts, onOpenSettings, onPostClick, allUsers = [], onLinkedProfileClick, onChallengeClick, triggerVisibility, currentUserId = null, isFan = false, fanBusy = false, fanError = '', onToggleFan = null, revealedSensitivePostsById, onRevealSensitivePost }) {
  const normalizedProfile = useMemo(() => (profile ? normalizeProfileData(profile) : null), [profile]);
  const profileUserId = normalizedProfile?.uid || profile?.uid || null;
  const seededFanCounts = useMemo(() => seedCountsFromProfile(profile, normalizedProfile), [profile, normalizedProfile]);
  const [fanCounts, setFanCounts] = useState(seededFanCounts);
  const fanBusyRef = useRef(false);
  const hasLiveCountsRef = useRef(false);

  useEffect(() => {
    hasLiveCountsRef.current = false;
    setFanCounts(seededFanCounts);
  }, [profileUserId]);

  useEffect(() => {
    if (!profileUserId) return () => {};
    const unsubscribeCounts = subscribeToFanCounts(profileUserId, (counts) => {
      const normalizedCounts = {
        fansCount: Number(counts?.fansCount || 0),
        fanOfCount: Number(counts?.fanOfCount || 0),
      };
      hasLiveCountsRef.current = true;
      setFanCounts(normalizedCounts);
    });
    return () => unsubscribeCounts?.();
  }, [profileUserId]);

  useEffect(() => {
    if (!profileUserId) return;
    if (fanBusyRef.current) return;
    if (hasLiveCountsRef.current) return;
    setFanCounts(seededFanCounts);
  }, [profileUserId, seededFanCounts]);

  const fansCount = Number(fanCounts?.fansCount ?? normalizedProfile?.fansCount ?? 0);
  const fanOfCount = Number(fanCounts?.fanOfCount ?? normalizedProfile?.fanOfCount ?? 0);
  const canFanUser = Boolean(!isOwn && currentUserId && profileUserId && currentUserId !== profileUserId);
  const visiblePosts = useMemo(
    () => posts.filter((post) => getPostContentPreference(post, triggerVisibility) !== 'hideFeed'),
    [posts, triggerVisibility],
  );
  if (!normalizedProfile) return null;
  const roles = normalizedProfile.roles;
  const themes = normalizedProfile.themes;
  const bio = normalizedProfile.bio;
  const showBio = Boolean(bio && bio !== 'Nog geen bio toegevoegd.');
  const agencyName = resolveLinkedProfileName(normalizedProfile.linkedAgencyId, normalizedProfile.linkedAgencyName, allUsers);
  const companyName = resolveLinkedProfileName(normalizedProfile.linkedCompanyId, normalizedProfile.linkedCompanyName, allUsers);
  const agencyLink = normalizedProfile.linkedAgencyLink || '';
  const companyLink = normalizedProfile.linkedCompanyLink || '';
  const headerImage = normalizedProfile.avatar;
  const hasAgency = Boolean(agencyName);
  const hasCompany = Boolean(companyName);
  const roleLabel = (roleId) => ROLES.find((x) => x.id === roleId)?.label || 'Onbekende rol';
  return (
     <div className="min-h-screen bg-white dark:bg-slate-900 pb-20">
        <div className="relative h-[520px] w-full overflow-hidden">
           <img
             src={headerImage}
             className="w-full h-full object-cover"
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
              <div className="flex flex-wrap justify-center gap-4 text-xs font-semibold text-slate-700/90 dark:text-slate-200/90 mb-5">
                <span>Fans: {fansCount}</span>
                <span>Fan van: {fanOfCount}</span>
              </div>
              {canFanUser ? (
                <div className="flex flex-col items-center gap-2 mb-5">
                  <Button onClick={onToggleFan} variant="secondary" disabled={fanBusy}>
                    {fanBusy ? 'Fanstatus opslaan...' : (isFan ? 'Stop fan zijn' : 'Word fan')}
                  </Button>
                  {fanError ? <p className="text-sm text-red-500 dark:text-red-300">{fanError}</p> : null}
                </div>
              ) : null}
              {(hasAgency || hasCompany) && (
                <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-2 sm:gap-6 text-xs text-slate-700/80 dark:text-white/80 mb-5">
                  {hasAgency && (
                    <span className="flex items-center gap-1.5">
                      <span className="uppercase tracking-widest text-[10px] font-semibold text-slate-500 dark:text-slate-300">Agency</span>
                      {agencyLink ? (
                        <a href={agencyLink} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 dark:text-white hover:text-blue-800 dark:hover:text-white/90 transition-colors">
                          {agencyName}
                        </a>
                      ) : normalizedProfile.linkedAgencyId && onLinkedProfileClick ? (
                        <button
                          type="button"
                          onClick={() => onLinkedProfileClick?.(normalizedProfile.linkedAgencyId)}
                          className="font-semibold text-blue-700 dark:text-white hover:text-blue-800 dark:hover:text-white/90 transition-colors"
                        >
                          {agencyName}
                        </button>
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
                      ) : normalizedProfile.linkedCompanyId && onLinkedProfileClick ? (
                        <button
                          type="button"
                          onClick={() => onLinkedProfileClick?.(normalizedProfile.linkedCompanyId)}
                          className="font-semibold text-blue-700 dark:text-white hover:text-blue-800 dark:hover:text-white/90 transition-colors"
                        >
                          {companyName}
                        </button>
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
           <AdaptivePhotoGrid
             posts={visiblePosts}
             onPostClick={onPostClick}
             getShouldCover={(post) => shouldCoverPost(post, triggerVisibility, revealedSensitivePostsById)}
             renderOverlay={(post) => <SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(post.id)} />}
             itemClassName="rounded-sm"
           />
           {visiblePosts.length === 0 && <p className="text-center text-slate-500 py-10">Nog geen posts.</p>}
        </div>
     </div>
  );
}

function ModerationDecisionModal({ message, onClose, onOpenComposer, pending, currentUserUid }) {
  if (!message) return null;
  const decision = message?.metadata?.decision;
  const reasons = message?.metadata?.reasons || [];
  const isApproved = decision === 'approved';
  const isReport = message?.metadata?.caseType === 'report';
  const ownerUid = message?.metadata?.ownerUid || null;
  const canTakeAction = isApproved
    && !isReport
    && message?.metadata?.uploadId
    && ownerUid
    && ownerUid === currentUserUid;
  const title = decision ? (isApproved ? 'Je foto is goedgekeurd' : 'Je foto is niet goedgekeurd') : 'Moderatie-update';
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
          <h3 className="font-bold text-base md:text-lg dark:text-white">{title}</h3>
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
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                Later
              </Button>
              <Button onClick={() => onOpenComposer?.(message?.metadata?.uploadId)} disabled={pending}>
                Open in editor
              </Button>
            </>
          ) : (
            <Button onClick={onClose} disabled={pending}>
              Oké
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModerationPanel({ moderationApiBase, authUser, isModerator, caseTypeFilter, authReady, isModeratorClient, profileAgeVerified, profileAgeVerifiedStrict, profileIsAdult, logListenerStart, handleListenerError, allUsers = [] }) {
  const [announcementDraft, setAnnouncementDraft] = useState({ id: null, title: '', body: '', version: 1 });
  const [announcementCurrent, setAnnouncementCurrent] = useState(null);
  const [announcementHistory, setAnnouncementHistory] = useState([]);
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [cases, setCases] = useState([]);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);
  const [selectedUpload, setSelectedUpload] = useState(null);
  const [claimState, setClaimState] = useState({ claimed: false, claimedBy: null, loading: false });
  const [decisionAction, setDecisionAction] = useState(MODERATOR_DECISION_ACTIONS.approveAsIs);
  const [decision, setDecision] = useState('approved');
  const [selectedReasons, setSelectedReasons] = useState([]);
  const [decisionReasonCode, setDecisionReasonCode] = useState('');
  const [queueFreshEvaluationReasonCode, setQueueFreshEvaluationReasonCode] = useState('');
  const [decisionMessage, setDecisionMessage] = useState('');
  const [messageTouched, setMessageTouched] = useState(false);
  const [moderatorNote, setModeratorNote] = useState('');
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionError, setDecisionError] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [freshEvaluationPending, setFreshEvaluationPending] = useState(false);
  const [freshEvaluationMessage, setFreshEvaluationMessage] = useState('');
  const [freshEvaluationError, setFreshEvaluationError] = useState('');
  const [showRawDebug, setShowRawDebug] = useState(false);
  const [correctedThemes, setCorrectedThemes] = useState([]);
  const [correctedTriggers, setCorrectedTriggers] = useState([]);
  const [decisionResultStatus, setDecisionResultStatus] = useState('');
  const reviewCasesListenerLogRef = useRef(null);
  const validDecisionReasonCodes = useMemo(
    () => new Set(MODERATOR_REASON_CODES_BY_ACTION[decision] || []),
    [decision]
  );
  const visibleReasonCodes = useMemo(
    () => MODERATOR_REASON_CODES.filter((code) => validDecisionReasonCodes.has(code.id)),
    [validDecisionReasonCodes]
  );

  const queueFreshEvaluationReasonCodes = useMemo(
    () => MODERATOR_REASON_CODES.filter((code) => (MODERATOR_REASON_CODES_BY_ACTION.queueFreshEvaluation || []).includes(code.id)),
    []
  );
  const loadAnnouncements = useCallback(async () => {
    const db = getFirebaseDbInstance();
    const snap = await getDocs(query(collection(db, 'announcements'), where('type', '==', 'appUpdate')));
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => getTimestampMs(b.updatedAt || b.createdAt) - getTimestampMs(a.updatedAt || a.createdAt));
    const current = docs.find((item) => item.status === 'active' && item.isCurrent === true) || null;
    const latestDraft = docs.find((item) => item.status === 'draft') || null;
    setAnnouncementCurrent(current);
    setAnnouncementHistory(docs.filter((item) => item.id !== current?.id).slice(0, 10));
    setAnnouncementDraft({
      id: latestDraft?.id || null,
      title: latestDraft?.title || '',
      body: latestDraft?.body || '',
      version: Number(latestDraft?.version || (current?.version || 0) + 1 || 1),
    });
  }, []);

  useEffect(() => {
    if (isModerator !== true) return;
    loadAnnouncements().catch(() => {});
  }, [isModerator, loadAnnouncements]);

  const handleSaveAnnouncementDraft = useCallback(async () => {
    if (!authUser?.uid) return;
    setAnnouncementSaving(true);
    const db = getFirebaseDbInstance();
    const payload = {
      type: 'appUpdate',
      title: announcementDraft.title.trim(),
      body: announcementDraft.body.trim(),
      status: 'draft',
      isCurrent: false,
      version: Number(announcementDraft.version || 1),
      createdBy: authUser.uid,
      updatedAt: serverTimestamp(),
      publishedAt: null,
    };
    try {
      if (!payload.title || !payload.body) return;
      if (announcementDraft.id) {
        await setDoc(doc(db, 'announcements', announcementDraft.id), payload, { merge: true });
      } else {
        await addDoc(collection(db, 'announcements'), { ...payload, createdAt: serverTimestamp() });
      }
      await loadAnnouncements();
    } finally {
      setAnnouncementSaving(false);
    }
  }, [announcementDraft, authUser?.uid, loadAnnouncements]);

  const handlePublishAnnouncement = useCallback(async () => {
    if (!authUser?.uid || !announcementDraft.title.trim() || !announcementDraft.body.trim()) return;
    setAnnouncementSaving(true);
    const db = getFirebaseDbInstance();
    try {
      const activeSnap = await getDocs(query(collection(db, 'announcements'), where('type', '==', 'appUpdate'), where('status', '==', 'active'), where('isCurrent', '==', true)));
      const batch = writeBatch(db);
      activeSnap.docs.forEach((item) => {
        batch.update(item.ref, { status: 'archived', isCurrent: false, updatedAt: serverTimestamp() });
      });
      const nextRef = announcementDraft.id ? doc(db, 'announcements', announcementDraft.id) : doc(collection(db, 'announcements'));
      batch.set(nextRef, {
        type: 'appUpdate',
        title: announcementDraft.title.trim(),
        body: announcementDraft.body.trim(),
        status: 'active',
        isCurrent: true,
        version: Number(announcementDraft.version || 1),
        createdBy: authUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        publishedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      await loadAnnouncements();
    } finally {
      setAnnouncementSaving(false);
    }
  }, [announcementDraft, authUser?.uid, loadAnnouncements]);

  const usersByUid = useMemo(() => {
    if (!Array.isArray(allUsers)) return new Map();
    const entries = allUsers
      .map((entry) => normalizeUserForCollections(entry))
      .filter((entry) => entry?.uid)
      .map((entry) => [entry.uid, entry]);
    return new Map(entries);
  }, [allUsers]);

  const resolveCaseUploader = useCallback((item, upload = null) => {
    const uid = item?.uploaderSnapshot?.uid || item?.userId || item?.reportedPost?.authorId || null;
    const liveUser = uid ? usersByUid.get(uid) : null;
    const displayName = item?.uploaderSnapshot?.displayName
      || upload?.postDraft?.authorName
      || upload?.authorName
      || item?.reportedPost?.authorName
      || liveUser?.displayName
      || uid
      || 'Onbekend';
    return {
      displayName,
      uid: uid || item?.uploaderSnapshot?.uid || null,
    };
  }, [usersByUid]);

  useEffect(() => {
    const shouldStart = canStartModeration({
      authReady,
      user: { ...authUser, isModerator: isModeratorClient === true && isModerator === true },
      profile: {
        ageVerified: profileAgeVerifiedStrict === true,
        isAdult: profileIsAdult === true,
      },
      config: null,
    });
    if (import.meta.env.DEV) {
      const reason = !authReady
        ? 'skip: auth not ready'
        : !authUser?.uid
          ? 'skip: no auth user'
          : profileAgeVerified !== true
            ? 'skip: profile age not verified'
          : profileIsAdult !== true
            ? 'skip: profile not adult'
            : !authUser?.emailVerified
              ? 'skip: email not verified'
            : isModeratorClient !== true
              ? 'skip: not a moderator client'
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
    logListenerStart('Moderation reviewCases listener (ArtesApp)', { isModeratorClient });
    const db = getFirebaseDbInstance();
    const q = query(collection(db, 'reviewCases'), where('status', '==', 'inReview'), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        setCases(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      },
      (err) => handleListenerError('Moderation reviewCases listener (ArtesApp)', err),
    );
  }, [authReady, authUser, isModeratorClient, isModerator, profileAgeVerified, profileAgeVerifiedStrict, profileIsAdult, logListenerStart, handleListenerError]);

  const filteredCases = useMemo(() => {
    const activeCases = cases.filter((item) => item?.status === 'inReview');
    if (caseTypeFilter === 'report') {
      return activeCases.filter((item) => item.caseType === 'report');
    }
    if (caseTypeFilter === 'upload') {
      return activeCases.filter((item) => item.caseType !== 'report');
    }
    return activeCases;
  }, [cases, caseTypeFilter]);

  useEffect(() => {
    if (!selectedCaseId) {
      setSelectedCase(null);
      setSelectedUpload(null);
      setQueueFreshEvaluationReasonCode('');
      return;
    }
    const found = filteredCases.find((item) => item.id === selectedCaseId) || null;
    setSelectedCase(found);
    if (!found) {
      setSelectedCaseId(null);
    }
  }, [selectedCaseId, filteredCases]);

  useEffect(() => {
    if (!authReady || !selectedCase) {
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
  }, [authReady, selectedCase, profileAgeVerified]);

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
    setDecisionAction(MODERATOR_DECISION_ACTIONS.approveAsIs);
    setDecision('approved');
    setDecisionReasonCode('');
    setQueueFreshEvaluationReasonCode('');
    setSelectedReasons([]);
    setDecisionMessage(buildDecisionTemplate('approved', []));
    setMessageTouched(false);
    setModeratorNote('');
    setDecisionError(null);
    setDecisionResultStatus('');
    setCorrectedThemes([]);
    setCorrectedTriggers([]);
  }, [selectedCase?.id]);

  useEffect(() => {
    if (!decisionReasonCode) return;
    if (validDecisionReasonCodes.has(decisionReasonCode)) return;
    setDecisionReasonCode('');
  }, [decisionReasonCode, validDecisionReasonCodes]);

  useEffect(() => {
    if (!queueFreshEvaluationReasonCode) return;
    const allowedCodes = MODERATOR_REASON_CODES_BY_ACTION.queueFreshEvaluation || [];
    if (allowedCodes.includes(queueFreshEvaluationReasonCode)) return;
    setQueueFreshEvaluationReasonCode('');
  }, [queueFreshEvaluationReasonCode]);

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
        setQueueFreshEvaluationReasonCode('');
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
    const isCorrectionAction = (
      decisionAction === MODERATOR_DECISION_ACTIONS.approveWithTaxonomyCorrection
      || decisionAction === MODERATOR_DECISION_ACTIONS.requestUserCorrection
    );
    if (isCorrectionAction && correctedThemes.length === 0 && correctedTriggers.length === 0) {
      setDecisionError('Kies minimaal één gecorrigeerd thema of trigger.');
      return;
    }
    if (decision === 'rejected' && selectedReasons.length === 1 && selectedReasons[0] === 'missingOrIncorrectTags') {
      setDecisionError('Triggers ontbreken of kloppen niet kan niet alleen tot afkeuring leiden.');
      return;
    }
    if (!decisionReasonCode) {
      setDecisionError('Kies eerst een reason code.');
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
          action: decisionAction,
          reasonCode: decisionReasonCode,
          decisionMessagePublic: decisionMessage.trim(),
          decisionReasons: selectedReasons,
          correctedTaxonomy: {
            themes: correctedThemes,
            triggers: correctedTriggers,
          },
          moderatorNoteInternal: moderatorNote || null,
        }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || 'Beslissing opslaan mislukt.');
      }
      setDecisionResultStatus(`Opgeslagen: ${decisionAction}`);
      setDecisionReasonCode('');
      setSelectedCaseId(null);
    } catch (error) {
      setDecisionError(error.message);
    } finally {
      setDecisionPending(false);
    }
  };

  const handleQueueFreshEvaluation = async () => {
    if (!selectedCase || !authUser || !moderationApiBase) return;
    const uploadId = selectedUpload?.id || selectedCase.uploadId || selectedCase.linkedUploadIds?.[0] || null;
    if (!uploadId) {
      setFreshEvaluationError('Geen upload-ID beschikbaar voor deze case.');
      return;
    }
    if (!queueFreshEvaluationReasonCode) {
      setFreshEvaluationError('Kies eerst een queue reason code.');
      return;
    }
    setFreshEvaluationPending(true);
    setFreshEvaluationError('');
    setFreshEvaluationMessage('');
    try {
      const token = await authUser.getIdToken();
      const response = await fetch(`${moderationApiBase}/moderatorQueueFreshEvaluation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reviewCaseId: selectedCase.id,
          uploadId,
          reasonCode: queueFreshEvaluationReasonCode,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload?.ok !== true) {
        throw new Error('Kon aanvraag niet opslaan. Probeer het opnieuw.');
      }
      const clickedCaseId = selectedCase.id;
      const backendCaseId = typeof payload?.reviewCaseId === 'string' ? payload.reviewCaseId : null;
      const caseIdsToRemove = new Set([clickedCaseId, backendCaseId].filter(Boolean));
      setCases((prev) => prev.filter((item) => !caseIdsToRemove.has(item.id)));
      if (payload?.queueFreshEvaluationMode === 'fingerprintOverride' || payload?.fingerprintQueued === true) {
        setFreshEvaluationMessage('Nieuwe upload met dezelfde fingerprint wordt opnieuw beoordeeld.');
      } else {
        setFreshEvaluationMessage('Case uit actieve review gehaald. Geen fingerprint override aangemaakt.');
      }
      setQueueFreshEvaluationReasonCode('');
      setSelectedCaseId(null);
    } catch (error) {
      setFreshEvaluationError(error?.message || 'Kon aanvraag niet opslaan. Probeer het opnieuw.');
    } finally {
      setFreshEvaluationPending(false);
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
  const uploadPreviewUrl = selectedUpload?.previewUrl
    || selectedUpload?.imageUrl
    || selectedUpload?.image
    || selectedUpload?.postDraft?.imageUrl
    || reportedPost?.imageUrl
    || null;
  const userSelectedTaxonomy = selectedCase?.aiSummary?.userSelectedTaxonomy
    || selectedUpload?.userSelectedTaxonomy
    || { themes: Array.isArray(selectedUpload?.themes) ? selectedUpload.themes : [], triggers: Array.isArray(selectedUpload?.makerTags) ? selectedUpload.makerTags : [] };
  const aiSuggestedTaxonomy = selectedCase?.aiSummary?.aiSuggestedTaxonomy
    || selectedUpload?.aiSuggestedTaxonomy
    || { triggers: Array.isArray(selectedUpload?.suggestedTriggers) ? selectedUpload.suggestedTriggers : [] };
  const aiSignals = Array.isArray(selectedCase?.aiSummary?.aiSafetySignals)
    ? selectedCase.aiSummary.aiSafetySignals
    : (Array.isArray(selectedUpload?.aiSafetySignals) ? selectedUpload.aiSafetySignals : []);
  const aiVisionLabels = Array.isArray(selectedCase?.aiSummary?.aiVisionLabels)
    ? selectedCase.aiSummary.aiVisionLabels
    : (Array.isArray(selectedUpload?.aiVisionLabels) ? selectedUpload.aiVisionLabels : []);
  const tags = (Array.isArray(userSelectedTaxonomy?.triggers) ? userSelectedTaxonomy.triggers : [])
    .map((tag) => {
      if (typeof tag === 'string') return resolveTriggerKey(tag);
      if (tag && typeof tag === 'object') return resolveTriggerKey(tag.trigger || tag.reason);
      return null;
    })
    .filter(Boolean);
  const selectedUploader = resolveCaseUploader(selectedCase, selectedUpload);
  const selectedAiSummary = selectedCase?.aiSummary || {
    classification: selectedUpload?.classification || null,
    shouldReview: Boolean(selectedUpload?.shouldReview),
    forbiddenReasons: Array.isArray(selectedUpload?.forbiddenReasons) ? selectedUpload.forbiddenReasons : [],
    appliedTriggers: Array.isArray(selectedUpload?.appliedTriggers) ? selectedUpload.appliedTriggers : [],
    suggestedTriggers: Array.isArray(selectedUpload?.suggestedTriggers) ? selectedUpload.suggestedTriggers : [],
    moderationSignals: selectedUpload?.moderationSignals || null,
  };
  const policyAppliedTriggers = Array.isArray(selectedCase?.aiSummary?.policyAppliedTriggers)
    ? selectedCase.aiSummary.policyAppliedTriggers
    : (Array.isArray(selectedAiSummary?.appliedTriggers) ? selectedAiSummary.appliedTriggers : []);
  const sanitizedPolicyAppliedTriggers = policyAppliedTriggers.filter((trigger) => {
    if (typeof trigger === 'string' && isLegacyDiagnosticStringTrigger(trigger)) return false;
    if (trigger && typeof trigger === 'object' && isRawVisionSource(trigger.source)) return false;
    if (trigger && typeof trigger === 'object') {
      const key = resolveTriggerKey(trigger?.trigger || trigger?.reason);
      const hasSource = Object.prototype.hasOwnProperty.call(trigger, 'source') && trigger.source !== null && trigger.source !== undefined && String(trigger.source).trim() !== '';
      if (!hasSource && (key === 'spidersInsects' || key === 'needlesInjections')) return false;
    }
    return true;
  });
  const selectedReviewReason = selectedCase?.reviewReason
    || (selectedCase?.caseType === 'report' ? 'reportedPost' : 'inReview');
  const statusLabelMap = {
    inReview: 'In review',
    freshEvalQueued: 'Opnieuw beoordelen bij volgende upload',
    approved: 'Goedgekeurd',
    rejected: 'Afgekeurd',
  };
  const reviewReasonLabelMap = {
    forbiddenOutcomeAutoReview: 'Automatisch in review na AI blokkade',
    manualUserReviewRequest: 'Handmatig reviewverzoek door uploader',
    reportedPost: 'Melding op bestaande post',
    inReview: 'Case staat in actieve reviewqueue',
  };
  const currentStatusLabel = statusLabelMap[selectedCase?.status] || selectedCase?.status || 'Onbekend';
  const currentReviewReasonLabel = reviewReasonLabelMap[selectedReviewReason] || selectedReviewReason;
  const casePreviousModeratorExample = selectedCase?.previousModeratorExample;
  const uploadPreviousModeratorExample = selectedUpload?.moderationMetadata?.previousModeratorExample
    || selectedUpload?.moderation?.previousModeratorExample
    || null;
  const previousModeratorExample = (casePreviousModeratorExample || uploadPreviousModeratorExample)
    ? {
        ...(uploadPreviousModeratorExample && typeof uploadPreviousModeratorExample === 'object' ? uploadPreviousModeratorExample : {}),
        ...(casePreviousModeratorExample && typeof casePreviousModeratorExample === 'object' ? casePreviousModeratorExample : {}),
      }
    : null;
  const previousActionLabelMap = {
    approve: 'Goedgekeurd',
    reject: 'Afgewezen',
    queueFreshEvaluation: 'Nieuwe beoordeling gevraagd',
  };
  const previousOutcomeLabelMap = {
    allowed: 'Toegestaan',
    forbidden: 'Geblokkeerd',
    review: 'Review nodig',
  };
  const previousReasonLabelMap = {
    allowed_art_nude: 'Artistiek naakt toegestaan',
    allowed_boudoir: 'Boudoir toegestaan',
    allowed_non_sensitive: 'Niet gevoelig toegestaan',
    review_borderline_adult: 'Grensgeval 18 plus, review nodig',
    forbidden_explicit_sexual: 'Expliciet seksueel, geblokkeerd',
    forbidden_non_consensual_context: 'Niet consensuele context, geblokkeerd',
    wrong_theme_or_label: 'Thema of label klopt niet',
    unclear_ai_result: 'Onduidelijke AI uitkomst',
  };
  const previousAction = previousModeratorExample?.action || null;
  const previousOutcome = previousModeratorExample?.finalOutcome || null;
  const previousReason = previousModeratorExample?.reasonCode || null;
  const queueTitle = caseTypeFilter === 'report' ? 'Gerapporteerde foto’s' : 'Foto’s in review';
  const resolveGeminiDiagnostics = (caseItem, uploadItem = null) => {
    const candidates = [
      caseItem?.geminiDiagnostics,
      caseItem?.aiSummary?.geminiDiagnostics,
      uploadItem?.geminiDiagnostics,
      caseItem?.uploadSnapshot?.geminiDiagnostics,
      caseItem?.moderationData?.geminiDiagnostics,
    ];
    return candidates.find((item) => item && typeof item === 'object') || null;
  };
  const formatBooleanNl = (value) => (value === true ? 'ja' : value === false ? 'nee' : 'onbekend');
  const formatListNl = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item)).join(', ') || 'geen';
    if (typeof value === 'string') return value.trim() || 'geen';
    return 'geen';
  };
  const formatSafetyRatings = (value) => {
    if (!Array.isArray(value) || value.length === 0) return 'geen';
    return value.slice(0, 6).map((item) => {
      if (!item || typeof item !== 'object') return String(item || 'onbekend');
      const category = item.category || item.name || 'onbekend';
      const probability = item.probability || item.severity || item.rating || 'onbekend';
      return `${category}: ${probability}`;
    }).join(' · ');
  };
  const geminiDiagnostics = resolveGeminiDiagnostics(selectedCase, selectedUpload);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <h2 className="font-semibold dark:text-white">App update announcement</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input className="md:col-span-2 p-3 rounded-xl border dark:bg-slate-800 dark:text-white" placeholder="Titel" value={announcementDraft.title} onChange={(e) => setAnnouncementDraft((prev) => ({ ...prev, title: e.target.value }))} />
          <input className="p-3 rounded-xl border dark:bg-slate-800 dark:text-white" type="number" min="1" value={announcementDraft.version} onChange={(e) => setAnnouncementDraft((prev) => ({ ...prev, version: Number(e.target.value || 1) }))} />
        </div>
        <textarea className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white" rows={3} placeholder="Bericht" value={announcementDraft.body} onChange={(e) => setAnnouncementDraft((prev) => ({ ...prev, body: e.target.value }))} />
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleSaveAnnouncementDraft} disabled={announcementSaving}>Draft opslaan</Button>
          <Button onClick={handlePublishAnnouncement} disabled={announcementSaving}>Publiceer als huidige update</Button>
        </div>
        {announcementCurrent && <p className="text-xs text-slate-500 dark:text-slate-400">Huidig: v{announcementCurrent.version} · {announcementCurrent.title}</p>}
        {announcementHistory.length > 0 && (
          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p className="font-semibold text-slate-600 dark:text-slate-300">Geschiedenis</p>
            {announcementHistory.map((item) => <p key={item.id}>v{item.version} · {item.title} · {item.status}</p>)}
          </div>
        )}
      </div>
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold dark:text-white">{queueTitle}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{filteredCases.length} in review</p>
          </div>
          <div className="text-xs text-slate-400">J/K</div>
        </div>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto no-scrollbar">
          {filteredCases.map((item) => {
            const uploader = resolveCaseUploader(item);
            return (
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
                <p className="text-xs text-slate-700 dark:text-slate-200 mt-1">Uploader: {uploader.displayName}</p>
                <p className="text-[11px] text-slate-500">UID: {uploader.uid || 'Onbekend'}</p>
                <p className="text-[11px] text-slate-500 mt-1">In review sinds: {formatDateTimeNl(item.createdAt)}</p>
              </button>
            );
          })}
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
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-600 dark:text-slate-300 space-y-1">
                <p><span className="font-semibold">Uploader:</span> {selectedUploader.displayName}</p>
                <p><span className="font-semibold">UID:</span> {selectedUploader.uid || 'Onbekend'}</p>
                <p><span className="font-semibold">Uploadtijd:</span> {formatDateTimeNl(selectedUpload?.createdAt)}</p>
                <p><span className="font-semibold">In review sinds:</span> {formatDateTimeNl(selectedCase?.createdAt)}</p>
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
                    <p className="text-xs text-slate-500 dark:text-slate-400">Uploader gekozen</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {tags.length > 0 ? tags.map((tag, index) => (
                        <span key={`${tag}-${index}`} className="text-[11px] px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200">
                          {TRIGGERS.find((item) => item.id === tag)?.label || tag}
                        </span>
                      )) : (
                        <span className="text-xs text-slate-400">{isReportCase ? 'Geen tags beschikbaar' : 'Geen tags'}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">AI classificatie</p>
                    <div className="text-xs bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-slate-600 dark:text-slate-200">
                      {selectedAiSummary?.classification || 'Onbekend'}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">AI voorstel</p>
                    <div className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Voorgestelde triggers</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {(Array.isArray(aiSuggestedTaxonomy?.triggers) ? aiSuggestedTaxonomy.triggers : []).length > 0
                            ? aiSuggestedTaxonomy.triggers.map((trigger, idx) => {
                                const key = resolveTriggerKey(typeof trigger === 'string' ? trigger : trigger?.trigger || trigger?.reason);
                                const label = TRIGGERS.find((item) => item.id === key)?.label || key;
                                return <span key={`suggested-${idx}`} className="text-[11px] px-2 py-1 rounded-full bg-violet-100 text-violet-700">{label}</span>;
                              })
                            : <span className="text-[11px] text-slate-400">Geen</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Taxonomie vergelijking</p>
                    <p className="text-[11px] text-slate-500">Uploader thema&apos;s: {(Array.isArray(selectedUpload?.themes) ? selectedUpload.themes : []).join(', ') || 'Geen'}</p>
                    <p className="text-[11px] text-slate-500">Uploader triggers: {(Array.isArray(tags) ? tags : []).join(', ') || 'Geen'}</p>
                    <p className="text-[11px] text-slate-500">AI thema&apos;s: {(Array.isArray(aiSuggestedTaxonomy?.themes) ? aiSuggestedTaxonomy.themes : []).join(', ') || 'Geen'}</p>
                    <p className="text-[11px] text-slate-500">AI triggers: {(Array.isArray(aiSuggestedTaxonomy?.triggers) ? aiSuggestedTaxonomy.triggers : []).map((t) => (typeof t === 'string' ? t : t?.trigger)).filter(Boolean).join(', ') || 'Geen'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">AI signalen</p>
                    <div className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Safety signalen</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {aiSignals.length > 0
                            ? aiSignals.map((signal, idx) => {
                                const key = resolveTriggerKey(signal?.signal || signal?.trigger || signal);
                                const label = TRIGGERS.find((item) => item.id === key)?.label || key;
                                return <span key={`signal-${idx}`} className="text-[11px] px-2 py-1 rounded-full bg-amber-100 text-amber-700">{label}</span>;
                              })
                            : <span className="text-[11px] text-slate-400">Geen</span>}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Vision labels (diagnostisch)</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {aiVisionLabels.length > 0
                            ? aiVisionLabels.map((label, idx) => (
                                <span key={`vision-${idx}`} className="text-[11px] px-2 py-1 rounded-full bg-slate-200 text-slate-700">{label}</span>
                              ))
                            : <span className="text-[11px] text-slate-400">Geen</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Beleidsbeslissing</p>
                    <div className="space-y-2 rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Applied triggers</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {sanitizedPolicyAppliedTriggers.length > 0
                          ? sanitizedPolicyAppliedTriggers.map((trigger, idx) => {
                              const key = resolveTriggerKey(typeof trigger === 'string' ? trigger : trigger?.trigger || trigger?.reason);
                              const label = TRIGGERS.find((item) => item.id === key)?.label || key;
                              return <span key={`policy-${idx}`} className="text-[11px] px-2 py-1 rounded-full bg-blue-100 text-blue-700">{label}</span>;
                            })
                          : <span className="text-[11px] text-slate-400">Geen</span>}
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Gemini diagnostiek</p>
                    <div className="space-y-1 rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-[11px] text-slate-600 dark:text-slate-200">
                      {!geminiDiagnostics ? (
                        <p>Geen Gemini diagnostiek opgeslagen voor deze case.</p>
                      ) : (
                        <>
                          <p><span className="font-semibold">Gemini geprobeerd:</span> {formatBooleanNl(geminiDiagnostics?.attempted)}</p>
                          <p><span className="font-semibold">Gemini gelukt:</span> {formatBooleanNl(geminiDiagnostics?.success)}</p>
                          <p><span className="font-semibold">Fallback gebruikt:</span> {formatBooleanNl(geminiDiagnostics?.fallbackUsed)}</p>
                          <p><span className="font-semibold">Reden fallback:</span> {geminiDiagnostics?.fallbackReason || 'onbekend'}</p>
                          <p><span className="font-semibold">Ontbrekende velden:</span> {formatListNl(geminiDiagnostics?.missingFields)}</p>
                          <p><span className="font-semibold">Finish reason:</span> {geminiDiagnostics?.finishReason || 'onbekend'}</p>
                          <p><span className="font-semibold">Safety ratings samengevat:</span> {formatSafetyRatings(geminiDiagnostics?.safetyRatings)}</p>
                          <p><span className="font-semibold">Model:</span> {geminiDiagnostics?.model || 'onbekend'}</p>
                          <p><span className="font-semibold">Promptversie:</span> {geminiDiagnostics?.promptVersion || 'onbekend'}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Waarom in review</p>
                    <div className="text-xs bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-slate-600 dark:text-slate-200">
                      {currentReviewReasonLabel}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Status</p>
                    <div className="text-xs bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-slate-600 dark:text-slate-200">
                      {currentStatusLabel}
                    </div>
                  </div>
                  {previousModeratorExample && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-200 space-y-1">
                      <p className="font-semibold text-slate-700 dark:text-slate-100">Eerdere moderatorbeoordeling gevonden</p>
                      <p><span className="font-semibold">Match:</span> Exacte SHA 256 match</p>
                      <p>
                        <span className="font-semibold">Vorige beslissing:</span>{' '}
                        {previousActionLabelMap[previousAction] || 'Onbekend'}
                      </p>
                      {previousAction === 'queueFreshEvaluation' && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-300">
                          Dit was een verzoek voor een nieuwe beoordeling, geen definitieve goed- of afkeuring.
                        </p>
                      )}
                      <p><span className="font-semibold">Einduitkomst:</span> {previousOutcomeLabelMap[previousOutcome] || 'Onbekend'}</p>
                      <p><span className="font-semibold">Reden:</span> {previousReasonLabelMap[previousReason] || 'Onbekend'}</p>
                      <p><span className="font-semibold">Beoordeeld op:</span> {formatDateTimeNl(previousModeratorExample?.decidedAt) || 'Onbekend'}</p>
                      <p><span className="font-semibold">Policy versie:</span> {previousModeratorExample?.policyVersion || 'Onbekend'}</p>
                    </div>
                  )}
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                    <button
                      type="button"
                      onClick={() => setShowRawDebug((prev) => !prev)}
                      className="w-full text-left text-xs font-semibold text-slate-600 dark:text-slate-200"
                    >
                      {showRawDebug ? 'Ruwe debug JSON verbergen' : 'Ruwe debug JSON tonen'}
                    </button>
                    {showRawDebug && (
                      <pre className="mt-2 text-xs bg-slate-50 dark:bg-slate-800 rounded-xl p-3 max-h-40 overflow-y-auto no-scrollbar text-slate-600 dark:text-slate-200">
                        {JSON.stringify({ aiSummary: selectedAiSummary, reviewCase: selectedCase, upload: selectedUpload || null }, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="flex gap-3 flex-wrap">
                      <Button variant={decisionAction === MODERATOR_DECISION_ACTIONS.approveAsIs ? 'primary' : 'secondary'} onClick={() => { setDecisionAction(MODERATOR_DECISION_ACTIONS.approveAsIs); setDecision('approved'); setMessageTouched(false); }}>
                        Approve as is
                      </Button>
                      <Button variant={decisionAction === MODERATOR_DECISION_ACTIONS.approveWithTaxonomyCorrection ? 'primary' : 'secondary'} onClick={() => { setDecisionAction(MODERATOR_DECISION_ACTIONS.approveWithTaxonomyCorrection); setDecision('approved'); setMessageTouched(false); }}>
                        Approve + correction
                      </Button>
                      <Button variant={decisionAction === MODERATOR_DECISION_ACTIONS.requestUserCorrection ? 'secondary' : 'secondary'} onClick={() => { setDecisionAction(MODERATOR_DECISION_ACTIONS.requestUserCorrection); setDecision('approved'); setMessageTouched(false); }}>
                        Request user correction
                      </Button>
                      <Button variant={decisionAction === MODERATOR_DECISION_ACTIONS.rejectForbidden ? 'danger' : 'secondary'} onClick={() => { setDecisionAction(MODERATOR_DECISION_ACTIONS.rejectForbidden); setDecision('rejected'); setMessageTouched(false); }}>
                        Reject forbidden
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Gecorrigeerde thema&apos;s</label>
                        <select multiple className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white" value={correctedThemes} onChange={(e) => setCorrectedThemes(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                          {THEMES.map((theme) => <option key={theme} value={theme}>{theme}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Gecorrigeerde triggers</label>
                        <select multiple className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white" value={correctedTriggers} onChange={(e) => setCorrectedTriggers(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                          {TRIGGERS.map((trigger) => <option key={trigger.id} value={trigger.id}>{trigger.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Reason code *</label>
                      <select
                        className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                        value={decisionReasonCode}
                        onChange={(event) => setDecisionReasonCode(event.target.value)}
                      >
                        <option value="">Selecteer reason code</option>
                        {visibleReasonCodes.map((code) => (
                          <option key={code.id} value={code.id}>{code.label}</option>
                        ))}
                      </select>
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
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-3 space-y-3">
                      <button
                        type="button"
                        onClick={() => setAdvancedOpen((prev) => !prev)}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Geavanceerd</span>
                        <span className="text-[11px] text-slate-400">{advancedOpen ? 'Verbergen' : 'Tonen'}</span>
                      </button>
                      {advancedOpen && (
                        <div className="space-y-2">
                          <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-300">Queue reason code *</label>
                            <select
                              className="mt-2 w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white"
                              value={queueFreshEvaluationReasonCode}
                              onChange={(event) => setQueueFreshEvaluationReasonCode(event.target.value)}
                            >
                              <option value="">Selecteer queue reason code</option>
                              {queueFreshEvaluationReasonCodes.map((code) => (
                                <option key={code.id} value={code.id}>{code.label}</option>
                              ))}
                            </select>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleQueueFreshEvaluation}
                            disabled={freshEvaluationPending || isLockedByOther || isReportCase}
                            className="w-full"
                          >
                            {freshEvaluationPending ? 'Opslaan...' : 'Bij volgende upload opnieuw beoordelen'}
                          </Button>
                          {isReportCase && <p className="text-[11px] text-slate-500 dark:text-slate-400">Alleen beschikbaar voor upload-cases.</p>}
                          {!isReportCase && !selectedUpload?.fingerprints && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">Geen fingerprint-data gevonden; case wordt wel uit actieve review gehaald.</p>
                          )}
                          {freshEvaluationError && <p className="text-xs text-red-500">{freshEvaluationError}</p>}
                          {freshEvaluationMessage && <p className="text-xs text-emerald-600 dark:text-emerald-400">{freshEvaluationMessage}</p>}
                        </div>
                      )}
                    </div>
                    {decisionError && <p className="text-xs text-red-500">{decisionError}</p>}
                    {decisionResultStatus && <p className="text-xs text-emerald-600 dark:text-emerald-400">{decisionResultStatus}</p>}
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
    </div>
  );
}

function ContributorMergeTool({ authUser, functionsBase, authReady }) {
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
    if (!authReady) return;
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
  }, [authReady]);

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
  authReady,
  isModeratorClient,
  profileAgeVerified,
  profileAgeVerifiedStrict,
  profileIsAdult,
  logListenerStart,
  handleListenerError,
  moderationModal,
  moderationActionPending,
  onCloseModerationModal,
  onResumeApprovedUpload,
  communityConfig,
  challengeConfig,
  configLoading,
  onSaveCommunityConfig,
  users,
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
            <ModerationSupportChat
              authReady={authReady}
              authUser={authUser}
              isModerator={isModerator}
              functionsBase={functionsBase}
            />
          ) : (
            <div className="p-6 text-sm text-slate-500 dark:text-slate-400">Log in om de chat te openen.</div>
          )}
        </div>
      )}

      {activeTab === 'review' && (
        <div className="space-y-6">
          <ModerationPanel
            moderationApiBase={moderationApiBase}
            authUser={authUser}
            isModerator={isModerator}
            authReady={authReady}
            isModeratorClient={isModeratorClient}
            profileAgeVerified={profileAgeVerified}
            profileAgeVerifiedStrict={profileAgeVerifiedStrict}
            profileIsAdult={profileIsAdult}
            logListenerStart={logListenerStart}
            handleListenerError={handleListenerError}
            caseTypeFilter="upload"
            allUsers={users}
          />
        </div>
      )}

      {activeTab === 'reports' && (
        <ModerationPanel
          moderationApiBase={moderationApiBase}
          authUser={authUser}
          isModerator={isModerator}
          authReady={authReady}
          isModeratorClient={isModeratorClient}
          profileAgeVerified={profileAgeVerified}
          profileAgeVerifiedStrict={profileAgeVerifiedStrict}
          profileIsAdult={profileIsAdult}
          logListenerStart={logListenerStart}
          handleListenerError={handleListenerError}
          caseTypeFilter="report"
          allUsers={users}
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
        <ContributorMergeTool authUser={authUser} functionsBase={functionsBase} authReady={authReady} />
      )}

      {moderationModal && (
        <ModerationDecisionModal
          message={moderationModal}
          onClose={onCloseModerationModal}
          onOpenComposer={onResumeApprovedUpload}
          pending={moderationActionPending}
          currentUserUid={authUser?.uid || null}
        />
      )}
    </div>
  );
}

function UploadModal({
  onClose,
  user,
  profile,
  users,
  isChallenge = false,
  functionsBase = '',
  moderationApiBase = '',
  resumeUploadId = null,
}) {
  const makerSelfRoles = getSelfMakerRoles(profile.roles);
  const defaultRole = makerSelfRoles[0] || profile.roles?.[0] || 'photographer';
  const selfCredit = { role: defaultRole, name: profile.displayName, uid: profile.uid, isSelf: true, consentStatus: CONTRIBUTOR_CONSENT_STATUSES.ACCEPTED };
  const triggerLabelMap = useMemo(() => new Map(TRIGGERS.map((trigger) => [trigger.id, trigger.label])), []);
  const getTriggerLabel = (id) => triggerLabelMap.get(id) || id;
  const MAX_UPLOAD_BYTES = 900 * 1024;
  const MAX_DIMENSION = 1600;

  const [step, setStep] = useState(1);
  const [image, setImage] = useState(null);
  const [imageMeta, setImageMeta] = useState(null);
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
    isMaker: false,
    makerFunction: '',
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
  const [reviewUploadId, setReviewUploadId] = useState(null);
  const [showSuggestionUI, setShowSuggestionUI] = useState(false);
  const [requiredThemes, setRequiredThemes] = useState([]);
  const [userMessage, setUserMessage] = useState('');
  const [shouldReview, setShouldReview] = useState(false);
  const [classification, setClassification] = useState(null);
  const [reviewRequested, setReviewRequested] = useState(false);
  const [taxonomyCorrection, setTaxonomyCorrection] = useState(null);
  const [correctionAcceptedAt, setCorrectionAcceptedAt] = useState(null);
  const [correctionRejectedAt, setCorrectionRejectedAt] = useState(null);
  const [correctionReviewRequestedAt, setCorrectionReviewRequestedAt] = useState(null);
  const [reviewRequestPending, setReviewRequestPending] = useState(false);
  const [resumeUpload, setResumeUpload] = useState(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeError, setResumeError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [uploaderRole, setUploaderRole] = useState(defaultRole);
  const [aiPeoplePresent, setAiPeoplePresent] = useState(false);
  const [subjectWarningAcknowledged, setSubjectWarningAcknowledged] = useState(false);
  const [missingMakerPromptShown, setMissingMakerPromptShown] = useState(false);
  const [selectedSelfMakerRole, setSelectedSelfMakerRole] = useState('photographer');
  const [pendingSelfMakerRole, setPendingSelfMakerRole] = useState(null);
  const [selfMakerRoleConfirmation, setSelfMakerRoleConfirmation] = useState({ confirmed: false, role: '', confirmedAt: null });
  const [consentException, setConsentException] = useState({ enabled: false, type: CONSENT_EXCEPTION_REASONS.STREET, reason: '' });
  const [errors, setErrors] = useState({});
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const moderationDebugEnabled = import.meta.env.DEV || import.meta.env.VITE_MODERATION_DEBUG === '1';
  const moderationTraceRef = useRef(null);
  const lastUiStateRef = useRef(null);
  const moderationEndpoint = useMemo(() => {
    const functionsBase = import.meta.env.VITE_FUNCTIONS_BASE_URL
      || import.meta.env.VITE_FUNCTIONS_BASE
      || import.meta.env.VITE_MODERATION_API_BASE;
    if (functionsBase) {
      return `${functionsBase.replace(/\/$/, '')}/moderateImage`;
    }
    return import.meta.env.VITE_MODERATION_FUNCTION_URL || '';
  }, []);

  const isResumeFlow = Boolean(resumeUploadId);
  const missingMakerPromptState = useMemo(() => getMissingMakerPromptState({
    credits,
    uploaderRole,
    profileRoles: profile.roles || [],
    missingMakerPromptShown,
    selfMakerRoleConfirmed: selfMakerRoleConfirmation.confirmed,
    selfMakerRole: selfMakerRoleConfirmation.role,
  }), [credits, uploaderRole, profile.roles, missingMakerPromptShown, selfMakerRoleConfirmation]);
  const visiblePersonPromptState = useMemo(() => getVisiblePersonPromptState({
    credits,
    uploaderRole,
    aiPeoplePresent,
    exception: consentException,
    userAcknowledgedVisiblePersonPrompt: subjectWarningAcknowledged,
  }), [credits, uploaderRole, aiPeoplePresent, consentException, subjectWarningAcknowledged]);

  const confirmSelfMakerRoleForUpload = useCallback((role) => {
    if (!isMakerRole(role)) return;
    setSelfMakerRoleConfirmation({ confirmed: true, role, confirmedAt: new Date().toISOString() });
    setUploaderRole(role);
    setPendingSelfMakerRole(null);
  }, []);

  const selectSelfMakerRoleForUpload = useCallback((role) => {
    if (!isMakerRole(role)) return;
    setSelectedSelfMakerRole(role);
    if ((profile.roles || []).includes(role)) {
      setSelfMakerRoleConfirmation({ confirmed: false, role: '', confirmedAt: null });
      setUploaderRole(role);
      return;
    }
    setPendingSelfMakerRole(role);
  }, [profile.roles]);

  useEffect(() => {
    if (missingMakerPromptState.shouldShowMissingMakerPrompt) {
      setMissingMakerPromptShown(true);
    }
  }, [missingMakerPromptState.shouldShowMissingMakerPrompt]);

  const deriveCaseId = useCallback((value) => {
    const normalized = String(value || '').trim();
    const match = normalized.match(/(SAFE_\d+|BOUDOIR_\d+|BORDERLINE_\d+|EXPLICIT_\d+)/i);
    return match ? match[1].toUpperCase() : null;
  }, []);

  const ensureModerationTrace = useCallback((seed = {}) => {
    const current = moderationTraceRef.current;
    const traceId = current?.traceId || `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const next = {
      traceId,
      uploadId: current?.uploadId || resumeUploadId || null,
      caseId: current?.caseId || deriveCaseId(title) || null,
      filename: current?.filename || null,
      userId: user?.uid || null,
      selectedThemes: selectedStyles,
      selectedSafetyTags: makerTags,
      ...current,
      ...seed,
    };
    moderationTraceRef.current = next;
    return next;
  }, [deriveCaseId, makerTags, resumeUploadId, selectedStyles, title, user?.uid]);

  const logModerationDebug = useCallback((stage, patch = {}) => {
    if (!moderationDebugEnabled) return;
    const snapshot = ensureModerationTrace(patch);
    console.debug('[upload-moderation-debug]', { stage, ...snapshot });
  }, [ensureModerationTrace, moderationDebugEnabled]);

  useEffect(() => {
    const uiShownState = outcome === 'forbidden'
      ? 'blocked'
      : (shouldReview || requiredThemes.length > 0 ? 'review' : (outcome === 'allowed' ? 'allowed' : 'pending'));
    if (lastUiStateRef.current === uiShownState) return;
    lastUiStateRef.current = uiShownState;
    logModerationDebug('ui-state-determined', {
      uiShownState,
      overlayShown: false,
      reviewShown: uiShownState === 'review',
      blockedShown: uiShownState === 'blocked',
      finalResult: uiShownState,
    });
    const trace = moderationTraceRef.current;
    if (trace?.aiParsedResult || trace?.policyResult || trace?.finalResult) {
      const mismatch = Boolean(trace?.finalResult) && trace.finalResult !== uiShownState;
      logModerationDebug('final-summary', {
        aiResult: trace?.aiParsedResult?.outcome || null,
        policyResult: trace?.policyResult || null,
        finalResult: trace?.finalResult || null,
        uiShownState,
        mismatch,
      });
    }
  }, [logModerationDebug, outcome, requiredThemes.length, shouldReview]);

  useEffect(() => {
    if (!resumeUploadId || !user?.uid) {
      setResumeUpload(null);
      setResumeLoading(false);
      setResumeError('');
      return;
    }
    let active = true;
    const loadUpload = async () => {
      setResumeLoading(true);
      setResumeError('');
      try {
        const db = getFirebaseDbInstance();
        const uploadSnap = await getDoc(doc(db, 'uploads', resumeUploadId));
        if (!active) return;
        if (!uploadSnap.exists()) {
          setResumeUpload(null);
          setResumeError('De goedgekeurde upload is niet gevonden.');
          return;
        }
        const uploadData = uploadSnap.data() || {};
        const ownerId = uploadData.userId || uploadData.ownerUid || uploadData.userUid || null;
        if (ownerId !== user.uid) {
          setResumeUpload(null);
          setResumeError('Deze upload hoort niet bij jouw account.');
          return;
        }
        const draft = uploadData.postDraft || {};
        const nextImage = String(draft.imageUrl || uploadData.imageUrl || uploadData.imageRef || '').trim();
        if (!nextImage) {
          setResumeUpload(null);
          setResumeError('Deze upload mist een afbeelding en kan niet hervat worden.');
          return;
        }
        setResumeUpload({ id: uploadSnap.id, ...uploadData });
        setImage(nextImage);
        const draftImageMeta = draft.imageMeta && typeof draft.imageMeta === 'object' ? draft.imageMeta : null;
        setImageMeta(draftImageMeta);
        setTitle(String(draft.title || uploadData.title || uploadData.caption || '').trim());
        setDesc(String(draft.description || draft.caption || uploadData.description || uploadData.caption || '').trim());
        setSelectedStyles(Array.isArray(draft.styles)
          ? draft.styles.filter(Boolean)
          : Array.isArray(draft.themes)
            ? draft.themes.filter(Boolean)
            : []);
        const nextCredits = Array.isArray(draft.credits)
          ? draft.credits.filter(Boolean)
          : Array.isArray(draft.contributors)
            ? draft.contributors.filter(Boolean)
            : [];
        if (nextCredits.length > 0) {
          setCredits(nextCredits);
        }
        const nextMakerTags = Array.isArray(draft.makerTags)
          ? draft.makerTags.filter(Boolean)
          : Array.isArray(uploadData.makerTags)
            ? uploadData.makerTags.filter(Boolean)
            : [];
        const nextAppliedTriggers = Array.isArray(draft.appliedTriggers)
          ? draft.appliedTriggers.filter(Boolean)
          : Array.isArray(uploadData.appliedTriggers)
            ? uploadData.appliedTriggers.filter(Boolean)
            : [];
        setMakerTags(nextMakerTags);
        setAppliedTriggers(nextAppliedTriggers);
        setOutcome(uploadData.outcome || 'allowed');
        setForbiddenReasons(Array.isArray(uploadData.forbiddenReasons) ? uploadData.forbiddenReasons : []);
        setReviewCaseId(uploadData.reviewCaseId || null);
        setReviewUploadId(uploadSnap.id);
        setRequiredThemes([]);
        setShouldReview(false);
        setShowSuggestionUI(false);
        const moderatorTaxonomy = uploadData.correctedTaxonomy || uploadData?.moderatorDecision?.correctedTaxonomy || null;
        const needsAcceptance = uploadData.requiresUploaderAcceptance === true && uploadData.publicationStatus === 'needs_user_correction';
        if (needsAcceptance && moderatorTaxonomy) {
          setTaxonomyCorrection({
            type: TAXONOMY_CORRECTION_TYPES.SAFE,
            suggestedThemes: Array.isArray(moderatorTaxonomy.themes) ? moderatorTaxonomy.themes : [],
            suggestedTriggers: Array.isArray(moderatorTaxonomy.triggers) ? moderatorTaxonomy.triggers : [],
            originalThemes: Array.isArray(draft.styles) ? draft.styles : [],
            originalTriggers: Array.isArray(draft.makerTags) ? draft.makerTags : [],
            reason: String(uploadData?.moderatorDecision?.reasonCode || uploadData?.moderatorDecision?.note || 'Moderator vroeg om categorie-correctie.'),
            requiresUserAcceptance: true,
            requiresModeratorReview: true,
            publishBlocked: true,
            fromModeratorReview: true,
          });
        }
        setUploaderRole(String(draft.authorRole || uploadData.authorRole || defaultRole));
        setStep(2);
      } catch (error) {
        if (!active) return;
        setResumeUpload(null);
        setResumeError('Hervatten mislukt. Probeer het opnieuw via de chat.');
      } finally {
        if (active) {
          setResumeLoading(false);
        }
      }
    };

    loadUpload();
    return () => {
      active = false;
    };
  }, [resumeUploadId, user?.uid, defaultRole]);
  const [allowExternalOverride, setAllowExternalOverride] = useState(false);

  const deriveTaxonomyCorrection = useCallback((payload = {}) => {
    const nextOutcome = payload?.outcome ?? outcome;
    const nextRequiredThemes = Array.isArray(payload?.requiredThemes) ? payload.requiredThemes : requiredThemes;
    const nextSuggestedTriggers = Array.isArray(payload?.suggestedTriggers) ? payload.suggestedTriggers : suggestedTriggers;
    const nextShouldReview = payload?.shouldReview ?? shouldReview;
    const nextForbiddenReasons = Array.isArray(payload?.forbiddenReasons) ? payload.forbiddenReasons : forbiddenReasons;
    const nextMessage = payload?.userMessage ?? userMessage;

    if (nextOutcome === 'forbidden') {
      return {
        type: TAXONOMY_CORRECTION_TYPES.FORBIDDEN,
        suggestedThemes: [],
        suggestedTriggers: [],
        reason: nextForbiddenReasons[0] || 'Inhoud is expliciet of verboden.',
        requiresUserAcceptance: false,
        requiresModeratorReview: true,
        publishBlocked: true,
      };
    }
    if (nextShouldReview) {
      return {
        type: TAXONOMY_CORRECTION_TYPES.REVIEW_REQUIRED,
        suggestedThemes: nextRequiredThemes,
        suggestedTriggers: nextSuggestedTriggers,
        reason: nextMessage || 'Onzekere classificatie; handmatige review vereist.',
        requiresUserAcceptance: false,
        requiresModeratorReview: true,
        publishBlocked: true,
      };
    }
    if (nextRequiredThemes.length > 0) {
      const suggestedTriggerKeys = nextSuggestedTriggers.map(normalizeSensitiveTriggerKey).filter(Boolean);
      const selectedTriggerKeys = makerTags.map(normalizeSensitiveTriggerKey).filter(Boolean);
      const sensitiveBoundary = nextRequiredThemes.some(isSensitiveThemeValue)
        || selectedStyles.some(isSensitiveThemeValue)
        || suggestedTriggerKeys.some((key) => SENSITIVE_TRIGGER_KEYS.has(key))
        || selectedTriggerKeys.some((key) => SENSITIVE_TRIGGER_KEYS.has(key));
      return {
        type: sensitiveBoundary ? TAXONOMY_CORRECTION_TYPES.SENSITIVE : TAXONOMY_CORRECTION_TYPES.SAFE,
        suggestedThemes: nextRequiredThemes,
        suggestedTriggers: suggestedTriggerKeys,
        originalThemes: [...selectedStyles],
        originalTriggers: [...makerTags],
        reason: nextMessage || 'De gekozen categorie lijkt niet te passen.',
        requiresUserAcceptance: true,
        requiresModeratorReview: sensitiveBoundary,
        publishBlocked: true,
      };
    }
    return null;
  }, [forbiddenReasons, makerTags, outcome, requiredThemes, selectedStyles, shouldReview, suggestedTriggers, userMessage]);

  const handleAcceptTaxonomyCorrection = async () => {
    if (!taxonomyCorrection || taxonomyCorrection.type !== TAXONOMY_CORRECTION_TYPES.SAFE) return;
    const nextThemes = Array.from(new Set((taxonomyCorrection.suggestedThemes || []).filter(Boolean)));
    const nextTriggers = Array.from(new Set((taxonomyCorrection.suggestedTriggers || []).map(resolveTriggerKey).filter(Boolean)));
    setSelectedStyles(nextThemes);
    setMakerTags(nextTriggers);

    if (taxonomyCorrection?.fromModeratorReview && moderationApiBase && user?.uid && resumeUpload?.id) {
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${moderationApiBase}/userModerationAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ uploadId: resumeUpload.id, action: 'acceptCorrection' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Opslaan van correctie mislukt.');
        setCorrectionAcceptedAt(Timestamp.now());
      } catch (error) {
        setErrors((prev) => ({ ...prev, moderation: error?.message || 'Correctie opslaan mislukt.' }));
        return;
      }
    } else {
      setCorrectionAcceptedAt(Timestamp.now());
    }

    setOutcome('allowed');
    setShouldReview(false);
    setTaxonomyCorrection((prev) => (prev ? {
      ...prev,
      type: TAXONOMY_CORRECTION_TYPES.SAFE,
      requiresModeratorReview: false,
      publishBlocked: false,
      finalAcceptedThemes: nextThemes,
      finalAcceptedTriggers: nextTriggers,
    } : prev));
    setErrors((prev) => ({ ...prev, moderation: undefined, styles: undefined }));
  };

  const handleRejectTaxonomyCorrection = async () => {
    if (taxonomyCorrection?.fromModeratorReview && moderationApiBase && user?.uid && resumeUpload?.id) {
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${moderationApiBase}/userModerationAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ uploadId: resumeUpload.id, action: 'rejectCorrection' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Reviewverzoek versturen mislukt.');
      } catch (error) {
        setErrors((prev) => ({ ...prev, moderation: error?.message || 'Reviewverzoek versturen mislukt.' }));
        return;
      }
    }
    setCorrectionRejectedAt(Timestamp.now());
    setCorrectionReviewRequestedAt(Timestamp.now());
  };


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

  const resolveImageOrientation = (aspectRatio) => {
    if (aspectRatio >= 2.8) return 'panorama';
    if (aspectRatio >= 1.2) return 'landscape';
    if (aspectRatio <= 0.8) return 'portrait';
    return 'square';
  };

  const preprocessImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file-read-failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image-processing-failed'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / img.width, MAX_DIMENSION / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('image-processing-failed'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        let quality = 0.9;
        const initialQuality = quality;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (toDataUrlSize(dataUrl) > MAX_UPLOAD_BYTES && quality > 0.5) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        let outputCanvas = canvas;
        let forcedResize = false;
        if (toDataUrlSize(dataUrl) > MAX_UPLOAD_BYTES) {
          const ratio = Math.sqrt(MAX_UPLOAD_BYTES / toDataUrlSize(dataUrl));
          const resizedCanvas = document.createElement('canvas');
          resizedCanvas.width = Math.max(1, Math.floor(canvas.width * ratio));
          resizedCanvas.height = Math.max(1, Math.floor(canvas.height * ratio));
          const resizedCtx = resizedCanvas.getContext('2d');
          if (!resizedCtx) {
            reject(new Error('image-processing-failed'));
            return;
          }
          resizedCtx.drawImage(canvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
          dataUrl = resizedCanvas.toDataURL('image/jpeg', 0.7);
          outputCanvas = resizedCanvas;
          forcedResize = true;
          quality = 0.7;
        }

        const width = outputCanvas.width;
        const height = outputCanvas.height;
        const aspectRatio = Number((width / Math.max(height, 1)).toFixed(4));

        resolve({
          dataUrl,
          width,
          height,
          sizeBytes: toDataUrlSize(dataUrl),
          aspectRatio,
          orientation: resolveImageOrientation(aspectRatio),
          wasResized: scale < 1 || forcedResize,
          wasCompressed: quality < initialQuality,
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const initialTrace = {
      traceId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      uploadId: resumeUploadId || null,
      caseId: deriveCaseId(file.name) || deriveCaseId(title) || null,
      filename: file.name || null,
      userId: user?.uid || null,
      selectedThemes: selectedStyles,
      selectedSafetyTags: makerTags,
      moderateImageCalled: false,
      firestoreWriteAttempted: false,
      firestoreWriteSucceeded: false,
    };
    moderationTraceRef.current = initialTrace;
    logModerationDebug('file-selected', initialTrace);

    try {
      const processedImage = await preprocessImage(file);
      setImage(processedImage.dataUrl);
      setImageMeta(processedImage);
      setStep(2);
      setErrors(prev => ({ ...prev, image: undefined, upload: undefined }));
      setAiError('');
      setMakerTags([]);
      setAppliedTriggers([]);
      setSuggestedTriggers([]);
      setOutcome(null);
      setForbiddenReasons([]);
      setReviewCaseId(null);
      setReviewUploadId(null);
      setShowSuggestionUI(false);
      setRequiredThemes([]);
      setUserMessage('');
      setShouldReview(false);
      setClassification(null);
      setReviewRequested(false);
      setTaxonomyCorrection(null);
      setCorrectionAcceptedAt(null);
      setCorrectionRejectedAt(null);
      setCorrectionReviewRequestedAt(null);
      setAiPeoplePresent(false);
      setSubjectWarningAcknowledged(false);
      setMissingMakerPromptShown(false);
      setPendingSelfMakerRole(null);
      setSelfMakerRoleConfirmation({ confirmed: false, role: '', confirmedAt: null });
      setConsentException({ enabled: false, type: CONSENT_EXCEPTION_REASONS.STREET, reason: '' });
      logModerationDebug('file-processed', { previewSource: 'local-file', previewField: null });
    } catch (error) {
      console.error('Image processing failed', error);
      logModerationDebug('file-processing-failed', {
        finalResult: 'error',
        finalReason: error?.message || 'image-processing-failed',
      });
      const reason = error?.message === 'file-read-failed' ? 'Bestand lezen mislukt. Kies een ander bestand en probeer opnieuw.' : 'Afbeelding verwerken mislukt. Probeer een ander bestand.';
      setErrors(prev => ({ ...prev, image: reason }));
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
    logModerationDebug('before-moderate-image', {
      moderateImageCalled: true,
      selectedThemes: selectedStyles,
      selectedSafetyTags: makerTags,
    });

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
        body: JSON.stringify({ image, makerTags, themes: selectedStyles }),
      });

      if (!response.ok) {
        logModerationDebug('after-moderate-image-response', {
          moderateImageHttpStatus: response.status,
          finalResult: 'error',
          finalReason: 'moderate-image-http-error',
        });
        throw new Error('ai-moderation-endpoint-failed');
      }

      const data = await response.json();
      const getTriggerKeys = (items) => (Array.isArray(items) ? items : [])
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') return item.trigger;
          return null;
        })
        .filter(Boolean);
      const nextAppliedTriggers = (Array.isArray(data.appliedTriggers) ? data.appliedTriggers : [])
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') return item.trigger;
          return null;
        })
        .filter(Boolean);
      const nextSuggestedTriggers = (Array.isArray(data.suggestedTriggers) ? data.suggestedTriggers : [])
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') return item.trigger;
          return null;
        })
        .filter(Boolean);
      const nextOutcome = data?.outcome ?? null;
      const nextClassification = data?.classification ?? null;
      const nextForbiddenReasons = (Array.isArray(data.forbiddenReasons) ? data.forbiddenReasons : [])
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') return item.reason || item.trigger;
          return null;
        })
        .filter(Boolean);
      const nextReviewCaseId = data?.reviewCaseId ?? null;
      const nextUploadId = data?.uploadId ?? null;
      const nextPreviewField = typeof data?.previewField === 'string' && data.previewField.trim()
        ? data.previewField.trim()
        : null;
      const nextRequiredThemes = Array.isArray(data?.requiredThemes) ? data.requiredThemes : [];
      const nextAutoAppliedTriggers = (Array.isArray(data?.autoAppliedTriggers) ? data.autoAppliedTriggers : []).map(resolveTriggerKey).filter(Boolean);
      const peopleSignal = data?.peoplePresent ?? data?.personPresent ?? data?.visiblePeople ?? data?.hasPeople ?? null;
      const nextAiPeoplePresent = peopleSignal === true
        || (typeof peopleSignal === 'number' && peopleSignal > 0)
        || (Array.isArray(peopleSignal) && peopleSignal.length > 0);
      const normalizedAppliedTriggers = Array.from(new Set([...nextAppliedTriggers.map(resolveTriggerKey), ...nextAutoAppliedTriggers]));
      const shouldShowSuggestions = nextOutcome === 'allowed' && nextSuggestedTriggers.length > 0;

      logModerationDebug('after-moderate-image-response', {
        moderateImageHttpStatus: response.status,
        aiRawSummary: {
          outcome: data?.outcome ?? null,
          shouldReview: Boolean(data?.shouldReview),
          reviewCaseId: data?.reviewCaseId ?? null,
        },
        uploadId: nextUploadId || moderationTraceRef.current?.uploadId || null,
        previewField: nextPreviewField,
        previewSource: nextPreviewField || (nextUploadId ? 'linked-upload' : null),
      });

      if (moderationDebugEnabled) {
        console.debug('[moderateImage]', {
          endpoint: moderationEndpoint,
          outcome: nextOutcome,
          classification: nextClassification,
          shouldReview: Boolean(data?.shouldReview),
          reviewCaseId: nextReviewCaseId,
          debugPath: data?.debug?.path || null,
          matchedUploadId: data?.debug?.matchedUploadId || null,
          matchedFingerprintType: data?.debug?.matchedFingerprintType || null,
          forbiddenReasonTriggerKeys: getTriggerKeys(data?.forbiddenReasons),
          suggestedTriggerKeys: getTriggerKeys(data?.suggestedTriggers),
          appliedTriggerKeys: normalizedAppliedTriggers,
          autoAppliedTriggers: nextAutoAppliedTriggers,
        });
        if (nextUploadId && nextPreviewField) {
          console.debug('[moderateImage.previewLinked]', {
            uploadId: nextUploadId,
            reviewCaseId: nextReviewCaseId,
            previewField: nextPreviewField,
          });
        }
      }

      const parsedPolicyResult = nextOutcome === 'forbidden'
        ? 'blocked'
        : (Boolean(data?.shouldReview) || nextRequiredThemes.length > 0 ? 'review_required' : 'allowed');
      const parsedPolicyReason = nextOutcome === 'forbidden'
        ? (nextForbiddenReasons[0] || 'forbidden')
        : (data?.shouldReview
          ? 'manual-review-required'
          : (nextRequiredThemes.length > 0 ? `missing-theme:${nextRequiredThemes.join(',')}` : 'policy-clear'));
      const parsedFinalResult = parsedPolicyResult === 'blocked' ? 'blocked' : (parsedPolicyResult === 'review_required' ? 'review' : 'allowed');
      logModerationDebug('after-parse-mapping', {
        aiParsedResult: {
          outcome: nextOutcome,
          classification: nextClassification,
          shouldReview: Boolean(data?.shouldReview),
          requiredThemes: nextRequiredThemes,
          forbiddenReasons: nextForbiddenReasons,
        },
        aiReason: nextClassification || null,
        policyResult: parsedPolicyResult,
        policyReason: parsedPolicyReason,
        finalResult: parsedFinalResult,
        finalReason: parsedPolicyReason,
      });

      setAppliedTriggers(normalizedAppliedTriggers);
      setSuggestedTriggers(nextSuggestedTriggers.map(resolveTriggerKey));
      setOutcome(nextOutcome);
      setForbiddenReasons(nextForbiddenReasons);
      setReviewCaseId(nextReviewCaseId);
      setReviewUploadId(nextUploadId);
      setRequiredThemes(nextRequiredThemes);
      setUserMessage(data?.userMessage || '');
      setShouldReview(Boolean(data?.shouldReview));
      setClassification(nextClassification);
      setAiPeoplePresent(nextAiPeoplePresent);
      if (!nextAiPeoplePresent || hasVisibleSubjectCredit(credits)) setSubjectWarningAcknowledged(false);
      setShowSuggestionUI(shouldShowSuggestions);
      setReviewRequested(false);
      setTaxonomyCorrection(deriveTaxonomyCorrection({
        outcome: nextOutcome,
        requiredThemes: nextRequiredThemes,
        suggestedTriggers: nextSuggestedTriggers.map(resolveTriggerKey),
        shouldReview: Boolean(data?.shouldReview),
        forbiddenReasons: nextForbiddenReasons,
        userMessage: data?.userMessage || '',
      }));
      setCorrectionAcceptedAt(null);
      setCorrectionRejectedAt(null);
      setCorrectionReviewRequestedAt(null);
      return {
        ...data,
        appliedTriggers: normalizedAppliedTriggers,
        suggestedTriggers: nextSuggestedTriggers.map(resolveTriggerKey),
        forbiddenReasons: nextForbiddenReasons,
        requiredThemes: nextRequiredThemes,
        userMessage: data?.userMessage || '',
        shouldReview: Boolean(data?.shouldReview),
        classification: nextClassification,
        peoplePresent: nextAiPeoplePresent,
      };
    } catch (error) {
      console.error('AI check failed', error);
      logModerationDebug('after-parse-mapping', {
        finalResult: 'error',
        finalReason: error?.message || 'ai-check-failed',
      });
      if (!silent) {
        setAiError(error?.message === 'ai-moderation-endpoint-failed' ? 'AI moderatie endpoint is niet bereikbaar. Probeer het opnieuw.' : 'Afbeelding modereren mislukt. Probeer het opnieuw.');
      }
      setAppliedTriggers([]);
      setSuggestedTriggers([]);
      setOutcome(null);
      setForbiddenReasons([]);
      setReviewCaseId(null);
      setReviewUploadId(null);
      setShowSuggestionUI(false);
      setRequiredThemes([]);
      setUserMessage('');
      setShouldReview(false);
      setClassification(null);
      setReviewRequested(false);
      setTaxonomyCorrection(null);
      setCorrectionAcceptedAt(null);
      setCorrectionRejectedAt(null);
      setCorrectionReviewRequestedAt(null);
      setAiPeoplePresent(false);
      setSubjectWarningAcknowledged(false);
      setMissingMakerPromptShown(false);
      setPendingSelfMakerRole(null);
      setSelfMakerRoleConfirmation({ confirmed: false, role: '', confirmedAt: null });
      return null;
    } finally {
      setAiLoading(false);
    }
  };

  const handleRequestReview = async () => {
    if (reviewRequestPending) return;
    if (!user) {
      setAiError('Je moet ingelogd zijn om een review aan te vragen.');
      return;
    }
    if (!functionsBase) {
      setAiError('Geen functions-endpoint ingesteld. Review aanvragen is nu niet beschikbaar.');
      return;
    }

    setReviewRequestPending(true);
    setAiError('');

    try {
      const token = await user.getIdToken();
      const uploadId = reviewUploadId || null;
      if (!uploadId) {
        throw new Error('Geen upload-ID beschikbaar. Voer eerst de AI-check uit en probeer opnieuw.');
      }

      const caseResponse = await fetch(`${functionsBase}/requestUploadReviewCase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          uploadId,
          postDraft: {
            title,
            description: desc,
            imageUrl: image,
            ...(imageMeta ? {
              imageMeta: {
                width: imageMeta.width,
                height: imageMeta.height,
                aspectRatio: imageMeta.aspectRatio,
                orientation: imageMeta.orientation,
                sizeBytes: imageMeta.sizeBytes,
              },
            } : {}),
            authorName: profile.displayName,
            authorRole: uploaderRole,
            styles: selectedStyles,
            makerTags,
            appliedTriggers,
            credits,
            isChallenge,
          },
        }),
      });
      const caseData = await caseResponse.json().catch(() => ({}));
      if (!caseResponse.ok) {
        throw new Error(caseData?.error || 'Kon geen review-case aanmaken.');
      }
      const ensuredReviewCaseId = caseData?.reviewCaseId || null;
      setReviewCaseId(ensuredReviewCaseId);

      const ensureResponse = await fetch(`${functionsBase}/ensureModerationThread`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const ensureData = await ensureResponse.json().catch(() => ({}));
      if (!ensureResponse.ok) {
        throw new Error(ensureData?.error || 'Kon moderatiedraad niet openen.');
      }

      const threadId = ensureData?.threadId || `support_${user.uid}`;
      const triggerContext = Array.from(new Set([...(appliedTriggers || []), ...(makerTags || [])].map(resolveTriggerKey)));
      const reviewMessage = [
        '[UPLOAD_REVIEW_REQUEST]',
        `classification: ${classification || 'unknown'}`,
        `shouldReview: ${Boolean(shouldReview)}`,
        `reviewCaseId: ${ensuredReviewCaseId || 'none'}`,
        `outcome: ${outcome || 'unknown'}`,
        `title: ${(title || '').trim() || '(geen titel)'}`,
        `themes: ${selectedStyles.length > 0 ? selectedStyles.join(', ') : 'none'}`,
        `triggers: ${triggerContext.length > 0 ? triggerContext.join(', ') : 'none'}`,
        `requiredThemes: ${requiredThemes.length > 0 ? requiredThemes.join(', ') : 'none'}`,
      ].join('\n');

      const sendResponse = await fetch(`${functionsBase}/sendSupportMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ threadId, text: reviewMessage }),
      });
      const sendData = await sendResponse.json().catch(() => ({}));
      if (!sendResponse.ok) {
        console.warn('Reviewcase aangemaakt, maar supportbericht versturen mislukt.', sendData?.error || 'unknown error');
      }

      setReviewRequested(true);
      setCorrectionReviewRequestedAt(Timestamp.now());
    } catch (error) {
      setReviewRequested(false);
      setAiError(error?.message || 'Reviewverzoek versturen mislukt. Probeer opnieuw.');
    } finally {
      setReviewRequestPending(false);
    }
  };

  const getNewCreditMakerFields = useCallback((credit = newCredit) => {
    const makerFunction = String(credit.makerFunction || '').trim();
    if (isMakerRole(credit.role)) return { isMaker: true, makerFunction: credit.role };
    if (credit.isMaker && makerFunction) return { isMaker: true, makerFunction };
    return { isMaker: false, makerFunction: null };
  }, [newCredit]);

  const addCredit = async (foundUser) => {
     if(foundUser) {
        setCredits((prev) => ([...prev, normalizeConsentCredit({ role: newCredit.role, name: foundUser.displayName, uid: foundUser.uid, contributorId: foundUser.contributorId || null, ...getNewCreditMakerFields() }, { exception: consentException })]));
        setContributorSearch('');
        setAllowExternalOverride(false);
        setNewCredit({ role: newCredit.role, name: '', instagramHandle: '', website: '', email: '', isMaker: isMakerRole(newCredit.role), makerFunction: isMakerRole(newCredit.role) ? newCredit.role : '' });
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
       normalizeConsentCredit({
         role: newCredit.role,
         name: displayName,
         contributorId,
         instagramHandle: normalizedInstagram || null,
         website: normalizedWebsite || null,
         email: normalizedEmail || null,
         isExternal: true,
         ...getNewCreditMakerFields(),
       }, { exception: consentException }),
     ]));
     setContributorSearch('');
     setAllowExternalOverride(false);
     setNewCredit({ role: 'model', name: '', instagramHandle: '', website: '', email: '', isMaker: false, makerFunction: '' });
     setShowInvite(false);
  };

  const addAnonymousContributor = (roleOverride = newCredit.role) => {
    setCredits((prev) => ([
      ...prev,
      normalizeConsentCredit({
        role: roleOverride,
        name: 'Anonieme bijdrager',
        isAnonymous: true,
        isExternal: true,
      }, { exception: consentException }),
    ]));
    setContributorSearch('');
    setNewCredit({ role: 'model', name: '', instagramHandle: '', website: '', email: '', isMaker: false, makerFunction: '' });
    setShowInvite(false);
  };

  useEffect(() => {
    setCredits((prev) => {
      const existingSelf = prev.find((c) => c.isSelf);
      if (existingSelf && existingSelf.role === uploaderRole && existingSelf.name === profile.displayName && existingSelf.uid === profile.uid) {
        const others = prev.filter((c) => !c.isSelf);
        return [{ ...existingSelf, consentStatus: CONTRIBUTOR_CONSENT_STATUSES.ACCEPTED, consentRequired: false }, ...others];
      }
      const others = prev.filter((c) => !c.isSelf);
      return [{ role: uploaderRole, name: profile.displayName, uid: profile.uid, isSelf: true, consentStatus: CONTRIBUTOR_CONSENT_STATUSES.ACCEPTED, consentRequired: false }, ...others];
    });
  }, [uploaderRole, profile.displayName, profile.uid]);

  const toggleStyle = (theme) => {
    setSelectedStyles((prev) => {
      const next = prev.includes(theme) ? prev.filter((x) => x !== theme) : [...prev, theme];
      const hasArtNude = next.includes('Art Nude');
      setMakerTags((prevTags) => {
        const normalized = Array.from(new Set(prevTags.map(resolveTriggerKey)));
        if (hasArtNude && !normalized.includes('adultArtNude')) return [...normalized, 'adultArtNude'];
        if (!hasArtNude) return normalized;
        return normalized;
      });
      return next;
    });
    setErrors(prev => ({ ...prev, styles: undefined, moderation: undefined }));
  };

  const handlePublish = async ({ applySuggestions = false } = {}) => {
    const validationErrors = {};
    const normalizeTheme = (theme) => String(theme || '').trim().toLowerCase();
    const getMissingRequiredThemes = (themes = []) => {
      const selectedThemeSet = new Set(selectedStyles.map(normalizeTheme));
      return themes.filter((theme) => !selectedThemeSet.has(normalizeTheme(theme)));
    };

    if (!image) validationErrors.image = 'Voeg een afbeelding toe.';
    if (selectedStyles.length === 0) validationErrors.styles = 'Thema ontbreekt. Kies minstens één thema.';
    if (taxonomyCorrection?.type === TAXONOMY_CORRECTION_TYPES.FORBIDDEN) {
      validationErrors.moderation = 'Deze publicatie is geblokkeerd door de safety check.';
    }
    if (taxonomyCorrection?.type === TAXONOMY_CORRECTION_TYPES.REVIEW_REQUIRED || taxonomyCorrection?.requiresModeratorReview) {
      validationErrors.moderation = 'Deze upload vereist eerst een handmatige review voordat je kunt publiceren.';
    }
    if (taxonomyCorrection?.requiresUserAcceptance && !correctionAcceptedAt) {
      validationErrors.moderation = 'Accepteer eerst de taxonomie-correctie of vraag review aan.';
    }
    const missingRequiredThemes = getMissingRequiredThemes(requiredThemes);
    if (missingRequiredThemes.length > 0) validationErrors.moderation = `Voeg eerst thema toe: ${missingRequiredThemes.join(', ')}.`;
    if (shouldReview) validationErrors.moderation = 'Deze upload vereist eerst een handmatige review voordat je kunt publiceren.';
    if (outcome === 'forbidden') validationErrors.moderation = 'Deze publicatie is geblokkeerd door de safety check.';
    const consentValidation = validateUploadConsent({
      credits,
      uploaderRole,
      profileRoles: profile.roles || [],
      exception: consentException,
      aiPeoplePresent,
      subjectWarningAcknowledged,
      selfMakerRoleConfirmed: selfMakerRoleConfirmation.confirmed,
      selfMakerRole: selfMakerRoleConfirmation.role,
    });
    Object.assign(validationErrors, consentValidation);

    if (Object.keys(validationErrors).length > 0) {
      const nextFinalResult = validationErrors.moderation?.includes('review') ? 'review' : (validationErrors.moderation?.includes('geblokkeerd') ? 'blocked' : 'validation_error');
      logModerationDebug('after-policy-gating', {
        policyResult: nextFinalResult === 'review' ? 'review_required' : (nextFinalResult === 'blocked' ? 'blocked' : 'validation_error'),
        policyReason: validationErrors.moderation || 'validation-failed',
        finalResult: nextFinalResult,
        finalReason: validationErrors.moderation || 'validation-failed',
        publishAllowed: false,
      });
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
      logModerationDebug('after-policy-gating', {
        policyResult: 'blocked',
        policyReason: 'outcome-forbidden',
        finalResult: 'blocked',
        finalReason: 'outcome-forbidden',
        publishAllowed: false,
      });
      setErrors((prev) => ({ ...prev, moderation: 'Deze publicatie is geblokkeerd door de safety check.' }));
      return;
    }

    const effectiveAppliedTriggers = moderationData
      ? (Array.isArray(moderationData.policyAppliedTriggers) ? moderationData.policyAppliedTriggers : (Array.isArray(moderationData.appliedTriggers) ? moderationData.appliedTriggers : []))
      : appliedTriggers;
    const effectiveForbiddenReasons = moderationData
      ? (Array.isArray(moderationData.forbiddenReasons) ? moderationData.forbiddenReasons : [])
      : forbiddenReasons;
    const effectiveReviewCaseId = moderationData?.reviewCaseId ?? reviewCaseId;
    const effectiveRequiredThemes = moderationData?.requiredThemes ?? requiredThemes;
    const effectiveShouldReview = moderationData?.shouldReview ?? shouldReview;
    const effectiveMissingRequiredThemes = getMissingRequiredThemes(effectiveRequiredThemes);

    if (effectiveMissingRequiredThemes.length > 0) {
      logModerationDebug('after-policy-gating', {
        policyResult: 'review_required',
        policyReason: `missing-required-themes:${effectiveMissingRequiredThemes.join(',')}`,
        finalResult: 'review',
        finalReason: 'required-theme-missing',
        publishAllowed: false,
      });
      setErrors((prev) => ({ ...prev, moderation: `Deze content is toegestaan maar vereist thema: ${effectiveMissingRequiredThemes.join(', ')}.` }));
      return;
    }
    if (effectiveShouldReview) {
      logModerationDebug('after-policy-gating', {
        policyResult: 'review_required',
        policyReason: 'manual-review-required',
        finalResult: 'review',
        finalReason: 'manual-review-required',
        publishAllowed: false,
      });
      setErrors((prev) => ({ ...prev, moderation: 'Deze upload vereist eerst een handmatige review voordat je kunt publiceren.' }));
      return;
    }
    const baseTriggers = sanitizeDiagnosticTriggerKeys(effectiveAppliedTriggers.length ? effectiveAppliedTriggers : makerTags);
    const finalAppliedTriggers = applySuggestions
      ? Array.from(new Set([...baseTriggers, ...suggestedTriggers]))
      : baseTriggers;
    const triggerFlag = finalAppliedTriggers.length > 0;
    const normalizedException = normalizeConsentException(consentException);
    const consentCredits = credits.map((credit) => normalizeConsentCredit(credit, { exception: normalizedException }));
    const missingMakerPromptForPublish = getMissingMakerPromptState({
      credits: consentCredits,
      uploaderRole,
      profileRoles: profile.roles || [],
      missingMakerPromptShown,
      selfMakerRoleConfirmed: selfMakerRoleConfirmation.confirmed,
      selfMakerRole: selfMakerRoleConfirmation.role,
    });
    const visiblePersonPromptForPublish = getVisiblePersonPromptState({
      credits: consentCredits,
      uploaderRole,
      aiPeoplePresent,
      exception: normalizedException,
      userAcknowledgedVisiblePersonPrompt: subjectWarningAcknowledged,
    });
    const consentTimestamp = Timestamp.now();
    const uploadConsent = buildUploadConsent({
      credits: consentCredits,
      exception: normalizedException,
      aiPeoplePresent,
      subjectWarningAcknowledged,
      uploaderRole,
      profileRoles: profile.roles || [],
      visiblePersonPromptResolvedAt: visiblePersonPromptForPublish.resolvedBy ? consentTimestamp : null,
      missingMakerPromptShown: missingMakerPromptForPublish.missingMakerPromptShown,
      missingMakerPromptResolvedAt: missingMakerPromptForPublish.missingMakerPromptResolved ? consentTimestamp : null,
      selfMakerRoleConfirmed: selfMakerRoleConfirmation.confirmed,
      selfMakerRole: selfMakerRoleConfirmation.role,
      selfMakerRoleConfirmedAt: selfMakerRoleConfirmation.confirmed ? consentTimestamp : null,
    });
    const consentAudit = uploadConsent.audit.map((entry) => ({
      ...entry,
      at: consentTimestamp,
      actorUid: user.uid,
    }));
    const correctionMetadata = taxonomyCorrection ? {
      correction: {
        type: taxonomyCorrection.type,
        suggestedThemes: taxonomyCorrection.suggestedThemes || [],
        suggestedTriggers: taxonomyCorrection.suggestedTriggers || [],
        originalSelectedThemes: taxonomyCorrection.originalThemes || selectedStyles,
        originalSelectedTriggers: taxonomyCorrection.originalTriggers || makerTags,
        finalAcceptedThemes: [...selectedStyles],
        finalAcceptedTriggers: [...makerTags],
        reason: taxonomyCorrection.reason || '',
        requiresUserAcceptance: Boolean(taxonomyCorrection.requiresUserAcceptance),
        requiresModeratorReview: taxonomyCorrection.type === TAXONOMY_CORRECTION_TYPES.SAFE ? false : Boolean(taxonomyCorrection.requiresModeratorReview),
        publishBlocked: taxonomyCorrection.type === TAXONOMY_CORRECTION_TYPES.SAFE ? false : Boolean(taxonomyCorrection.publishBlocked),
        userAcceptedAt: correctionAcceptedAt || null,
        userRejectedAt: correctionRejectedAt || null,
        reviewRequestedAt: correctionReviewRequestedAt || null,
      },
    } : {};

    setPublishing(true);
    setPublishError('');
    logModerationDebug('after-policy-gating', {
      policyResult: 'allowed',
      policyReason: 'policy-clear',
      finalResult: 'allowed',
      finalReason: 'ready-to-publish',
      publishAllowed: true,
    });

    try {
      if (isResumeFlow && resumeUpload?.reviewStatus === 'approved' && resumeUpload?.publicationStatus === 'pending') {
        if (!moderationApiBase) {
          throw new Error('Publiceren is tijdelijk niet beschikbaar. Probeer opnieuw via de chat.');
        }
        logModerationDebug('before-firestore-write', { firestoreWriteAttempted: true, writeTarget: 'uploads/repaired-publication' });
        const token = await user.getIdToken();
        const response = await fetch(`${moderationApiBase}/userModerationAction`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            uploadId: resumeUpload.id,
            action: 'repairPublished',
            postDraft: {
              title,
              description: desc,
              imageUrl: image,
              ...(imageMeta ? {
                imageMeta: {
                  width: imageMeta.width,
                  height: imageMeta.height,
                  aspectRatio: imageMeta.aspectRatio,
                  orientation: imageMeta.orientation,
                  sizeBytes: imageMeta.sizeBytes,
                },
              } : {}),
              authorName: profile.displayName,
              authorRole: uploaderRole,
              styles: selectedStyles,
              makerTags,
              appliedTriggers,
              credits: consentCredits,
              uploadConsent,
              consentAudit,
              consentException: normalizedException,
              isChallenge,
              ...correctionMetadata,
            },
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          logModerationDebug('after-firestore-write-result', {
            firestoreWriteAttempted: true,
            firestoreWriteSucceeded: false,
            finalResult: 'error',
            finalReason: data?.error || 'resume-publication-failed',
          });
          throw new Error(data?.error || 'Publiceren van goedgekeurde upload mislukt.');
        }
        logModerationDebug('after-firestore-write-result', { firestoreWriteAttempted: true, firestoreWriteSucceeded: true });
        setPublishing(false);
        onClose();
        return;
      }

      logModerationDebug('before-firestore-write', { firestoreWriteAttempted: true, writeTarget: 'posts/{auto}' });
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
        ...correctionMetadata,
        credits: consentCredits,
        uploadConsent,
        consentAudit,
        consentException: normalizedException,
        likes: 0,
        isChallenge,
        ...(imageMeta ? {
          imageMeta: {
            width: imageMeta.width,
            height: imageMeta.height,
            aspectRatio: imageMeta.aspectRatio,
            orientation: imageMeta.orientation,
            sizeBytes: imageMeta.sizeBytes,
          },
        } : {}),
      });
      const postId = publishedDoc?.id || null;
      logModerationDebug('after-firestore-write-result', {
        firestoreWriteAttempted: true,
        firestoreWriteSucceeded: Boolean(postId),
        uploadId: moderationTraceRef.current?.uploadId || resumeUpload?.id || null,
      });

      setErrors({});
      setImage(null);
      setImageMeta(null);
      setTitle('');
      setDesc('');
      setSelectedStyles([]);
      setCredits([{ role: defaultRole, name: profile.displayName, uid: profile.uid, isSelf: true, consentStatus: CONTRIBUTOR_CONSENT_STATUSES.ACCEPTED, consentRequired: false }]);
      setNewCredit({ role: 'model', name: '', instagramHandle: '', website: '', email: '', isMaker: false, makerFunction: '' });
      setShowInvite(false);
      setAiPeoplePresent(false);
      setSubjectWarningAcknowledged(false);
      setMissingMakerPromptShown(false);
      setPendingSelfMakerRole(null);
      setSelfMakerRoleConfirmation({ confirmed: false, role: '', confirmedAt: null });
      setConsentException({ enabled: false, type: CONSENT_EXCEPTION_REASONS.STREET, reason: '' });
      setMakerTags([]);
      setAppliedTriggers([]);
      setSuggestedTriggers([]);
      setOutcome(null);
      setForbiddenReasons([]);
      setReviewCaseId(null);
      setReviewUploadId(null);
      setShowSuggestionUI(false);
      setRequiredThemes([]);
      setUserMessage('');
      setShouldReview(false);
      setClassification(null);
      setReviewRequested(false);
      setTaxonomyCorrection(null);
      setCorrectionAcceptedAt(null);
      setCorrectionRejectedAt(null);
      setCorrectionReviewRequestedAt(null);
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
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 md:p-4">
       {inviteShareOpen && (
         <div className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center p-2 md:p-6">
           <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-3 w-full max-w-lg space-y-3 md:rounded-3xl md:p-6 md:space-y-4">
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
       <div className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[calc(100dvh-1rem)] md:h-[85vh] rounded-2xl overflow-hidden flex flex-col md:rounded-3xl">
          <div className="p-2.5 border-b flex items-center justify-between gap-2 md:p-4 md:gap-4">
            <div className="flex items-center gap-3">
              <h3 className="font-bold dark:text-white">Beeld publiceren</h3>
              {isChallenge && (
                <span className="text-xs uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                  Challenge
                </span>
              )}
              {isResumeFlow && (
                <span className="text-xs uppercase tracking-wide bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                  Hervatten
                </span>
              )}
            </div>
            <button onClick={onClose}><X className="dark:text-white"/></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 no-scrollbar md:p-6">
             {resumeLoading && (
               <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-300">
                 <Loader2 className="w-4 h-4 animate-spin mr-2" /> Uploadgegevens laden...
               </div>
             )}
             {!resumeLoading && resumeError && (
               <div className="max-w-lg mx-auto mt-6 rounded-2xl border border-red-200 bg-red-50 text-red-700 p-4 text-sm">
                 {resumeError}
               </div>
             )}
             {!resumeLoading && !resumeError && (
             step === 1 ? <div className="min-h-[180px] h-[28dvh] max-h-[240px] border-2 border-dashed rounded-2xl md:min-h-[220px] md:h-full md:max-h-none md:rounded-3xl flex flex-col items-center justify-center gap-2 relative"><input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFile} /><Plus className="w-9 h-9 text-slate-400 md:w-10 md:h-10"/><p className="text-xs font-semibold text-slate-500 dark:text-slate-300 md:text-sm">Tik om een beeld te kiezen</p></div> : (
                <div className="grid min-w-0 gap-3 md:grid-cols-2 md:gap-8">
                   <div className="min-w-0 space-y-2.5 md:space-y-4">
                      <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border dark:border-slate-700 space-y-2 md:p-4 md:rounded-xl md:space-y-3">
                         <p className="text-sm font-semibold dark:text-white">Geselecteerde afbeelding</p>
                         <div className="min-w-0 bg-slate-100 rounded-xl relative flex items-center justify-center p-1 dark:bg-slate-900/40">
                           {isPanoramaImage(imageMeta) ? (
                             <img src={image} className="block h-auto w-full rounded-lg object-contain"/>
                           ) : (
                             <img src={image} className="block max-h-[34dvh] max-w-full rounded-lg object-contain md:max-h-[520px]"/>
                           )}
                           {outcome === 'forbidden' && (
                             <div className="absolute inset-0 bg-slate-900/80 flex items-center justify-center text-orange-400 font-bold">
                               <AlertOctagon className="w-6 h-6 mr-2"/> Publicatie geblokkeerd
                             </div>
                           )}
                         </div>
                         <p className="text-xs text-slate-500 dark:text-slate-300">Je foto wordt automatisch verkleind zodat hij sneller laadt.</p>
                         {imageMeta?.orientation === 'panorama' && (
                           <p className="text-xs text-amber-700 dark:text-amber-300">Deze foto is erg breed. Bestaande kaartweergaven kunnen hem als panorama tonen.</p>
                         )}
                         {imageMeta?.aspectRatio && imageMeta.aspectRatio <= 0.5 && (
                           <p className="text-xs text-amber-700 dark:text-amber-300">Deze foto is erg hoog. Bestaande kaartweergaven kunnen nog een uitsnede tonen.</p>
                         )}
                         {isPanoramaImage(imageMeta) && (
                           <div className="min-w-0 rounded-lg border border-slate-200 bg-white/80 p-2 dark:border-slate-700 dark:bg-slate-900/40 md:rounded-xl md:p-3">
                             <p className="mb-2 text-sm font-semibold dark:text-white">Preview in tijdlijn</p>
                             <PostImageDisplay
                               src={image}
                               alt={title || 'Panorama preview'}
                               imageMeta={imageMeta}
                               className="w-full min-w-0 rounded-xl bg-slate-200 dark:bg-slate-900"
                               panoramaFrameClassName="h-32 sm:h-36 md:h-56"
                               badgeClassName="left-2 top-2"
                               panoramaHint="Veeg horizontaal om de hele foto te bekijken."
                             />
                           </div>
                         )}
                       </div>
                      {errors.image && <p className="text-xs text-red-500">{errors.image}</p>}
                      <div className="bg-slate-50 p-2.5 rounded-lg border dark:bg-slate-800 dark:border-slate-700 md:p-4 md:rounded-xl">
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
                                 setMakerTags((prev) => {
                                   const normalized = Array.from(new Set(prev.map(resolveTriggerKey)));
                                   const triggerId = resolveTriggerKey(trigger.id);
                                   const isArtNudeLocked = selectedStyles.includes('Art Nude') && triggerId === 'adultArtNude';
                                   if (isArtNudeLocked && normalized.includes('adultArtNude')) return normalized;
                                   return normalized.includes(triggerId)
                                     ? normalized.filter((item) => item !== triggerId)
                                     : [...normalized, triggerId];
                                 });
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
                                 onClick={handleRequestReview}
                                 disabled={reviewRequestPending}
                                 className="text-xs bg-red-600 text-white px-3 py-1 rounded"
                               >
                                 {reviewRequestPending ? 'Review versturen...' : 'Vraag review aan'}
                               </button>
                               {reviewRequested && (
                                 <span className="text-xs text-red-600 dark:text-red-300">Review aangevraagd. We nemen contact op.</span>
                               )}
                             </div>
                           </div>
                         )}
                         {taxonomyCorrection && taxonomyCorrection.type !== TAXONOMY_CORRECTION_TYPES.FORBIDDEN && (
                           <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-100">
                             <p className="font-semibold">De gekozen categorie lijkt niet te passen.</p>
                             <p className="mt-1">AI voorstel: {taxonomyCorrection.suggestedThemes?.join(', ') || 'controleer thema en triggers'}.</p>
                             <p className="mt-1">{taxonomyCorrection.reason}</p>
                             {taxonomyCorrection.suggestedTriggers?.length > 0 && (
                               <p className="mt-1">Triggers: {taxonomyCorrection.suggestedTriggers.map(getTriggerLabel).join(', ')}</p>
                             )}
                             <div className="mt-2 flex flex-wrap gap-2">
                               {taxonomyCorrection.type === TAXONOMY_CORRECTION_TYPES.SAFE && taxonomyCorrection.requiresUserAcceptance && (
                                 <button type="button" className="text-xs bg-amber-600 text-white px-3 py-1 rounded" onClick={handleAcceptTaxonomyCorrection}>Pas voorgestelde categorie toe</button>
                               )}
                               <button type="button" className="text-xs border border-amber-400 px-3 py-1 rounded" onClick={handleRejectTaxonomyCorrection}>Ik ben het oneens</button>
                               <button type="button" className="text-xs underline" onClick={handleRequestReview}>Vraag review aan</button>
                             </div>
                           </div>
                         )}
                         {((requiredThemes.length > 0) || shouldReview || userMessage) && outcome !== 'forbidden' && (
                           <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/30 dark:text-blue-200">
                             {userMessage && <p className="font-semibold">{userMessage}</p>}
                             {requiredThemes.length > 0 && <p className="mt-1">Vereist thema: {requiredThemes.join(', ')}</p>}
                             <div className="mt-2">
                               <button
                                 type="button"
                                 onClick={handleRequestReview}
                                 disabled={reviewRequestPending}
                                 className="text-xs bg-blue-600 text-white px-3 py-1 rounded"
                               >
                                 {reviewRequestPending ? 'Review versturen...' : 'Vraag review aan'}
                               </button>
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
                   <div className="space-y-3 md:space-y-6">
                      <Input label="Titel" value={title} onChange={e => { setTitle(e.target.value); setErrors(prev => ({ ...prev, title: undefined })); }} error={errors.title} />
                      <div><label className="text-sm font-normal block mb-1.5 text-slate-700 dark:text-slate-200 md:mb-2">Bijschrift</label><textarea className="w-full min-h-20 p-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 md:p-3 md:rounded-xl" value={desc} onChange={e => setDesc(e.target.value)} /></div>
                      
                      <div className="bg-slate-50 dark:bg-slate-800/70 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 md:p-4 md:rounded-xl">
                         <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-bold block dark:text-white">Bijdragers & consent</label>
                            {(profile.roles || []).length === 1 && <span className="text-[11px] uppercase text-slate-500">{ROLES.find(x => x.id === uploaderRole)?.label}</span>}
                         </div>
                         <div className="mb-2.5 rounded-xl border border-blue-100 bg-blue-50/80 p-2.5 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-100 space-y-1 md:mb-4 md:rounded-2xl md:p-3">
                           <p className="font-semibold">Elke upload heeft minstens één maker nodig.</p>
                           <p>Makerrollen: {ROLES.filter((role) => isMakerRole(role.id)).map((role) => role.label).join(', ')}. Model + MUA alleen is niet genoeg.</p>
                         </div>

                         {(profile.roles || []).length > 1 && (
                            <div className="mb-2.5 md:mb-4">
                               <p className="text-xs font-semibold text-slate-500 dark:text-slate-300 mb-1">Jouw rol in deze publicatie</p>
                               <div className="flex gap-2 flex-wrap">{(profile.roles || []).map(r => <button key={r} type="button" onClick={() => setUploaderRole(r)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all md:px-4 md:py-1.5 md:text-xs ${uploaderRole === r ? (isMakerRole(r) ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white') : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-white'}`}>{ROLES.find(x => x.id === r)?.label}{isMakerRole(r) ? ' · maker' : ''}</button>)}</div>
                               <p className="text-[11px] text-slate-500 dark:text-slate-300 mt-1">Je profielrollen zijn je standaardrollen. Voor deze upload kun je ook een andere makerrol bevestigen als jij het werk maakte.</p>
                            </div>
                         )}
                         {makerSelfRoles.length > 0 && !hasMakerCredit(credits) && (
                           <button
                             type="button"
                             onClick={() => setUploaderRole(makerSelfRoles[0])}
                             className="mb-2.5 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100 md:mb-3 md:rounded-xl md:py-2"
                           >
                             Voeg mij toe als maker ({ROLES.find((role) => role.id === makerSelfRoles[0])?.label})
                           </button>
                         )}
                         {errors.maker && !missingMakerPromptState.shouldShowMissingMakerPrompt && <p className="mb-2 text-xs text-red-500">{errors.maker}</p>}
                         {errors.selfRole && <p className="mb-2 text-xs text-red-500">{errors.selfRole}</p>}

                         {missingMakerPromptState.shouldShowMissingMakerPrompt && (
                           <div className="mb-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-950 shadow-sm dark:border-rose-800/50 dark:bg-rose-900/25 dark:text-rose-50 md:mb-3 md:rounded-2xl md:p-4">
                             <p className="text-sm font-bold">Er mist nog een maker</p>
                             <p className="mt-1.5 md:mt-2">Bij elke upload op Artes moet minstens één maker worden vermeld. Dat kan bijvoorbeeld de fotograaf, videograaf, retoucher, art director of kunstenaar zijn.</p>
                             <p className="mt-1.5 md:mt-2">De maker hoeft geen Artes account te hebben. Je kunt iemand toevoegen met naam en eventueel een Instagram-handle of e-mailadres, of kiezen voor een anonieme maker.</p>
                             <p className="mt-1.5 font-semibold md:mt-2">Zo blijft duidelijk wie aan het beeld heeft bijgedragen en krijgt iedereen de erkenning die die verdient.</p>
                             <div className="mt-2.5 grid grid-cols-2 gap-2 md:mt-3">
                               <button
                                 type="button"
                                 onClick={() => {
                                   setNewCredit((prev) => ({ ...prev, role: 'photographer' }));
                                   setContributorSearch('');
                                   setShowInvite(false);
                                 }}
                                 className="rounded-lg bg-rose-600 px-2.5 py-1.5 font-semibold text-white hover:bg-rose-700 md:px-3 md:py-2"
                               >
                                 Maker toevoegen
                               </button>
                               <button
                                 type="button"
                                 onClick={() => addAnonymousContributor('photographer')}
                                 className="rounded-lg border border-rose-300 bg-white/80 px-2.5 py-1.5 font-semibold text-rose-900 hover:bg-white dark:border-rose-700 dark:bg-slate-900/70 dark:text-rose-50 md:px-3 md:py-2"
                               >
                                 Anonieme maker toevoegen
                               </button>
                             </div>
                             <div className="mt-2.5 rounded-xl border border-rose-200 bg-white/70 p-2.5 dark:border-rose-800 dark:bg-slate-900/50 md:mt-3 md:p-3">
                               <p className="font-semibold">Ben jij zelf de maker van deze upload?</p>
                               <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                                 <select
                                   value={selectedSelfMakerRole}
                                   onChange={(event) => setSelectedSelfMakerRole(event.target.value)}
                                   className="flex-1 rounded-lg border border-rose-200 bg-white p-2 text-xs text-slate-800 dark:border-rose-800 dark:bg-slate-900 dark:text-slate-100"
                                 >
                                   {MAKER_ROLE_IDS.map((roleId) => (
                                     <option key={roleId} value={roleId}>{ROLES.find((role) => role.id === roleId)?.label || roleId}</option>
                                   ))}
                                 </select>
                                 <button
                                   type="button"
                                   onClick={() => selectSelfMakerRoleForUpload(selectedSelfMakerRole)}
                                   className="rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 font-semibold text-rose-900 hover:bg-rose-50 dark:border-rose-700 dark:bg-slate-900 dark:text-rose-50 md:px-3 md:py-2"
                                 >
                                   Gebruik voor deze upload
                                 </button>
                               </div>
                               {selfMakerRoleConfirmation.confirmed && selfMakerRoleConfirmation.role === uploaderRole && (
                                 <p className="mt-2 text-emerald-700 dark:text-emerald-200">Makerrol bevestigd voor deze upload.</p>
                               )}
                             </div>
                             {pendingSelfMakerRole && (
                               <div className="mt-2.5 rounded-xl border border-blue-200 bg-blue-50 p-2.5 text-blue-950 dark:border-blue-800 dark:bg-blue-900/25 dark:text-blue-50 md:mt-3 md:p-3">
                                 <p className="text-sm font-bold">Heb jij dit beeld gemaakt?</p>
                                 <p className="mt-1.5 md:mt-2">Deze rol staat niet in je profiel, maar je kunt die wel gebruiken voor deze upload. Bijvoorbeeld als je een zelfportret plaatst, eigen werk fotografeert of deze content zelf hebt gemaakt.</p>
                                 <p className="mt-1.5 md:mt-2">Dit past alleen de credits van deze upload aan. Je profielrollen worden niet automatisch gewijzigd.</p>
                                 <div className="mt-2.5 grid grid-cols-2 gap-2 md:mt-3">
                                   <button
                                     type="button"
                                     onClick={() => confirmSelfMakerRoleForUpload(pendingSelfMakerRole)}
                                     className="rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700 md:px-3 md:py-2"
                                   >
                                     Bevestigen
                                   </button>
                                   <button
                                     type="button"
                                     onClick={() => setPendingSelfMakerRole(null)}
                                     className="rounded-lg border border-blue-300 bg-white/80 px-2.5 py-1.5 font-semibold text-blue-900 hover:bg-white dark:border-blue-700 dark:bg-slate-900/70 dark:text-blue-50 md:px-3 md:py-2"
                                   >
                                     Annuleren
                                   </button>
                                 </div>
                               </div>
                             )}
                             {errors.maker && <p className="mt-2 text-red-600 dark:text-red-300">{errors.maker}</p>}
                           </div>
                         )}

                         {visiblePersonPromptState.shouldShowVisiblePersonPrompt && (
                           <div className="mb-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 shadow-sm dark:border-amber-800/50 dark:bg-amber-900/25 dark:text-amber-50 md:mb-3 md:rounded-2xl md:p-4">
                             <p className="text-sm font-bold">Er lijkt een persoon op deze foto te staan</p>
                             <p className="mt-1.5 md:mt-2">Omdat je deze upload als maker plaatst, vragen we je om het model of de geportretteerde persoon te taggen als dat van toepassing is.</p>
                             <p className="mt-1.5 md:mt-2">Deze persoon hoeft geen Artes account te hebben. Wanneer je de naam + bijbehorende instagram handle of emailadres achterlaat, wordt er een tijdelijk account aangemaakt voor deze persoon, die later geclaimd kan worden.</p>
                             <p className="mt-1.5 font-semibold md:mt-2">Artes vindt het belangrijk dat iedereen die aan een beeld heeft bijgedragen de erkenning krijgt die die verdient.</p>
                             <div className="mt-2.5 grid grid-cols-2 gap-2 md:mt-3">
                               <button
                                 type="button"
                                 onClick={() => {
                                   setNewCredit((prev) => ({ ...prev, role: 'model' }));
                                   setContributorSearch('');
                                   setShowInvite(false);
                                 }}
                                 className="rounded-lg bg-amber-600 px-2.5 py-1.5 font-semibold text-white hover:bg-amber-700 md:px-3 md:py-2"
                               >
                                 Model toevoegen
                               </button>
                               <button
                                 type="button"
                                 onClick={() => {
                                   addAnonymousContributor('model');
                                 }}
                                 className="rounded-lg border border-amber-300 bg-white/80 px-2.5 py-1.5 font-semibold text-amber-900 hover:bg-white dark:border-amber-700 dark:bg-slate-900/70 dark:text-amber-50 md:px-3 md:py-2"
                               >
                                 Anoniem toevoegen
                               </button>
                               <button
                                 type="button"
                                 onClick={() => setSubjectWarningAcknowledged(true)}
                                 className={`rounded-lg border px-2.5 py-1.5 font-semibold md:px-3 md:py-2 ${subjectWarningAcknowledged ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100' : 'border-amber-300 bg-white/80 text-amber-900 hover:bg-white dark:border-amber-700 dark:bg-slate-900/70 dark:text-amber-50'}`}
                               >
                                 Niet van toepassing
                               </button>
                               <button
                                 type="button"
                                 onClick={() => setConsentException((prev) => ({
                                   ...prev,
                                   enabled: true,
                                   type: prev.type || CONSENT_EXCEPTION_REASONS.STREET,
                                 }))}
                                 className={`rounded-lg border px-2.5 py-1.5 font-semibold md:px-3 md:py-2 ${consentException.enabled ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-100' : 'border-amber-300 bg-white/80 text-amber-900 hover:bg-white dark:border-amber-700 dark:bg-slate-900/70 dark:text-amber-50'}`}
                               >
                                 Straat/pers uitzondering
                               </button>
                             </div>
                             {errors.visiblePersonPrompt && <p className="mt-2 text-red-600 dark:text-red-300">{errors.visiblePersonPrompt}</p>}
                           </div>
                         )}

                         <div className="space-y-1.5 mb-2.5 md:space-y-2 md:mb-3">
                            {credits.map((c, i) => (
                               <div key={i} className="flex items-start justify-between gap-2 text-xs bg-white dark:bg-slate-700 p-2 rounded border dark:border-slate-600">
                                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 dark:text-white md:gap-2">
                                     {c.isSelf && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200 rounded">Jij</span>}
                                     {(c.isMaker || isMakerRole(c.role)) && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200 rounded">Maker</span>}
                                     <span className="min-w-0 break-words"><span className="font-bold capitalize">{ROLES.find(r => r.id === c.role)?.label}:</span> {c.name}{c.makerFunction && !isMakerRole(c.role) ? ` · ${getMakerFunctionLabel(c.makerFunction)}` : ''}</span>
                                  </div>
                                  <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5 items-center md:gap-2">
                                     {c.consentStatus && <span className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100 px-1.5 py-0.5 rounded text-[10px]">{c.consentStatus}</span>}
                                     {c.isExternal && <span className="bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-100 px-1.5 py-0.5 rounded text-[10px]">Extern</span>}
                                     {!c.isSelf && <button onClick={() => setCredits(credits.filter((_, idx) => idx !== i))}><Trash2 className="w-3 h-3 text-red-500"/></button>}
                                  </div>
                               </div>
                            ))}
                         </div>

                         <div className="mb-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 md:mb-3 md:rounded-xl md:p-3">
                           <label className="flex items-start gap-2 font-semibold">
                             <input
                               type="checkbox"
                               checked={consentException.enabled}
                               onChange={(e) => setConsentException((prev) => ({ ...prev, enabled: e.target.checked }))}
                               className="mt-0.5"
                             />
                             <span>Straat-, pers- of documentaire uitzondering vastleggen</span>
                           </label>
                           {consentException.enabled && (
                             <div className="mt-3 space-y-2">
                               <select
                                 value={consentException.type}
                                 onChange={(e) => setConsentException((prev) => ({ ...prev, type: e.target.value }))}
                                 className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                               >
                                 <option value={CONSENT_EXCEPTION_REASONS.STREET}>Straatfotografie</option>
                                 <option value={CONSENT_EXCEPTION_REASONS.PRESS}>Persfotografie</option>
                                 <option value={CONSENT_EXCEPTION_REASONS.DOCUMENTARY}>Documentaire uitzondering</option>
                               </select>
                               <textarea
                                 value={consentException.reason}
                                 onChange={(e) => setConsentException((prev) => ({ ...prev, reason: e.target.value }))}
                                 placeholder="Waarom is individuele toestemming niet vereist of praktisch haalbaar?"
                                 className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                               />
                               <p className="text-[11px] text-slate-500 dark:text-slate-300">Deze flow blokkeert publicatie niet, maar bewaart de reden auditable bij de upload.</p>
                               {errors.exception && <p className="text-red-500">{errors.exception}</p>}
                             </div>
                           )}
                         </div>

                         <div className="flex gap-2 mb-2">
                            <select className="w-[38%] min-w-0 p-2 border border-slate-300 rounded text-xs bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 md:w-1/3 md:text-sm" value={newCredit.role} onChange={e => {
                              const nextRole = e.target.value;
                              setNewCredit((prev) => normalizeCreditAfterRoleChange(prev, nextRole));
                            }}>{ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
                            <div className="relative flex-1">
                                <input 
                                   className="w-full p-2 border border-slate-300 rounded text-xs bg-white text-slate-800 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 md:text-sm"
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
                                   <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 dark:border-slate-700 dark:bg-slate-900 mt-1 rounded shadow-lg max-h-40 overflow-y-auto no-scrollbar z-10">
                                      <p className="px-2 pt-2 text-[11px] text-slate-500 dark:text-slate-300">Selecteer een bestaande bijdrager.</p>
                                      {searchResults.map(u => (
                                         <div key={u.uid} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-sm text-slate-700 dark:text-slate-100" onClick={() => void addCredit(u)}>{u.displayName}</div>
                                      ))}
                                      <button
                                        type="button"
                                        className="w-full border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-200 px-2 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
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
                                    <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 dark:border-slate-700 dark:bg-slate-900 mt-1 rounded shadow-lg p-2 z-10">
                                        <p className="text-xs text-orange-600 dark:text-orange-300 mb-2">Geen gebruiker gevonden.</p>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setAllowExternalOverride(true);
                                            setShowInvite(true);
                                          }}
                                          className="text-xs bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100 p-1 rounded w-full"
                                        >
                                          Voeg toe als extern
                                        </button>
                                    </div>
                                )}
                            </div>
                         </div>
                         <div className="mb-2.5 rounded-lg border border-slate-200 bg-white/80 p-2.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100 md:mb-3 md:rounded-xl md:p-3">
                           <label className="flex items-start gap-2 font-semibold">
                             <input
                               type="checkbox"
                               checked={Boolean(newCredit.isMaker || isMakerRole(newCredit.role))}
                               disabled={isMakerRole(newCredit.role)}
                               onChange={(event) => setNewCredit((prev) => ({
                                 ...prev,
                                 isMaker: event.target.checked,
                                 makerFunction: event.target.checked ? (prev.makerFunction || 'maker') : '',
                               }))}
                               className="mt-0.5"
                             />
                             <span>Deze bijdrager is maker, rechthebbende of productie-eigenaar voor deze upload</span>
                           </label>
                           {(newCredit.isMaker || isMakerRole(newCredit.role)) && (
                             <select
                               value={isMakerRole(newCredit.role) ? newCredit.role : (newCredit.makerFunction || 'maker')}
                               disabled={isMakerRole(newCredit.role)}
                               onChange={(event) => setNewCredit((prev) => ({ ...prev, makerFunction: event.target.value }))}
                               className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                             >
                               {MAKER_FUNCTION_IDS.map((makerFunction) => (
                                 <option key={makerFunction} value={makerFunction}>{getMakerFunctionLabel(makerFunction)}</option>
                               ))}
                             </select>
                           )}
                         </div>
                         <button
                           type="button"
                           onClick={addAnonymousContributor}
                           className="mb-2.5 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-100 md:mb-3 md:py-2"
                         >
                           Voeg anonieme bijdrager toe waar passend
                         </button>
                         
                         {showInvite && (
                            <div className="bg-yellow-50 p-2.5 rounded text-xs text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-100 mb-2 border border-yellow-200 dark:border-yellow-800 md:p-3">
                               <p className="mb-2 font-semibold">Ongeclaimd profiel aanmaken voor {newCredit.name}</p>
                               <input
                                 className="w-full p-2 rounded border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 mb-1.5 md:mb-2"
                                 placeholder="Instagram handle (optioneel)"
                                 value={newCredit.instagramHandle}
                                 onChange={e => setNewCredit((prev) => ({...prev, instagramHandle: e.target.value}))}
                               />
                               <input
                                 className="w-full p-2 rounded border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 mb-1.5 md:mb-2"
                                 placeholder="Website domein (optioneel)"
                                 value={newCredit.website}
                                 onChange={e => setNewCredit((prev) => ({...prev, website: e.target.value}))}
                               />
                               <input
                                 className="w-full p-2 rounded border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 mb-1.5 md:mb-2"
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
                     <label className="text-sm font-bold block mb-1.5 dark:text-white md:mb-2">Thema&apos;s</label>
                         <div className="flex flex-wrap gap-1.5 md:gap-2">{THEMES.map(t => {
                           const isSelected = selectedStyles.includes(t);
                           return (
                             <button
                               key={t}
                               onClick={() => toggleStyle(t)}
                               className={`px-2 py-1 rounded text-xs border transition-all ${isSelected
                                 ? 'bg-blue-600 text-white border-blue-500 dark:bg-blue-500 dark:text-white dark:border-blue-400 ring-2 ring-blue-300/80 dark:ring-blue-300/50'
                                 : getThemeStyle(t)}`}
                             >
                               {t}
                             </button>
                           );
                         })}</div>
                         {errors.styles && <p className="mt-2 text-xs text-red-500">{errors.styles}</p>}
                      </div>
                      {publishError && <p className="text-sm text-red-500 text-center">{publishError}</p>}
                      {showSuggestionUI && <p className="text-xs text-amber-700 dark:text-amber-300 text-center">Kies hoe je met de AI-suggesties wilt omgaan om te publiceren.</p>}
                      <Button onClick={handlePublish} className="w-full py-2 text-sm md:py-3 md:text-base" disabled={publishing || showSuggestionUI || outcome === 'forbidden'}>
                        {publishing ? <><Loader2 className="w-4 h-4 animate-spin" /> Publiceren...</> : 'Publiceren'}
                      </Button>
                   </div>
                </div>
             )
             )}
          </div>
       </div>
    </div>
  );
}

function EditProfileModal({ onClose, profile, user, posts, users = [], onOpenQuickProfile, onProfileUpdated }) {
  const [formData, setFormData] = useState({ ...profile });
  const [tab, setTab] = useState('general');
  const [pendingRoleRemoval, setPendingRoleRemoval] = useState(null);
  const [avatarInputMode, setAvatarInputMode] = useState(profile?.avatar?.startsWith('data:') ? 'upload' : 'url');
  const [manualPostIds, setManualPostIds] = useState(profile?.quickProfilePostIds || []);
  const [saveError, setSaveError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [cropSource, setCropSource] = useState('');
  const [pendingCroppedImages, setPendingCroppedImages] = useState(null);
  const headerMeasureRef = useRef(null);
  const [headerAspectRatio, setHeaderAspectRatio] = useState(3);
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
     if (cropSource) {
       setSaveError('Je hebt een nieuwe foto gekozen. Klik eerst op "Gebruik uitsnede" voordat je opslaat.');
       return;
     }
     setIsSaving(true);
     const quickProfilePostIds = Array.from(new Set(manualPostIds));
     const payload = {
       ...formData,
       roles: formData.roles?.length ? formData.roles : ['fan'],
       themes: formData.themes || [],
       linkedAgencyName: formData.linkedAgencyName || '',
       linkedCompanyName: formData.linkedCompanyName || '',
       linkedAgencyId: formData.linkedAgencyId || null,
       linkedCompanyId: formData.linkedCompanyId || null,
       quickProfilePreviewMode: formData.quickProfilePreviewMode || 'latest',
       quickProfilePostIds,
       avatarBlob: pendingCroppedImages?.avatar === formData.avatar ? (pendingCroppedImages?.avatarBlob || null) : null,
       headerImageBlob: pendingCroppedImages?.headerImage === formData.headerImage ? (pendingCroppedImages?.headerImageBlob || null) : null,
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
       const normalized = normalizeProfileData({ ...profile, ...payload, uid: user.uid }, user.uid);
       onProfileUpdated?.(normalized);
       setPendingCroppedImages(null);
       if (import.meta.env.DEV) {
         console.log('[EditProfileModal] Profile save completed, snapshot listener will update UI');
       }
       onClose();
     } catch (error) {
       console.error('Failed to save profile settings', error);
       setSaveError(error?.message || 'Opslaan mislukt. Probeer het opnieuw.');
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


  useEffect(() => {
    setPendingCroppedImages((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (prev.avatar && prev.avatar !== formData.avatar) {
        next.avatar = null;
        next.avatarBlob = null;
      }
      if (prev.headerImage && prev.headerImage !== formData.headerImage) {
        next.headerImage = null;
        next.headerImageBlob = null;
      }
      return next;
    });
  }, [formData.avatar, formData.headerImage]);

  const handleImageUpload = (event, key) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (key === 'avatar') {
        setCropSource(String(reader.result || ''));
        return;
      }
      setFormData((prev) => ({ ...prev, [key]: reader.result }));
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!headerMeasureRef.current) return undefined;
    const element = headerMeasureRef.current;
    const updateAspect = () => {
      const width = element.clientWidth || 1;
      const height = element.clientHeight || 1;
      setHeaderAspectRatio(width / height);
    };
    updateAspect();
    const observer = new ResizeObserver(updateAspect);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleManualPostToggle = (postId) => {
    setManualPostIds((prev) => (
      prev.includes(postId) ? prev.filter((id) => id !== postId) : [...prev, postId]
    ));
  };

  const quickPreviewMode = formData.quickProfilePreviewMode || 'latest';

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-2 md:p-4">
       <div className="bg-white dark:bg-slate-900 w-full max-w-2xl h-[calc(100dvh-1rem)] md:h-[80vh] rounded-2xl md:rounded-3xl overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b flex justify-between md:p-6"><h3 className="font-bold text-base md:text-lg dark:text-white">Profiel Bewerken</h3><button onClick={onClose}><X/></button></div>
          <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-4 md:p-8 md:space-y-6">
             <div aria-hidden="true" className="pointer-events-none fixed -left-[9999px] top-0 opacity-0 w-[calc(100vw-2rem)] max-w-3xl xl:max-w-4xl">
               <div ref={headerMeasureRef} className="w-full h-56 md:h-72" />
             </div>
             {/* Simple Tabs for this view */}
             <div className="flex gap-3 overflow-x-auto no-scrollbar border-b mb-3 md:gap-4 md:mb-4">
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
                     className={`shrink-0 pb-2 text-sm md:text-base ${tab === key ? 'border-b-2 border-blue-600 font-bold' : ''}`}
                   >
                     {label}
                   </button>
                 ))}
             </div>

             {tab === 'general' && (
                <>
                    <Input label="Weergavenaam" value={formData.displayName} onChange={e => setFormData({...formData, displayName: e.target.value})} />
                    <div><label className="block text-sm font-medium mb-1 dark:text-slate-300">Bio</label><textarea className="w-full p-3 rounded-xl border dark:bg-slate-800 dark:text-white h-24" value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} /></div>

                    <div className="border-t pt-4 space-y-3 md:pt-6 md:space-y-4">
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
                            onChange={(event) => {
                              const nextAvatar = event.target.value;
                              setFormData((prev) => ({ ...prev, avatar: nextAvatar }));
                              setPendingCroppedImages((prev) => (prev?.avatar && prev.avatar !== nextAvatar
                                ? { ...prev, avatarBlob: null, avatar: null }
                                : prev));
                            }}
                          />
                        )}
                        {formData.avatar && (
                          <div className="flex items-center gap-3">
                            <img src={formData.avatar} alt="Avatar preview" className="w-12 h-12 rounded-full object-cover border" />
                            <button
                              type="button"
                              className="text-xs text-slate-500 hover:text-slate-700"
                              onClick={() => {
                                setFormData((prev) => ({ ...prev, avatar: '' }));
                                setPendingCroppedImages((prev) => (prev ? { ...prev, avatarBlob: null, avatar: null } : prev));
                              }}
                            >
                              Verwijderen
                            </button>
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Deze profielfoto wordt overal gebruikt, inclusief de header van je profiel en quick profile.
                      </p>
                      {cropSource ? (
                        <ProfileImageCropper
                          source={cropSource}
                          measuredHeaderAspectRatio={headerAspectRatio}
                          onCancel={() => setCropSource('')}
                          onApply={({ avatar, headerImage, avatarBlob, headerImageBlob, error }) => {
                            if (error) {
                              setSaveError(error);
                              return;
                            }
                            setFormData((prev) => ({ ...prev, avatar, headerImage }));
                            setPendingCroppedImages({ avatarBlob, headerImageBlob, avatar, headerImage });
                            setSaveError(null);
                            setCropSource('');
                          }}
                        />
                      ) : null}
                      {formData.headerImage ? (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Header preview</p>
                          <div className="w-full h-24 rounded-xl overflow-hidden border">
                            <img src={formData.headerImage} alt="Header preview" className="w-full h-full object-cover" />
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="border-t pt-6">
                        <h4 className="font-bold mb-4 dark:text-white">Connecties</h4>
                        <div className="grid md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Agency</label>
                            <SearchWithAutocomplete
                              authReady={Boolean(user?.uid)}
                              authUser={user}
                              value={formData.linkedAgencyName || ''}
                              onChange={(value) => {
                                setFormData((prev) => ({ ...prev, linkedAgencyName: value, linkedAgencyId: null }));
                              }}
                              onSelect={(selectedUser) => {
                                const selectedName = selectedUser?.displayName || selectedUser?.username || '';
                                setFormData((prev) => ({
                                  ...prev,
                                  linkedAgencyName: selectedName,
                                  linkedAgencyId: selectedUser?.uid || null,
                                }));
                              }}
                              selectedLabel={formData.linkedAgencyId ? (formData.linkedAgencyName || '') : ''}
                              onClearSelection={() => setFormData((prev) => ({ ...prev, linkedAgencyId: null }))}
                              placeholder="Zoek of typ agency naam"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1 dark:text-slate-300">Bedrijf</label>
                            <SearchWithAutocomplete
                              authReady={Boolean(user?.uid)}
                              authUser={user}
                              value={formData.linkedCompanyName || ''}
                              onChange={(value) => {
                                setFormData((prev) => ({ ...prev, linkedCompanyName: value, linkedCompanyId: null }));
                              }}
                              onSelect={(selectedUser) => {
                                const selectedName = selectedUser?.displayName || selectedUser?.username || '';
                                setFormData((prev) => ({
                                  ...prev,
                                  linkedCompanyName: selectedName,
                                  linkedCompanyId: selectedUser?.uid || null,
                                }));
                              }}
                              selectedLabel={formData.linkedCompanyId ? (formData.linkedCompanyName || '') : ''}
                              onClearSelection={() => setFormData((prev) => ({ ...prev, linkedCompanyId: null }))}
                              placeholder="Zoek of typ bedrijfsnaam"
                            />
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
                className="bg-amber-600 hover:bg-amber-700 text-white border border-amber-700 shadow-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartChallengeUpload?.();
                }}
              >
                Doe mee
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

function CommunityDetail({ id, setView, authUser, currentPublicProfile, communities, initialTopicTitle, authReady, logListenerStart, handleListenerError }) {
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
  const displayName = resolvePublicDisplayName(currentPublicProfile);

  useEffect(() => {
    if (!authReady || !db || !id) return undefined;
    setTopicsLoading(true);
    const topicsRef = collection(db, 'communities', id, 'topics');
    const topicsQuery = query(topicsRef, orderBy('createdAt', 'desc'));
    logListenerStart('Community topics listener (ArtesApp)');
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
        handleListenerError('Community topics listener (ArtesApp)', error);
        setTopicError('Topics konden niet worden geladen.');
        setTopicsLoading(false);
      },
    );
  }, [authReady, db, id, logListenerStart, handleListenerError]);

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
        authorName: displayName || 'Gebruiker',
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
      <button onClick={() => setView('community')} className="flex items-center text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white font-medium">
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
          currentPublicProfile={currentPublicProfile}
          authReady={authReady}
          logListenerStart={logListenerStart}
          handleListenerError={handleListenerError}
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

function CommunityTopicDetail({ communityId, topicId, onBack, authUser, currentPublicProfile, authReady, logListenerStart, handleListenerError }) {
  const db = getFirebaseDbInstance();
  const [topic, setTopic] = useState(null);
  const [topicLoading, setTopicLoading] = useState(true);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const commentAuthorName = resolvePublicDisplayName(currentPublicProfile);

  useEffect(() => {
    if (!authReady || !db || !communityId || !topicId) return undefined;
    setTopicLoading(true);
    const topicRef = doc(db, 'communities', communityId, 'topics', topicId);
    logListenerStart('Community topic listener (ArtesApp)');
    return onSnapshot(
      topicRef,
      (snapshot) => {
        setTopic(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        setTopicLoading(false);
      },
      (error) => {
        handleListenerError('Community topic listener (ArtesApp)', error);
        setTopicLoading(false);
      },
    );
  }, [authReady, db, communityId, topicId, logListenerStart, handleListenerError]);

  useEffect(() => {
    if (!authReady || !db || !communityId || !topicId) return undefined;
    const commentsRef = collection(db, 'communities', communityId, 'topics', topicId, 'comments');
    const commentsQuery = query(commentsRef, orderBy('createdAt', 'desc'));
    logListenerStart('Community comments listener (ArtesApp)');
    return onSnapshot(
      commentsQuery,
      (snapshot) => {
        setComments(snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() })));
      },
      (error) => {
        handleListenerError('Community comments listener (ArtesApp)', error);
      },
    );
  }, [authReady, db, communityId, topicId, logListenerStart, handleListenerError]);

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
        authorName: commentAuthorName || 'Gebruiker',
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

  const handleDeleteComment = async (commentId, authorId) => {
    if (!authUser) {
      setCommentError('Log in om reacties te verwijderen.');
      return;
    }
    if (authorId !== authUser.uid) {
      setCommentError('Je kunt alleen je eigen reacties verwijderen.');
      return;
    }
    if (!db) {
      setCommentError('Database niet beschikbaar.');
      return;
    }
    if (deletingCommentId) return;

    const shouldDelete = window.confirm('Weet je zeker dat je deze reactie wilt verwijderen?');
    if (!shouldDelete) return;

    try {
      setDeletingCommentId(commentId);
      const commentRef = doc(db, 'communities', communityId, 'topics', topicId, 'comments', commentId);
      await deleteDoc(commentRef);
      setCommentError(null);
    } catch (error) {
      console.error('Failed to delete comment', error);
      setCommentError('Reactie kon niet worden verwijderd.');
    } finally {
      setDeletingCommentId(null);
    }
  };


  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="flex items-center text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white font-medium">
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
            comments.map((comment) => {
              const canDeleteComment = Boolean(authUser?.uid && comment.authorId === authUser.uid);
              return (
                <div key={comment.id} className="group rounded-2xl border border-slate-100 dark:border-slate-800 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        {sanitizeHandle(comment.authorName || 'Communitylid')}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-300">{comment.text}</p>
                    </div>
                    {canDeleteComment && (
                      <button
                        type="button"
                        className="px-1 text-slate-400 hover:text-red-500 transition opacity-100 md:opacity-0 md:group-hover:opacity-100"
                        aria-label="Verwijder reactie"
                        title="Verwijder reactie"
                        onClick={() => handleDeleteComment(comment.id, comment.authorId)}
                        disabled={deletingCommentId === comment.id}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
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
function ChallengeDetail({ setView, posts, onPostClick, challenge, triggerVisibility, revealedSensitivePostsById, onRevealSensitivePost }) {
   const challengeData = challenge || DEFAULT_CHALLENGE_CONFIG;
   const visiblePosts = useMemo(
    () => posts.filter((post) => getPostContentPreference(post, triggerVisibility) !== 'hideFeed'),
    [posts, triggerVisibility],
   );
   return (
      <div className="max-w-4xl mx-auto px-4 py-6">
         <button onClick={() => setView('community')} className="flex items-center text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white mb-6 font-medium"><ChevronLeft className="w-4 h-4 mr-1"/> Terug</button>
         <div className="bg-amber-100 dark:bg-amber-900/20 p-8 rounded-3xl border border-amber-200 dark:border-amber-800 mb-8 text-center relative overflow-hidden">
            <p className="text-sm uppercase tracking-widest text-amber-700 dark:text-amber-200 mb-2">{challengeData.title}</p>
            <h1 className="text-4xl font-bold text-amber-900 dark:text-amber-100 mb-2">{challengeData.theme}</h1>
            <p className="text-sm text-amber-800 dark:text-amber-200/80">{challengeData.description}</p>
         </div>
         <div className="grid grid-cols-2 md:grid-cols-3 gap-1 md:gap-4">
            {visiblePosts.map(post => {
              const covered = shouldCoverPost(post, triggerVisibility, revealedSensitivePostsById);
              return (
              <div
                key={post.id}
                onClick={() => onPostClick(post)}
                className={`aspect-square bg-slate-200 rounded-lg overflow-hidden cursor-pointer relative ${post.isChallenge ? 'ring-4 ring-amber-400' : ''}`}
              >
                {covered ? <SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(post.id)} /> : null}
                <img src={post.imageUrl} className="relative z-0 w-full h-full object-cover" />
              </div>
            );})}
         </div>
      </div>
   );
}

function FetchedProfile({ userId, posts, onPostClick, allUsers, setView, currentUserId, currentProfile, triggerVisibility, isFan, fanBusy, fanError, onToggleFan, revealedSensitivePostsById, onRevealSensitivePost }) {
  const [fetchedUser, setFetchedUser] = useState(null);
  useEffect(() => {
    const resolved = resolveProfileFromCollections({ userId, allUsers, currentUserId, currentProfile });
    if (resolved) {
      setFetchedUser(resolved);
    }

    fetchUserIndex(userId).then((data) => {
      if (data) {
        setFetchedUser((prev) => normalizeProfileData(
          { ...(prev || {}), ...data, uid: data?.uid || userId },
          userId,
          { fallbackRoles: [] },
        ));
      }
    });
  }, [userId, allUsers, currentUserId, currentProfile]);
  if (!fetchedUser) return <div>Loading...</div>;
  return <ImmersiveProfile profile={fetchedUser} isOwn={false} posts={getProfileVisiblePosts(posts, userId, fetchedUser?.contributorId)} onPostClick={onPostClick} allUsers={allUsers} onChallengeClick={() => setView('challenge_timeline')} triggerVisibility={triggerVisibility} currentUserId={currentUserId} isFan={isFan} fanBusy={fanBusy} fanError={fanError} onToggleFan={onToggleFan} revealedSensitivePostsById={revealedSensitivePostsById} onRevealSensitivePost={onRevealSensitivePost} />;
}
function UserPreviewModal({ userId, onClose, onFullProfile, posts, allUsers, currentUserId, currentProfile, triggerVisibility, revealedSensitivePostsById, onRevealSensitivePost }) {
  const targetSeedProfile = useMemo(
    () => resolveProfileFromCollections({ userId, allUsers, currentUserId, currentProfile }),
    [userId, allUsers, currentUserId, currentProfile],
  );
  const [userProfile, setUserProfile] = useState(targetSeedProfile);
  const [isFan, setIsFan] = useState(false);
  const [fanBusy, setFanBusy] = useState(false);
  const [fanError, setFanError] = useState('');
  const targetSeedCounts = useMemo(() => seedCountsFromProfile(targetSeedProfile, targetSeedProfile), [targetSeedProfile]);
  const [fanCounts, setFanCounts] = useState(() => targetSeedCounts);
  const fanBusyRef = useRef(false);
  const fanRequestRef = useRef(0);
  const fanTargetRef = useRef(userId);
  const bufferedLiveCountsRef = useRef(null);
  const hasLiveCountsRef = useRef(false);

  useEffect(() => {
    let isActive = true;
    if (targetSeedProfile) {
      setUserProfile(targetSeedProfile);
    }

    fetchUserIndex(userId).then((data) => {
      if (isActive && data) {
        setUserProfile((prev) => normalizeProfileData(
          { ...(prev || {}), ...data, uid: data?.uid || userId },
          userId,
          { fallbackRoles: [] },
        ));
      }
    });

    return () => {
      isActive = false;
    };
  }, [userId, allUsers, currentUserId, currentProfile]);

  useEffect(() => {
    fanTargetRef.current = userId;
    setFanError('');
    setFanBusy(false);
    setIsFan(false);
    setFanCounts(targetSeedCounts);
    bufferedLiveCountsRef.current = null;
    hasLiveCountsRef.current = false;
    fanRequestRef.current += 1;

    if (!userId || !currentUserId || currentUserId === userId) {
      return () => {};
    }

    let isActive = true;
    const unsubscribeStatus = subscribeToFanStatus(userId, (exists) => {
      if (!isActive) return;
      setIsFan(exists);
    }, { expectedAuthUid: currentUserId });
    const unsubscribeCounts = subscribeToFanCounts(userId, (counts) => {
      if (!isActive) return;
      const normalizedCounts = {
        fansCount: Number(counts?.fansCount || 0),
        fanOfCount: Number(counts?.fanOfCount || 0),
      };
      hasLiveCountsRef.current = true;
      if (fanBusyRef.current) {
        bufferedLiveCountsRef.current = normalizedCounts;
        return;
      }
      setFanCounts(normalizedCounts);
    });

    return () => {
      isActive = false;
      unsubscribeStatus?.();
      unsubscribeCounts?.();
    };
  }, [currentUserId, targetSeedCounts, userId]);

  useEffect(() => {
    const canFanUser = Boolean(currentUserId && userId && currentUserId !== userId);
    if (!canFanUser) return;
    if (fanBusyRef.current) return;
    if (hasLiveCountsRef.current) return;
    setFanCounts(targetSeedCounts);
  }, [currentUserId, targetSeedCounts, userId]);

  useEffect(() => {
    fanBusyRef.current = fanBusy;
    if (!fanBusy && bufferedLiveCountsRef.current) {
      setFanCounts(bufferedLiveCountsRef.current);
      bufferedLiveCountsRef.current = null;
    }
  }, [fanBusy]);

  const handleFanToggle = useCallback(async () => {
    if (!userId || !currentUserId || currentUserId === userId || fanBusy) return;
    const requestId = fanRequestRef.current + 1;
    fanRequestRef.current = requestId;
    const targetAtStart = userId;

    const previousFan = isFan;
    const nextFan = !previousFan;
    const previousCounts = fanCounts;
    setFanError('');
    setFanBusy(true);
    setIsFan(nextFan);
    setFanCounts((prev) => ({
      ...prev,
      fansCount: Math.max(0, Number(prev?.fansCount || 0) + (nextFan ? 1 : -1)),
    }));

    try {
      await setFanStatus(userId, nextFan);
    } catch (error) {
      if (fanRequestRef.current !== requestId || fanTargetRef.current !== targetAtStart) return;
      setIsFan(previousFan);
      setFanCounts(previousCounts);
      setFanError(error?.message || 'Kon fanstatus niet opslaan. Probeer opnieuw.');
      getFanDebugContext(userId)
        .then((context) => {
          console.info('Fan toggle diagnostic context', context);
        })
        .catch(() => {});
    } finally {
      const isCurrentRequest = fanRequestRef.current === requestId && fanTargetRef.current === targetAtStart;
      if (isCurrentRequest) setFanBusy(false);
    }
  }, [currentUserId, fanBusy, fanCounts, isFan, userId]);

  // All hooks must be called in the same order on every render
  // Moved BEFORE the early return to prevent "Rendered more hooks" error
  const roles = userProfile?.roles || [];
  const themes = userProfile?.themes || [];
  const roleLabel = (roleId) => ROLES.find((x) => x.id === roleId)?.label || 'Onbekende rol';
  const userPosts = useMemo(() => getProfileVisiblePosts(posts, userId, userProfile?.contributorId), [posts, userId, userProfile?.contributorId]);
  const previewMode = userProfile?.quickProfilePreviewMode || 'latest';
  const manualIds = Array.isArray(userProfile?.quickProfilePostIds) ? userProfile.quickProfilePostIds : [];
  const previewPosts = useMemo(() => {
    let rankedPosts = [];
    if (previewMode === 'manual' && manualIds.length) {
      const manualPosts = manualIds
        .map((id) => userPosts.find((post) => post.id === id))
        .filter(Boolean);
      if (manualPosts.length) rankedPosts = manualPosts;
    }
    if (!rankedPosts.length && previewMode === 'best') {
      rankedPosts = [...userPosts]
        .sort((a, b) => (b.likes || 0) - (a.likes || 0));
    }
    if (!rankedPosts.length) {
      rankedPosts = [...userPosts];
    }
    return rankedPosts
      .filter((post) => getPostContentPreference(post, triggerVisibility) !== 'hideFeed')
      .slice(0, 3);
  }, [manualIds, previewMode, triggerVisibility, userPosts]);
  const headerImage = userProfile?.headerImage || userProfile?.avatar;
  const resolvedFansCount = Number(fanCounts?.fansCount ?? userProfile?.fansCount ?? 0);
  const resolvedFanOfCount = Number(fanCounts?.fanOfCount ?? userProfile?.fanOfCount ?? 0);
  const canFanUser = Boolean(currentUserId && userId && currentUserId !== userId);

  // Early return after all hooks
  if (!userProfile) {
    return (
      <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-2 md:p-6">
        <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-3xl p-4 md:p-8 w-full max-w-md text-center shadow-2xl">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-300">Profiel laden...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-2 md:p-6">
      <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[28px] w-full max-w-3xl xl:max-w-4xl max-h-[calc(100dvh-1rem)] md:max-h-[calc(100vh-2rem)] shadow-2xl overflow-hidden border border-white/10 flex flex-col">
        <div className="relative h-40 md:h-72 w-full shrink-0">
          <img src={headerImage} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/50 to-black/90" />
          <div className="absolute inset-x-0 bottom-0 p-4 md:p-8 text-white">
            <h2 className="text-2xl md:text-4xl font-bold mb-2 md:mb-3">{userProfile.displayName}</h2>
            <div className="flex flex-wrap gap-1.5 md:gap-2 mb-2 md:mb-4">
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
            <div className="flex gap-4 mt-3 text-xs font-semibold text-white/85">
              <span>Fans: {resolvedFansCount}</span>
              <span>Fan van: {resolvedFanOfCount}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="absolute top-3 right-3 md:top-6 md:right-6 w-9 h-9 md:w-10 md:h-10 rounded-full bg-black/50 text-white flex items-center justify-center backdrop-blur-md hover:bg-black/70 transition"
            aria-label="Sluiten"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 md:p-8 space-y-4 md:space-y-6 overflow-y-auto no-scrollbar">
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
              <AdaptivePhotoGrid
                posts={previewPosts}
                getShouldCover={(post) => shouldCoverPost(post, triggerVisibility, revealedSensitivePostsById)}
                renderOverlay={(post) => <SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(post.id)} />}
                renderFooter={(post) => (
                  <span className="block p-3">
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">{post.title}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{post.description}</span>
                  </span>
                )}
              />
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
            {canFanUser ? (
              <Button onClick={handleFanToggle} variant="secondary" className="flex-1" disabled={fanBusy}>
                {fanBusy ? 'Fanstatus opslaan...' : (isFan ? 'Stop fan zijn' : 'Word fan')}
              </Button>
            ) : null}
          </div>
          {canFanUser ? (
            <p className="text-xs text-slate-500 dark:text-slate-300">Word fan van deze maker om die makkelijker terug te vinden.</p>
          ) : null}
          {canFanUser && fanError ? (
            <p className="text-sm text-red-500 dark:text-red-300">{fanError}</p>
          ) : null}
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
  triggerVisibility,
  revealedSensitivePostsById,
  onRevealSensitivePost,
  authUser,
  userProfile,
  functionsBase,
  setView,
  authReady,
  logListenerStart,
  handleListenerError,
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
    const [claimRequestData, setClaimRequestData] = useState(null);
    const [websiteProofState, setWebsiteProofState] = useState({
      token: '',
      url: '',
      expiresAt: null,
      loading: false,
      verifying: false,
      error: '',
      success: '',
    });
    const [emailProofState, setEmailProofState] = useState({
      path: '',
      emailMasked: '',
      expiresAt: null,
      loading: false,
      error: '',
      success: '',
    });
    const [contributorInfo, setContributorInfo] = useState(null);
    const [loadingContributor, setLoadingContributor] = useState(false);
    const [inviteLink, setInviteLink] = useState('');
    const [inviteLoading, setInviteLoading] = useState(false);
    const [inviteError, setInviteError] = useState('');
    const [inviteCopied, setInviteCopied] = useState(false);
    const [contentRequest, setContentRequest] = useState({ postId: '', requestType: 'hide', reason: '' });
    const [contentRequestBusy, setContentRequestBusy] = useState(false);
    const [contentRequestError, setContentRequestError] = useState('');
    const [contentRequestSuccess, setContentRequestSuccess] = useState('');
    const [websiteAlias, setWebsiteAlias] = useState(null);

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
      if (!authReady || !contributorId) {
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
    }, [authReady, contributorId]);

    useEffect(() => {
      let active = true;
      if (!authReady || !contributorId) {
        setWebsiteAlias(null);
        return () => {};
      }
      const loadWebsiteAlias = async () => {
        try {
          const db = getFirebaseDbInstance();
          const aliasQuery = query(
            collection(db, CLAIMS_COLLECTIONS.contributorAliases),
            where('contributorId', '==', contributorId),
            where('type', '==', 'domain'),
            limit(1)
          );
          const snapshot = await getDocs(aliasQuery);
          if (!active) return;
          if (snapshot.empty) {
            setWebsiteAlias(null);
            return;
          }
          const docSnap = snapshot.docs[0];
          const data = docSnap.data() || {};
          setWebsiteAlias({
            aliasId: docSnap.id,
            domain: data.value || '',
          });
        } catch (error) {
          if (active) setWebsiteAlias(null);
        }
      };
      loadWebsiteAlias();
      return () => {
        active = false;
      };
    }, [authReady, contributorId]);

    useEffect(() => {
      if (!authReady || !claimRequestId) {
        setClaimRequestData(null);
        return () => {};
      }
      logListenerStart('ShadowProfile claim request listener (ArtesApp)');
      const unsubscribe = onSnapshot(
        getClaimRequestRef(claimRequestId),
        (snapshot) => {
          setClaimRequestData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
        },
        (error) => {
          handleListenerError('ShadowProfile claim request listener (ArtesApp)', error);
        }
      );
      return () => unsubscribe();
    }, [authReady, claimRequestId, logListenerStart, handleListenerError]);

    const isLoggedIn = Boolean(authUser?.uid);
    const requiresIdCheck = isLoggedIn && (!userProfile?.ageVerified || (userProfile?.onboardingStep ?? 0) < 2);
    const claimedByUid = contributorInfo?.claimedByUid || contributorInfo?.claimedBy || null;
    const claimedByCurrentUser = Boolean(claimedByUid && claimedByUid === authUser?.uid);
    const claimedByOther = Boolean(claimedByUid && claimedByUid !== authUser?.uid);

    const hasInstagramAlias = Boolean(contributorInfo?.instagramHandle)
      || externalLinks.some((link) => link.type === 'instagram');
    const hasWebsiteAlias = Boolean(websiteAlias?.domain);
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
          key: 'website',
          title: 'Verifieer via website',
          description: 'Plaats een token op je bestaande website om te bewijzen dat je eigenaar bent.',
          placeholder: false,
        });
      }
      if (hasEmailAlias) {
        methods.push({
          key: 'email',
          title: 'Email verificatie',
          description: 'Ontvang een verificatielink op het emailadres dat al aan dit profiel hangt.',
          placeholder: false,
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
      setWebsiteProofState({
        token: '',
        url: '',
        expiresAt: null,
        loading: false,
        verifying: false,
        error: '',
        success: '',
      });
      setEmailProofState({
        path: '',
        emailMasked: '',
        expiresAt: null,
        loading: false,
        error: '',
        success: '',
      });
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
        return data;
      } catch (error) {
        console.error('[ShadowProfileModal] Claim request failed', error);
        setClaimError(error?.message || 'Claim verzoek mislukt.');
        return null;
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

    const handleStartWebsiteClaim = async () => {
      const data = await startClaimRequest({ mode: 'link', method: 'website' });
      if (!data?.requestId) return;
      setWebsiteProofState((prev) => ({
        ...prev,
        loading: true,
        error: '',
        success: '',
      }));
      try {
        const result = await startWebsiteClaimProof({ requestId: data.requestId });
        setWebsiteProofState({
          token: result?.token || '',
          url: result?.url || '',
          expiresAt: result?.expiresAt || null,
          loading: false,
          verifying: false,
          error: '',
          success: 'Token gegenereerd. Plaats het bestand en controleer daarna.',
        });
      } catch (error) {
        setWebsiteProofState((prev) => ({
          ...prev,
          loading: false,
          verifying: false,
          error: error?.message || 'Website token genereren mislukt.',
        }));
      }
    };

    const handleStartEmailClaim = async () => {
      const data = await startClaimRequest({ mode: 'link', method: 'email' });
      if (!data?.requestId) return;
      setEmailProofState((prev) => ({
        ...prev,
        loading: true,
        error: '',
        success: '',
      }));
      try {
        const result = await startEmailClaimProof({ requestId: data.requestId });
        setEmailProofState({
          path: result?.path || '',
          emailMasked: result?.emailMasked || '',
          expiresAt: result?.expiresAt || null,
          loading: false,
          error: '',
          success: 'Verificatielink verstuurd. Check je mailbox.',
        });
      } catch (error) {
        setEmailProofState((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || 'Email verificatie starten mislukt.',
        }));
      }
    };

    const handleResendEmailProof = async () => {
      if (!claimRequestId) return;
      setEmailProofState((prev) => ({
        ...prev,
        loading: true,
        error: '',
        success: '',
      }));
      try {
        const result = await startEmailClaimProof({ requestId: claimRequestId });
        setEmailProofState({
          path: result?.path || '',
          emailMasked: result?.emailMasked || '',
          expiresAt: result?.expiresAt || null,
          loading: false,
          error: '',
          success: 'Verificatielink opnieuw verstuurd.',
        });
      } catch (error) {
        setEmailProofState((prev) => ({
          ...prev,
          loading: false,
          error: error?.message || 'Email opnieuw versturen mislukt.',
        }));
      }
    };

    const handleVerifyWebsiteClaim = async () => {
      if (!claimRequestId) return;
      setWebsiteProofState((prev) => ({
        ...prev,
        verifying: true,
        error: '',
        success: '',
      }));
      try {
        const result = await verifyWebsiteClaimProof({ requestId: claimRequestId });
        const status = result?.status || 'pending';
        const successText = status === 'approved'
          ? 'Website verificatie gelukt. Je claim is goedgekeurd.'
          : 'Website verificatie gelukt. We wachten nog op een community vouch.';
        setWebsiteProofState((prev) => ({
          ...prev,
          verifying: false,
          success: successText,
        }));
      } catch (error) {
        setWebsiteProofState((prev) => ({
          ...prev,
          verifying: false,
          error: error?.message || 'Website verificatie mislukt.',
        }));
      }
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


    const handleContributorContentRequest = async () => {
      if (!claimedByCurrentUser || !contributorId) return;
      const postId = contentRequest.postId || shadowPosts[0]?.id || '';
      if (!postId) {
        setContentRequestError('Kies eerst een post.');
        return;
      }
      setContentRequestBusy(true);
      setContentRequestError('');
      setContentRequestSuccess('');
      try {
        const result = await createContributorContentRequest({
          contributorId,
          postId,
          requestType: contentRequest.requestType,
          reason: contentRequest.reason,
        });
        setContentRequestSuccess(`Verzoek ontvangen (${result.id}).`);
        setContentRequest((prev) => ({ ...prev, reason: '' }));
      } catch (error) {
        setContentRequestError(error?.message || 'Verzoek versturen mislukt.');
      } finally {
        setContentRequestBusy(false);
      }
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
                          {claimMethods.map((method) => {
                            const proofSummary = method.key === 'website' || method.key === 'email'
                              ? getProofStatusSummary(claimRequestData?.proofData, method.key)
                              : null;
                            const statusTone = proofSummary?.status === 'verified'
                              ? 'text-emerald-200'
                              : proofSummary?.status === 'failed'
                                ? 'text-rose-200'
                                : 'text-amber-200';
                            const statusTimestamp = formatProofTimestamp(proofSummary?.lastCheckedAt);
                            return (
                              <div
                                key={method.key}
                                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-white">{method.title}</p>
                                    <p className="text-xs text-white/70">{method.description}</p>
                                    {proofSummary && (
                                      <p className={`mt-1 text-[11px] ${statusTone}`}>
                                        Status: {PROOF_STATUS_LABELS[proofSummary.status]}
                                        {statusTimestamp ? ` · Laatste check ${statusTimestamp}` : ''}
                                      </p>
                                    )}
                                  </div>
                                  {method.placeholder ? (
                                    <span className="text-[10px] uppercase tracking-wide text-white/60">Binnenkort</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (method.key === 'instagramScreenshot') {
                                          handleStartInstagramScreenshotClaim();
                                        } else if (method.key === 'email') {
                                          handleStartEmailClaim();
                                        } else if (method.key === 'website') {
                                          handleStartWebsiteClaim();
                                        } else {
                                          handleStartVouchClaim();
                                        }
                                      }}
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
                                {method.key === 'email' && claimMethod === 'email' && (
                                  <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/80 space-y-2">
                                    <p className="font-semibold text-white">Bevestig via email</p>
                                    <p className="text-[11px] text-white/70">
                                      We sturen een verificatielink naar {emailProofState.emailMasked || 'het bekende emailadres'}.
                                      Open de link om je claim te bevestigen.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <button
                                        type="button"
                                        onClick={handleResendEmailProof}
                                        disabled={emailProofState.loading}
                                        className="rounded-full bg-white text-indigo-900 px-4 py-2 text-xs font-semibold shadow-sm hover:bg-indigo-50 transition disabled:opacity-60"
                                      >
                                        {emailProofState.loading ? 'Versturen...' : 'Stuur verificatielink opnieuw'}
                                      </button>
                                      {emailProofState.path && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            window.location.href = emailProofState.path;
                                          }}
                                          className="rounded-full border border-white/40 text-white px-4 py-2 text-xs font-semibold shadow-sm hover:bg-white/10 transition"
                                        >
                                          Open verificatielink
                                        </button>
                                      )}
                                    </div>
                                    {emailProofState.error && (
                                      <p className="text-[11px] text-rose-200">{emailProofState.error}</p>
                                    )}
                                    {emailProofState.success && (
                                      <p className="text-[11px] text-emerald-200">{emailProofState.success}</p>
                                    )}
                                  </div>
                                )}
                                {method.key === 'website' && claimMethod === 'website' && (
                                  <div className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/80 space-y-2">
                                    <p className="font-semibold text-white">Plaats dit bestand op je website</p>
                                    {websiteProofState.url && (
                                      <p className="break-all text-[11px] text-white/70">{websiteProofState.url}</p>
                                    )}
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="rounded-full bg-white text-indigo-900 px-3 py-1 text-xs font-semibold">
                                        {websiteProofState.token || 'Token wordt gegenereerd...'}
                                      </span>
                                      {websiteProofState.expiresAt && (
                                        <span className="text-[11px] text-white/70">
                                          Geldig tot {new Date(websiteProofState.expiresAt).toLocaleTimeString('nl-NL', {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-white/70">
                                      Maak een tekstbestand met exact deze token als inhoud en zet het op
                                      <span className="font-semibold text-white"> /.well-known/artes-claim.txt</span>.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                      <button
                                        type="button"
                                        onClick={handleVerifyWebsiteClaim}
                                        disabled={websiteProofState.verifying || websiteProofState.loading}
                                        className="rounded-full bg-white text-indigo-900 px-4 py-2 text-xs font-semibold shadow-sm hover:bg-indigo-50 transition disabled:opacity-60"
                                      >
                                        {websiteProofState.verifying ? 'Controleren...' : 'Controleer verificatie'}
                                      </button>
                                    </div>
                                    {websiteProofState.error && (
                                      <p className="text-[11px] text-rose-200">{websiteProofState.error}</p>
                                    )}
                                    {websiteProofState.success && (
                                      <p className="text-[11px] text-emerald-200">{websiteProofState.success}</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
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
            {claimedByCurrentUser && (
              <div className="absolute left-6 right-6 bottom-4 rounded-2xl bg-white/10 p-3 text-left text-xs text-white shadow-lg backdrop-blur">
                <p className="font-semibold">Geclaimd profiel: correctie, verbergen of verwijderen aanvragen</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr]">
                  <select
                    value={contentRequest.postId || shadowPosts[0]?.id || ''}
                    onChange={(e) => setContentRequest((prev) => ({ ...prev, postId: e.target.value }))}
                    className="rounded-lg border border-white/20 bg-slate-900/80 p-2 text-white"
                  >
                    {shadowPosts.map((post) => (
                      <option key={post.id} value={post.id}>{post.title || post.id}</option>
                    ))}
                  </select>
                  <select
                    value={contentRequest.requestType}
                    onChange={(e) => setContentRequest((prev) => ({ ...prev, requestType: e.target.value }))}
                    className="rounded-lg border border-white/20 bg-slate-900/80 p-2 text-white"
                  >
                    <option value="hide">Verbergen</option>
                    <option value="remove">Verwijderen</option>
                    <option value="correction">Correctie</option>
                  </select>
                </div>
                <textarea
                  value={contentRequest.reason}
                  onChange={(e) => setContentRequest((prev) => ({ ...prev, reason: e.target.value }))}
                  placeholder="Licht je verzoek toe voor audit en moderator opvolging."
                  className="mt-2 w-full rounded-lg border border-white/20 bg-slate-900/80 p-2 text-white placeholder:text-white/50"
                />
                <button
                  type="button"
                  onClick={handleContributorContentRequest}
                  disabled={contentRequestBusy || shadowPosts.length === 0}
                  className="mt-2 rounded-full bg-white px-4 py-2 font-semibold text-indigo-900 disabled:opacity-60"
                >
                  {contentRequestBusy ? 'Versturen...' : 'Verzoek versturen'}
                </button>
                {contentRequestError && <p className="mt-1 text-rose-200">{contentRequestError}</p>}
                {contentRequestSuccess && <p className="mt-1 text-emerald-200">{contentRequestSuccess}</p>}
              </div>
            )}
            <button onClick={onClose} className="absolute top-4 right-4">
              <X />
            </button>
          </div>
          <div className="flex-1 p-6 overflow-y-auto no-scrollbar">
            <div className="grid grid-cols-3 gap-2">
              {shadowPosts
                .filter((post) => getPostContentPreference(post, triggerVisibility) !== 'hideFeed')
                .map((p) => {
                  const covered = shouldCoverPost(p, triggerVisibility, revealedSensitivePostsById);
                  return (
                <div key={p.id} onClick={() => onPostClick(p)} className="relative aspect-square bg-slate-800 overflow-hidden">
                  {covered ? <SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(p.id)} /> : null}
                  <img src={p.imageUrl} className="relative z-0 w-full h-full object-cover" />
                </div>
              );})}
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
  authReady,
  logListenerStart,
  handleListenerError,
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
  const [claimMethod, setClaimMethod] = useState('vouch');
  const [claimRequestData, setClaimRequestData] = useState(null);
  const [websiteProofState, setWebsiteProofState] = useState({
    token: '',
    url: '',
    expiresAt: null,
    loading: false,
    verifying: false,
    error: '',
    success: '',
  });
  const [emailProofState, setEmailProofState] = useState({
    path: '',
    emailMasked: '',
    expiresAt: null,
    loading: false,
    error: '',
    success: '',
  });

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

  useEffect(() => {
    if (!authReady || !claimRequestId) {
      setClaimRequestData(null);
      return () => {};
    }
    logListenerStart('Claim invite request listener (ArtesApp)');
    const unsubscribe = onSnapshot(
      getClaimRequestRef(claimRequestId),
      (snapshot) => {
        setClaimRequestData(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
      },
      (error) => {
        handleListenerError('Claim invite request listener (ArtesApp)', error);
      }
    );
    return () => unsubscribe();
  }, [authReady, claimRequestId, logListenerStart, handleListenerError]);

  useEffect(() => {
    if (!preview?.availableProofMethods) return;
    const available = preview.availableProofMethods;
    const hasInstagram = available.includes('instagram');
    const hasWebsite = available.includes('website');
    const hasEmail = available.includes('email');
    if (claimMethod === 'instagramScreenshot' && !hasInstagram) {
      setClaimMethod('vouch');
    }
    if (claimMethod === 'website' && !hasWebsite) {
      setClaimMethod('vouch');
    }
    if (claimMethod === 'email' && !hasEmail) {
      setClaimMethod('vouch');
    }
  }, [preview, claimMethod]);

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
    setClaimProofError('');
    setClaimProofSuccess('');
    setWebsiteProofState({
      token: '',
      url: '',
      expiresAt: null,
      loading: false,
      verifying: false,
      error: '',
      success: '',
    });
    setEmailProofState({
      path: '',
      emailMasked: '',
      expiresAt: null,
      loading: false,
      error: '',
      success: '',
    });
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
          method: claimMethod,
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
      if (claimMethod === 'website' && data?.requestId) {
        setWebsiteProofState((prev) => ({
          ...prev,
          loading: true,
          error: '',
          success: '',
        }));
        try {
          const result = await startWebsiteClaimProof({ requestId: data.requestId });
          setWebsiteProofState({
            token: result?.token || '',
            url: result?.url || '',
            expiresAt: result?.expiresAt || null,
            loading: false,
            verifying: false,
            error: '',
            success: 'Token gegenereerd. Plaats het bestand en controleer daarna.',
          });
        } catch (error) {
          setWebsiteProofState((prev) => ({
            ...prev,
            loading: false,
            verifying: false,
            error: error?.message || 'Website token genereren mislukt.',
          }));
        }
      }
      if (claimMethod === 'email' && data?.requestId) {
        setEmailProofState((prev) => ({
          ...prev,
          loading: true,
          error: '',
          success: '',
        }));
        try {
          const result = await startEmailClaimProof({ requestId: data.requestId });
          setEmailProofState({
            path: result?.path || '',
            emailMasked: result?.emailMasked || '',
            expiresAt: result?.expiresAt || null,
            loading: false,
            error: '',
            success: 'Verificatielink verstuurd. Check je mailbox.',
          });
        } catch (error) {
          setEmailProofState((prev) => ({
            ...prev,
            loading: false,
            error: error?.message || 'Email verificatie starten mislukt.',
          }));
        }
      }
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

  const handleVerifyWebsiteClaim = async () => {
    if (!claimRequestId) return;
    setWebsiteProofState((prev) => ({
      ...prev,
      verifying: true,
      error: '',
      success: '',
    }));
    try {
      const result = await verifyWebsiteClaimProof({ requestId: claimRequestId });
      const status = result?.status || 'pending';
      const successText = status === 'approved'
        ? 'Website verificatie gelukt. Je claim is goedgekeurd.'
        : 'Website verificatie gelukt. We wachten nog op een community vouch.';
      setWebsiteProofState((prev) => ({
        ...prev,
        verifying: false,
        success: successText,
      }));
    } catch (error) {
      setWebsiteProofState((prev) => ({
        ...prev,
        verifying: false,
        error: error?.message || 'Website verificatie mislukt.',
      }));
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

  const claimMethodOptions = useMemo(() => {
    const options = [
      {
        key: 'vouch',
        title: 'Community vouch',
        description: 'Vraag bestaande members om jouw claim te bevestigen.',
      },
    ];
    if (preview?.availableProofMethods?.includes('instagram')) {
      options.push({
        key: 'instagramScreenshot',
        title: 'Instagram screenshot',
        description: 'Plaats een code in je bio en upload daarna een screenshot.',
      });
    }
    if (preview?.availableProofMethods?.includes('website')) {
      options.push({
        key: 'website',
        title: 'Verifieer via website',
        description: 'Plaats een token op je bestaande website om eigenaarschap te bewijzen.',
      });
    }
    if (preview?.availableProofMethods?.includes('email')) {
      options.push({
        key: 'email',
        title: 'Email verificatie',
        description: 'Ontvang een verificatielink op het emailadres dat al aan het profiel hangt.',
      });
    }
    return options;
  }, [preview]);

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
            {authUser && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Kies verificatiemethode</p>
                <div className="grid gap-2">
                  {claimMethodOptions.map((option) => {
                    const proofSummary = option.key === 'email' || option.key === 'website'
                      ? getProofStatusSummary(claimRequestData?.proofData, option.key)
                      : null;
                    const statusTone = proofSummary?.status === 'verified'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : proofSummary?.status === 'failed'
                        ? 'text-rose-500 dark:text-rose-400'
                        : 'text-amber-600 dark:text-amber-400';
                    const statusTimestamp = formatProofTimestamp(proofSummary?.lastCheckedAt);
                    return (
                      <label
                        key={option.key}
                        className="flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300"
                      >
                        <input
                          type="radio"
                          name="claim-method"
                          value={option.key}
                          checked={claimMethod === option.key}
                          onChange={() => setClaimMethod(option.key)}
                          className="mt-1"
                        />
                        <span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{option.title}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">{option.description}</span>
                          {proofSummary && (
                            <span className={`mt-1 block text-[11px] ${statusTone}`}>
                              Status: {PROOF_STATUS_LABELS[proofSummary.status]}
                              {statusTimestamp ? ` · Laatste check ${statusTimestamp}` : ''}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
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
            {claimSuccess && claimMethod === 'instagramScreenshot' && claimCode && (
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
            {claimSuccess && claimMethod === 'email' && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p className="font-semibold text-slate-700 dark:text-slate-200">Bevestig via email</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  We sturen een verificatielink naar {emailProofState.emailMasked || 'het bekende emailadres'}.
                  Open de link om je claim te bevestigen.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!claimRequestId) return;
                      setEmailProofState((prev) => ({
                        ...prev,
                        loading: true,
                        error: '',
                        success: '',
                      }));
                      try {
                        const result = await startEmailClaimProof({ requestId: claimRequestId });
                        setEmailProofState({
                          path: result?.path || '',
                          emailMasked: result?.emailMasked || '',
                          expiresAt: result?.expiresAt || null,
                          loading: false,
                          error: '',
                          success: 'Verificatielink opnieuw verstuurd.',
                        });
                      } catch (error) {
                        setEmailProofState((prev) => ({
                          ...prev,
                          loading: false,
                          error: error?.message || 'Email opnieuw versturen mislukt.',
                        }));
                      }
                    }}
                    disabled={emailProofState.loading || !claimRequestId}
                    className="rounded-full bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-60"
                  >
                    {emailProofState.loading ? 'Versturen...' : 'Stuur verificatielink opnieuw'}
                  </button>
                  {emailProofState.path && (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = emailProofState.path;
                      }}
                      className="rounded-full border border-emerald-600 text-emerald-700 dark:text-emerald-300 px-4 py-2 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition"
                    >
                      Open verificatielink
                    </button>
                  )}
                </div>
                {emailProofState.error && (
                  <p className="text-xs text-rose-500">{emailProofState.error}</p>
                )}
                {emailProofState.success && (
                  <p className="text-xs text-emerald-500">{emailProofState.success}</p>
                )}
              </div>
            )}
            {claimSuccess && claimMethod === 'website' && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                <p className="font-semibold text-slate-700 dark:text-slate-200">Plaats dit bestand op je website</p>
                {websiteProofState.url && (
                  <p className="break-all text-xs text-slate-500 dark:text-slate-400">{websiteProofState.url}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="rounded-full bg-emerald-600 text-white px-3 py-1 text-xs font-semibold">
                    {websiteProofState.token || 'Token wordt gegenereerd...'}
                  </span>
                  {websiteProofState.expiresAt && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Geldig tot {new Date(websiteProofState.expiresAt).toLocaleTimeString('nl-NL', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Maak een tekstbestand met exact deze token als inhoud en zet het op
                  <span className="font-semibold text-slate-700 dark:text-slate-200"> /.well-known/artes-claim.txt</span>.
                </p>
                <button
                  type="button"
                  onClick={handleVerifyWebsiteClaim}
                  disabled={websiteProofState.verifying || websiteProofState.loading}
                  className="rounded-full bg-emerald-600 text-white px-4 py-2 text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-60"
                >
                  {websiteProofState.verifying ? 'Controleren...' : 'Controleer verificatie'}
                </button>
                {websiteProofState.error && (
                  <p className="text-xs text-rose-500">{websiteProofState.error}</p>
                )}
                {websiteProofState.success && (
                  <p className="text-xs text-emerald-500">{websiteProofState.success}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimEmailPage({ authUser, setView }) {
  const [verifyState, setVerifyState] = useState({
    loading: false,
    error: '',
    success: '',
    status: '',
  });
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestId = params.get('requestId');
  const token = params.get('token');

  const handleLogin = () => {
    if (setView) setView('login');
  };

  useEffect(() => {
    let active = true;
    if (!authUser || !requestId || !token) return () => {};
    const verify = async () => {
      setVerifyState({
        loading: true,
        error: '',
        success: '',
        status: '',
      });
      try {
        const result = await verifyEmailClaimProof({ requestId, token });
        if (!active) return;
        const status = result?.status || 'pending';
        const successMessage = status === 'approved'
          ? 'Email verificatie gelukt. Je claim is goedgekeurd.'
          : status === 'needsModeration'
            ? 'Email verificatie gelukt. We wachten op een moderator.'
            : 'Email verificatie gelukt. We wachten nog op een community vouch.';
        setVerifyState({
          loading: false,
          error: '',
          success: successMessage,
          status,
        });
      } catch (error) {
        if (!active) return;
        setVerifyState({
          loading: false,
          error: error?.message || 'Email verificatie mislukt.',
          success: '',
          status: '',
        });
      }
    };
    verify();
    return () => {
      active = false;
    };
  }, [authUser, requestId, token]);

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Email claim</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Bevestig je claim</h1>
          <p className="text-sm text-slate-500 dark:text-slate-300 mt-2">
            Open deze pagina vanuit je mailbox om te bevestigen dat je toegang hebt tot het emailadres.
          </p>
        </div>

        {!requestId || !token ? (
          <p className="text-sm text-rose-500">De verificatielink is ongeldig of onvolledig.</p>
        ) : null}

        {!authUser && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Log in om de email verificatie te voltooien.
            </p>
            <button
              type="button"
              onClick={handleLogin}
              className="w-full rounded-full bg-blue-600 text-white px-6 py-3 text-sm font-semibold hover:bg-blue-700 transition"
            >
              Inloggen of account maken
            </button>
          </div>
        )}

        {authUser && requestId && token && (
          <div className="space-y-2">
            {verifyState.loading && (
              <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Verificatie controleren...
              </div>
            )}
            {verifyState.error && (
              <p className="text-sm text-rose-500">{verifyState.error}</p>
            )}
            {verifyState.success && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">{verifyState.success}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
function AppShortcutInfoContent() {
  return (
    <div className="space-y-4 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
      <p>Helaas is Artes nog niet te downloaden als app in de App Store of Play Store. Maar je kunt Artes wel als snelkoppeling op je telefoon, tablet of computer zetten. Zo kun je Artes toch gebruiken zoals je dat bij je andere apps gewend bent.</p>
      <p className="font-semibold text-slate-900 dark:text-slate-100">Zo doe je dat:</p>
      <p><span className="font-semibold text-slate-900 dark:text-slate-100">Chrome:</span><br />1. Open Artes in Chrome.<br />2. Tik of klik op het menu met de drie puntjes.<br />3. Kies Casten, opslaan en delen.<br />4. Kies Snelkoppeling maken of App installeren.<br />5. Kies eventueel Openen als venster.</p>
      <p><span className="font-semibold text-slate-900 dark:text-slate-100">Edge:</span><br />1. Open Artes in Edge.<br />2. Tik of klik op het menu met de drie puntjes.<br />3. Kies Apps.<br />4. Kies Deze site installeren als app.</p>
      <p><span className="font-semibold text-slate-900 dark:text-slate-100">Safari op iPhone of iPad:</span><br />1. Open Artes in Safari.<br />2. Tik op de deelknop.<br />3. Kies Zet op beginscherm.<br />4. Bevestig met Voeg toe.</p>
      <p><span className="font-semibold text-slate-900 dark:text-slate-100">Safari op Mac:</span><br />1. Open Artes in Safari.<br />2. Klik op de deelknop of ga naar Archief.<br />3. Kies Voeg toe aan Dock.</p>
      <p>Je kunt deze uitleg later altijd terugvinden in de sidebar bij Artes als app gebruiken.</p>
    </div>
  );
}

function AppShortcutInfoModal({ onClose, primaryLabel = 'Sluiten', secondaryLabel = null }) {
  return (
    <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl max-h-[calc(100dvh-1rem)] overflow-y-auto no-scrollbar rounded-2xl md:rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 md:p-8 shadow-2xl">
        <h3 className="text-xl md:text-2xl font-bold mb-3 md:mb-4 text-slate-900 dark:text-white">Artes als app gebruiken</h3>
        <AppShortcutInfoContent />
        <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
          {secondaryLabel && <Button variant="secondary" onClick={onClose}>{secondaryLabel}</Button>}
          <Button onClick={onClose}>{primaryLabel}</Button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, moderatorAccess, onOpenModeration, onOpenSupport, onOpenAppShortcutInfo, onOpenVouchRequests, darkMode, onToggleDark, onLogout, showModerationDot = false }) { 
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
            <div className="bg-white dark:bg-slate-900 w-[min(20rem,calc(100vw-1rem))] h-[calc(100dvh-1rem)] m-2 md:m-0 md:h-full p-3 flex flex-col gap-3 text-slate-900 dark:text-slate-100 md:w-80 md:p-6 md:gap-6 rounded-2xl md:rounded-none overflow-y-auto no-scrollbar">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-base md:text-xl">Instellingen</h3>
                  <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><X/></button>
                </div>
                <div className="space-y-2.5 md:space-y-4">
                    <h4 className="text-xs uppercase font-bold text-slate-400">Account</h4>
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between md:p-3"><span>Meldingen</span><Bell className="w-4 h-4"/></div>
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between md:p-3"><span>Privacy</span><Lock className="w-4 h-4"/></div>
                    <button
                      type="button"
                      onClick={onLogout}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left md:p-3 text-rose-600 dark:text-rose-300"
                    >
                      <span>Log uit</span>
                      <LogOut className="w-4 h-4" />
                    </button>
                    <h4 className="text-xs uppercase font-bold text-slate-400">Weergave</h4>
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex items-center justify-between gap-2 md:p-3 md:gap-3">
                      <button
                        type="button"
                        onClick={onToggleDark}
                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-semibold md:rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                      >
                        {darkMode ? 'Light mode' : 'Dark mode'}
                      </button>
                      {darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-500" />}
                    </div>
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between md:p-3"><span>Taal</span><Globe className="w-4 h-4"/></div>
                    {moderatorAccess === true && (
                      <>
                        <h4 className="text-xs uppercase font-bold text-slate-400">Moderatie</h4>
                        <button
                          type="button"
                          onClick={onOpenModeration}
                          className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left md:p-3"
                        >
                          <span className="flex items-center gap-2">
                            Artes Moderatie
                            {showModerationDot && <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />}
                          </span>
                          <Shield className="w-4 h-4"/>
                        </button>
                        <p className="text-xs text-slate-500 dark:text-slate-300">
                          Open het moderatieportaal om chats, reviews en rapportages te beheren.
                        </p>
                      </>
                    )}
                    <h4 className="text-xs uppercase font-bold text-slate-400">Overig</h4>
                    {debugAllowed() && (
                      <Link
                        to="/debug"
                        onClick={onClose}
                        className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left md:p-3"
                      >
                        <span>Debug</span>
                        <Info className="w-4 h-4" />
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={onOpenVouchRequests}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left md:p-3"
                    >
                      <span>Vouch verzoeken</span>
                      <MessageCircle className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={onOpenSupport}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left md:p-3"
                    >
                      <span>Support</span>
                      <HelpCircle className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={onOpenAppShortcutInfo}
                      className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 rounded flex justify-between items-center text-left md:p-3"
                    >
                      <span>Artes als app gebruiken</span>
                      <Smartphone className="w-4 h-4" />
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
    { title: 'De Galerij', desc: 'Hier vind je inspirerend werk van makers waarvan je fan bent.', icon: ImageIcon, action: 'gallery' },
    {
      title: 'Artes als app gebruiken',
      desc: <AppShortcutInfoContent />,
      icon: Smartphone,
      action: null,
      buttonLabel: 'Verder',
    },
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
          <div className="text-slate-600 dark:text-slate-400 mb-8 max-h-[50vh] overflow-y-auto no-scrollbar text-left">{steps[step].desc}</div>
          
          {step < steps.length - 1 ? (
             <div className="flex gap-3">
               <Button onClick={() => setStep(step + 1)} className="w-full">{steps[step].buttonLabel || 'Volgende'}</Button>
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
