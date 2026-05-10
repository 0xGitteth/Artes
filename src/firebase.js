import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
  updateProfile as updateAuthProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import {
  getFirestore,
  serverTimestamp,
  deleteField,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  runTransaction,
  getDocs,
  writeBatch,
  limit,
  increment,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { SUPPORT_INTRO_TEXT } from './utils/supportChat';
import { isCodexDevUser } from './utils/codexDevIdentity';
import {
  makeAliasId,
  normalizeAliasValue,
} from './utils/contributorClaims';
import { canAccessFirestore, devLog, isOnboardingComplete } from './utils/firestoreGate';
import {
  AFFILIATION_STATUSES,
  applyAffiliationStatusTransitions,
  getPublicAffiliationProjectionPatch,
} from './utils/profileAffiliationStatus';
import {
  buildAffiliationRequestMessagePayload,
  getAffiliationRequestMessageId,
  getAffiliationRequestThreadId,
  getAffiliationFields,
  shouldCreateAffiliationRequestCard,
} from './utils/affiliationRequestCards';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let firebaseApp = null;

const getFirebaseApp = () => {
  if (!firebaseApp) {
    const existing = getApps();
    firebaseApp = existing.length ? existing[0] : initializeApp(firebaseConfig);
  }
  return firebaseApp;
};

const getFirebaseAuth = () => getAuth(getFirebaseApp());
const getFirebaseDb = () => getFirestore(getFirebaseApp());
const getFirebaseFunctions = () => getFunctions(getFirebaseApp(), 'europe-west4');
const getFirebaseStorage = () => getStorage(getFirebaseApp());

let authStateReady = false;
let authStateUser = null;

const waitForAuthReady = async () => {
  if (authStateReady) {
    return authStateUser ?? getFirebaseAuth().currentUser ?? null;
  }

  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      authStateReady = true;
      authStateUser = user ?? null;
      unsubscribe();
      resolve(user ?? null);
    });
  });
};

const getFanDiagnostics = ({ targetUid, authUid, extra = {} } = {}) => ({
  targetUid: targetUid || null,
  authUid: authUid || null,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || null,
  appProjectId: getFirebaseApp()?.options?.projectId || null,
  ...extra,
});

let hasLoggedFanProjectContext = false;

const logFanProjectContextOnce = (authUid = null) => {
  if (hasLoggedFanProjectContext) return;
  hasLoggedFanProjectContext = true;
  const diagnostics = getFanDiagnostics({ authUid, extra: { action: 'fan-project-context' } });
  console.info('Fan project context', diagnostics);
  if (diagnostics.projectId && diagnostics.appProjectId && diagnostics.projectId !== diagnostics.appProjectId) {
    console.error('Fan project mismatch detected', diagnostics);
  }
};

export const getFirebaseAuthInstance = () => getFirebaseAuth();
export const getFirebaseDbInstance = () => getFirebaseDb();
export const getFirebaseFunctionsInstance = () => getFirebaseFunctions();
export const getFirebaseStorageInstance = () => getFirebaseStorage();


const getUserMoodboardsCollection = (uid) => collection(getFirebaseDb(), 'users', uid, 'moodboards');
const getUserMoodboardRef = (uid, moodboardId) => doc(getFirebaseDb(), 'users', uid, 'moodboards', moodboardId);
const getUserMoodboardItemsCollection = (uid, moodboardId) => collection(getFirebaseDb(), 'users', uid, 'moodboards', moodboardId, 'items');
const getUserMoodboardItemRef = (uid, moodboardId, postId) => doc(getFirebaseDb(), 'users', uid, 'moodboards', moodboardId, 'items', postId);

const normalizeMoodboardTitleForWrite = (title) => {
  const normalized = String(title || '').replace(/\s+/g, ' ').trim() || 'Nieuw moodboard';
  return normalized.slice(0, 80);
};

export const createMoodboard = async ({ uid, title }) => {
  const normalizedTitle = normalizeMoodboardTitleForWrite(title);
  const ref = await addDoc(getUserMoodboardsCollection(uid), {
    ownerUid: uid,
    title: normalizedTitle,
    description: '',
    visibility: 'private',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    postCount: 0,
    coverPostIds: [],
    coverImageUrls: [],
    collaboratorUids: [],
    sharedWith: [],
  });
  return ref.id;
};

export const updateMoodboard = async ({ uid, moodboardId, title }) => updateDoc(getUserMoodboardRef(uid, moodboardId), {
  title: normalizeMoodboardTitleForWrite(title),
  updatedAt: serverTimestamp(),
});

const MOODBOARD_DELETE_BATCH_LIMIT = 450;

export const deleteMoodboard = async ({ uid, moodboardId }) => {
  const items = await getDocs(getUserMoodboardItemsCollection(uid, moodboardId));
  const itemDocs = items.docs;

  for (let index = 0; index < itemDocs.length; index += MOODBOARD_DELETE_BATCH_LIMIT) {
    const batch = writeBatch(getFirebaseDb());
    itemDocs.slice(index, index + MOODBOARD_DELETE_BATCH_LIMIT).forEach((itemDoc) => batch.delete(itemDoc.ref));
    await batch.commit();
  }

  const moodboardBatch = writeBatch(getFirebaseDb());
  moodboardBatch.delete(getUserMoodboardRef(uid, moodboardId));
  await moodboardBatch.commit();
};

const buildMoodboardItemSnapshot = (post = {}) => ({
  imageUrl: typeof post.imageUrl === 'string' ? post.imageUrl : '',
  title: typeof post.title === 'string' ? post.title : '',
  authorId: typeof post.authorId === 'string' ? post.authorId : '',
});

export const addPostToMoodboard = async ({ uid, moodboardId, post }) => {
  const postId = String(post?.id || post?.postId || '').trim();
  if (!postId) throw new Error('Post ontbreekt.');
  const itemRef = getUserMoodboardItemRef(uid, moodboardId, postId);
  const boardRef = getUserMoodboardRef(uid, moodboardId);
  await runTransaction(getFirebaseDb(), async (transaction) => {
    const existing = await transaction.get(itemRef);
    transaction.set(itemRef, {
      postId,
      ownerUid: uid,
      moodboardId,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      postSnapshot: buildMoodboardItemSnapshot(post),
    }, { merge: true });
    transaction.update(boardRef, {
      updatedAt: serverTimestamp(),
      postCount: existing.exists() ? increment(0) : increment(1),
      coverPostIds: [postId],
      coverImageUrls: [buildMoodboardItemSnapshot(post).imageUrl].filter(Boolean),
    });
  });
};

export const removePostFromMoodboard = async ({ uid, moodboardId, postId }) => {
  const itemRef = getUserMoodboardItemRef(uid, moodboardId, postId);
  const boardRef = getUserMoodboardRef(uid, moodboardId);
  await runTransaction(getFirebaseDb(), async (transaction) => {
    const existing = await transaction.get(itemRef);
    if (!existing.exists()) return;
    transaction.delete(itemRef);
    transaction.update(boardRef, {
      updatedAt: serverTimestamp(),
      postCount: increment(-1),
    });
  });
};

export const subscribeToUserMoodboards = (uid, callback) => onSnapshot(
  query(getUserMoodboardsCollection(uid), orderBy('updatedAt', 'desc')),
  (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
);

export const subscribeToMoodboardItems = ({ uid, moodboardId }, callback) => onSnapshot(
  query(getUserMoodboardItemsCollection(uid, moodboardId), orderBy('createdAt', 'desc')),
  (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
);

export const CLAIMS_COLLECTIONS = {
  contributors: 'contributors',
  contributorAliases: 'contributorAliases',
  claimRequests: 'claimRequests',
  claimVouches: 'claimVouches',
  claimInvites: 'claimInvites',
  contributorContentRequests: 'contributorContentRequests',
};

export const getContributorRef = (contributorId) =>
  doc(getFirebaseDb(), CLAIMS_COLLECTIONS.contributors, contributorId);

export const getContributorAliasRef = (aliasId) =>
  doc(getFirebaseDb(), CLAIMS_COLLECTIONS.contributorAliases, aliasId);

export const getClaimRequestRef = (requestId) =>
  doc(getFirebaseDb(), CLAIMS_COLLECTIONS.claimRequests, requestId);

export const getClaimInviteRef = (token) =>
  doc(getFirebaseDb(), CLAIMS_COLLECTIONS.claimInvites, token);

export const getClaimVouchesVotesCollection = (requestId) =>
  collection(getFirebaseDb(), CLAIMS_COLLECTIONS.claimVouches, requestId, 'votes');

export const createClaimInvite = async ({ contributorId, postId = null }) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'createClaimInvite');
  const result = await callable({ contributorId, postId });
  return result?.data || null;
};

export const startEmailClaimProof = async ({ requestId }) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'startEmailClaimProof');
  const result = await callable({ requestId });
  return result?.data || null;
};

export const startWebsiteClaimProof = async ({ requestId }) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'startWebsiteClaimProof');
  const result = await callable({ requestId });
  return result?.data || null;
};

export const verifyWebsiteClaimProof = async ({ requestId }) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'verifyWebsiteClaimProof');
  const result = await callable({ requestId });
  return result?.data || null;
};

export const verifyEmailClaimProof = async ({ requestId, token }) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'verifyEmailClaimProof');
  const result = await callable({ requestId, token });
  return result?.data || null;
};

export const createDiditSession = async ({ returnToOrigin } = {}) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'createDiditSession');
  const result = await callable({ returnToOrigin });
  return result?.data || null;
};

export const refreshDiditSession = async (sessionId = null) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'refreshDiditSession');
  const payload = sessionId ? { sessionId } : {};
  const result = await callable(payload);
  return result?.data || null;
};


export const createContributorContentRequest = async ({ contributorId, postId, requestType, reason = '' }) => {
  const user = await waitForAuthReady();
  if (!user?.uid) throw new Error('Not signed in');
  const allowedTypes = new Set(['remove', 'hide', 'correction']);
  const normalizedType = allowedTypes.has(requestType) ? requestType : 'correction';
  return addDoc(collection(getFirebaseDb(), CLAIMS_COLLECTIONS.contributorContentRequests), {
    contributorId,
    postId,
    requestType: normalizedType,
    reason: String(reason || '').trim().slice(0, 1000),
    status: 'pending',
    requesterUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

/**
 * Fetch a contributor by alias type/value.
 * @param {'instagram' | 'domain' | 'email'} type
 * @param {string} rawValue
 * @returns {Promise<{
 *   contributor: import('./utils/contributorClaims').Contributor | null,
 *   alias: import('./utils/contributorClaims').ContributorAlias | null,
 * } | null>}
 */
export const getContributorByAlias = async (type, rawValue) => {
  const normalizedValue = normalizeAliasValue(type, rawValue);
  if (!normalizedValue) return null;
  if (type === 'email') {
    const callable = httpsCallable(getFirebaseFunctions(), 'getContributorByAliasCallable');
    const result = await callable({ type, value: normalizedValue });
    return result?.data || null;
  }
  const aliasId = makeAliasId(type, normalizedValue);
  const aliasSnap = await getDoc(getContributorAliasRef(aliasId));
  if (!aliasSnap.exists()) return null;
  const aliasData = aliasSnap.data();
  const contributorSnap = await getDoc(getContributorRef(aliasData.contributorId));
  if (!contributorSnap.exists()) return null;
  const contributorData = contributorSnap.data() || {};
  const { email: _email, ...safeContributorData } = contributorData;
  return {
    alias: {
      id: aliasSnap.id,
      ...aliasData,
    },
    contributor: {
      id: contributorSnap.id,
      ...safeContributorData,
    },
  };
};

/**
 * Create a contributor profile with alias documents.
 * @param {{
 *   displayName: string,
 *   instagramHandle?: string,
 *   website?: string,
 *   email?: string,
 * }} params
 * @returns {Promise<{ contributorId: string, aliasIds: string[] }>}
 */
export const createContributorWithAliases = async ({
  displayName,
  instagramHandle,
  website,
  email,
}) => {
  const callable = httpsCallable(getFirebaseFunctions(), 'createTemporaryContributor');
  const result = await callable({
    displayName,
    instagramHandle,
    website,
    email,
  });
  return result?.data || null;
};

export const initAuth = async () => {
  const auth = getFirebaseAuth();
  await setPersistence(auth, browserLocalPersistence);
  return auth;
};

export const observeAuth = (cb) => onAuthStateChanged(getFirebaseAuth(), async (user) => {
  authStateReady = true;
  authStateUser = user ?? null;
  if (import.meta.env.DEV) {
    let provider = null;

    if (user) {
      try {
        const tokenResult = await user.getIdTokenResult();
        provider = tokenResult?.claims?.firebase?.sign_in_provider ?? null;
      } catch (error) {
        console.warn('[Auth Debug] Failed to read token claims:', error);
      }
    }

    console.log('[Auth Debug]', {
      uid: user?.uid ?? null,
      email: user?.email ?? null,
      emailVerified: user?.emailVerified ?? false,
      provider,
      signInProvider: provider,
    });
  }

  cb(user);
});

export const registerWithEmail = async (email, password, displayName) => {
  const cred = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
  if (displayName) {
    await updateAuthProfile(cred.user, { displayName });
  }
  await sendEmailVerification(cred.user);
  return cred.user;
};

export const loginWithEmail = (email, password) =>
  signInWithEmailAndPassword(getFirebaseAuth(), email, password);

export const logout = async () => {
  await signOut(getFirebaseAuth());
  localStorage.removeItem('auth_token');
};

export const sendResetPassword = (email) => sendPasswordResetEmail(getFirebaseAuth(), email);

export const resendVerificationEmail = async () => {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) return null;
  await sendEmailVerification(auth.currentUser);
  return auth.currentUser;
};

export const reloadCurrentUser = async () => {
  const auth = getFirebaseAuth();
  if (!auth.currentUser) return null;
  await auth.currentUser.reload();
  return auth.currentUser;
};

const resolveDisplayName = (user) => {
  if (user?.displayName) return user.displayName;
  if (user?.email) return user.email.split('@')[0];
  return 'Artes gebruiker';
};

const normalizeUsername = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .slice(0, 20);

const generateUsername = (displayName, uid) => {
  const base = normalizeUsername(displayName) || 'artes';
  const suffix = uid ? uid.slice(0, 4).toLowerCase() : Math.random().toString(36).slice(2, 6);
  const maxBaseLength = Math.max(0, 20 - suffix.length);
  return `${base.slice(0, maxBaseLength)}${suffix}`;
};

const CLIENT_GATE_FIELDS = ['ageVerified', 'isAdult', 'ageVerifiedAt'];

const stripClientGateFields = (payload = {}) => {
  const cleaned = { ...payload };
  const removed = [];
  CLIENT_GATE_FIELDS.forEach((field) => {
    if (field in cleaned) {
      delete cleaned[field];
      removed.push(field);
    }
  });
  if (import.meta.env.DEV && removed.length > 0) {
    console.warn('[profile-write] blocked client gate fields:', removed.join(', '));
  }
  return cleaned;
};

const PUBLIC_USER_ALLOWED_FIELDS = [
  'uid',
  'username',
  'displayName',
  'displayNameLower',
  'photoURL',
  'avatar',
  'roles',
  'themes',
  'bio',
  'headerImage',
  'headerPosition',
  'linkedAgencyName',
  'linkedCompanyName',
  'linkedAgencyId',
  'linkedCompanyId',
  'linkedAgencyStatus',
  'linkedCompanyStatus',
  'linkedAgencyLink',
  'linkedCompanyLink',
];

const sanitizePublicProfileField = (key, value) => {
  if (value === undefined) return undefined;
  if (key === 'username') return normalizeUsername(value);
  if (key === 'photoURL' || key === 'avatar' || key === 'headerImage') return value || null;
  if (key === 'displayName' || key === 'bio') return value || '';
  if (key === 'linkedAgencyStatus' || key === 'linkedCompanyStatus') return String(value || '').trim().toLowerCase() || undefined;
  if (key === 'headerPosition') return value || 'center';
  if (key === 'roles' || key === 'themes') {
    if (!Array.isArray(value)) return [];
    return value.filter(Boolean);
  }
  return value;
};

const buildPublicProfilePayload = (data = {}, uid, existingPublic = {}) => {
  const hasRequestedPublicField = [
    'uid',
    'displayName',
    'username',
    'photoURL',
    'avatar',
    'roles',
    'themes',
    'bio',
    'headerImage',
    'headerPosition',
    'linkedAgencyName',
    'linkedCompanyName',
    'linkedAgencyId',
    'linkedCompanyId',
    'linkedAgencyStatus',
    'linkedCompanyStatus',
    'linkedAgencyLink',
    'linkedCompanyLink',
  ]
    .some((field) => data[field] !== undefined);
  if (!hasRequestedPublicField) return {};

  const payload = {};
  if (data.uid !== undefined) {
    payload.uid = data.uid;
  }
  if (data.displayName !== undefined) {
    payload.displayName = data.displayName;
  }
  if (data.username !== undefined) {
    payload.username = normalizeUsername(data.username);
  }
  if (data.photoURL !== undefined || data.avatar !== undefined) {
    const resolvedAvatar = data.avatar ?? data.photoURL ?? null;
    payload.avatar = resolvedAvatar;
    payload.photoURL = data.photoURL ?? resolvedAvatar;
  }

  const passthroughFields = [
    'roles',
    'themes',
    'bio',
    'headerImage',
    'headerPosition',
    'linkedAgencyName',
    'linkedCompanyName',
    'linkedAgencyId',
    'linkedCompanyId',
    'linkedAgencyStatus',
    'linkedCompanyStatus',
    'linkedAgencyLink',
    'linkedCompanyLink',
  ];

  passthroughFields.forEach((field) => {
    if (data[field] !== undefined) {
      payload[field] = sanitizePublicProfileField(field, data[field]);
    }
  });

  Object.assign(
    payload,
    getPublicAffiliationProjectionPatch({ source: data, existingPublic, kind: 'agency', deleteValue: deleteField() }),
    getPublicAffiliationProjectionPatch({ source: data, existingPublic, kind: 'company', deleteValue: deleteField() }),
  );

  const hasUsername = typeof payload.username === 'string' && payload.username.length > 0;
  if (!hasUsername) {
    const existingUsername = normalizeUsername(existingPublic?.username);
    payload.username = existingUsername || generateUsername(payload.displayName || existingPublic?.displayName, uid);
  }

  if (payload.displayName === undefined && existingPublic?.displayName !== undefined) {
    payload.displayName = existingPublic.displayName;
  }

  if (payload.avatar === undefined && existingPublic?.avatar !== undefined) {
    payload.avatar = existingPublic.avatar;
  }

  if (payload.photoURL === undefined && existingPublic?.photoURL !== undefined) {
    payload.photoURL = existingPublic.photoURL;
  }

  if (payload.headerImage === undefined && existingPublic?.headerImage !== undefined) {
    payload.headerImage = existingPublic.headerImage;
  }

  payload.displayNameLower = String(payload.displayName || existingPublic?.displayName || '').toLowerCase();

  Object.keys(payload).forEach((key) => {
    if (!PUBLIC_USER_ALLOWED_FIELDS.includes(key)) {
      delete payload[key];
    }
  });

  return payload;
};


const cleanupLegacyPublicEmailIfNeeded = async (db, uid, existingPublic = {}) => {
  if (!uid || !existingPublic || !Object.prototype.hasOwnProperty.call(existingPublic, 'email')) {
    return false;
  }

  await updateDoc(doc(db, 'publicUsers', uid), {
    email: deleteField(),
    updatedAt: serverTimestamp(),
  });

  return true;
};

const writePublicUserProfile = async (uid, data = {}, existingPublic = {}) => {
  if (!uid) return;
  const payload = buildPublicProfilePayload(data, uid, existingPublic);
  if (!Object.keys(payload).length) return;

  if (payload.displayName === undefined || payload.displayName === null) {
    payload.displayName = existingPublic?.displayName || '';
  }

  const normalizedUsername = normalizeUsername(payload.username);
  if (!normalizedUsername || !/^[a-z0-9]{3,20}$/.test(normalizedUsername)) {
    payload.username = normalizeUsername(existingPublic?.username)
      || generateUsername(payload.displayName || existingPublic?.displayName, uid);
  } else {
    payload.username = normalizedUsername;
  }

  payload.displayNameLower = String(payload.displayName || '').toLowerCase();
  
  const finalPayload = {
    uid,
    ...payload,
    updatedAt: serverTimestamp(),
  };
  
  if (import.meta.env.DEV) {
    console.log('[writePublicUserProfile] Writing to publicUsers/' + uid, finalPayload);
  }
  
  await setDoc(
    doc(getFirebaseDb(), 'publicUsers', uid),
    finalPayload,
    { merge: true },
  );
};


const MAX_PROFILE_IMAGE_UPLOAD_BYTES = 350 * 1024;

const uploadProfileImageBlob = async (uid, blob, targetName) => {
  if (!(blob instanceof Blob)) return null;
  if (blob.size > MAX_PROFILE_IMAGE_UPLOAD_BYTES) {
    throw new Error('Profielfoto is te groot na verwerken. Kies een kleinere uitsnede en probeer opnieuw.');
  }
  const storageRef = ref(getFirebaseStorage(), `profileImages/${uid}/${targetName}`);
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg', cacheControl: 'public,max-age=3600' });
  return getDownloadURL(storageRef);
};

const ONBOARDING_WRITE_KEYS = ['onboardingStep', 'onboardingComplete'];

const hasOnboardingWriteKeys = (patch = {}) => ONBOARDING_WRITE_KEYS.some((key) => key in patch);

const toOnboardingStepNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const logOnboardingWrite = ({ uid, label, patch, prevStep, prevComplete, nextStep, nextComplete }) => {
  if (!import.meta.env.DEV) return;
  console.log(
    '[onboarding-write]',
    {
      uid,
      label,
      patchKeys: Object.keys(patch).sort(),
      prevStep,
      prevComplete,
      nextStep,
      nextComplete,
    },
  );
};

export const patchUserProfile = async (uid, patch = {}, { label = 'unknown' } = {}) => {
  if (!uid || !patch || typeof patch !== 'object') return;
  const userRef = doc(getFirebaseDb(), 'users', uid);
  const nextPatch = { ...patch };

  if (!hasOnboardingWriteKeys(nextPatch)) {
    await setDoc(userRef, nextPatch, { merge: true });
    return;
  }

  const snapshot = await getDoc(userRef);
  const existing = snapshot.exists() ? snapshot.data() : {};
  const prevStep = toOnboardingStepNumber(existing?.onboardingStep);
  const prevComplete = existing?.onboardingComplete === true;

  const requestedStep = toOnboardingStepNumber(nextPatch.onboardingStep);
  let nextStep = prevStep;

  if (requestedStep != null) {
    nextStep = prevStep == null ? requestedStep : Math.max(prevStep, requestedStep);
    nextPatch.onboardingStep = nextStep;
  }

  const requestedComplete = nextPatch.onboardingComplete === true;
  const nextComplete = prevComplete || requestedComplete;

  if ('onboardingComplete' in nextPatch && nextPatch.onboardingComplete !== nextComplete) {
    nextPatch.onboardingComplete = nextComplete;
  }

  logOnboardingWrite({
    uid,
    label,
    patch: nextPatch,
    prevStep,
    prevComplete,
    nextStep,
    nextComplete,
  });

  await setDoc(userRef, nextPatch, { merge: true });
};

export const safeUserWrite = async (uid, patch = {}, userOverride = null) => {
  if (!uid || !patch || typeof patch !== 'object') return false;
  const user = userOverride ?? authStateUser;
  const canWrite = Boolean(user?.uid) && user.uid === uid;

  if (!canWrite) {
    devLog('[firestore-gate]', { action: 'write-skip', uid, reason: 'auth-not-ready-or-owner-mismatch' });
    return false;
  }

  try {
    await patchUserProfile(uid, patch, { label: 'safeUserWrite' });
    return true;
  } catch (error) {
    if (error?.code === 'permission-denied') {
      devLog('[firestore-gate]', { action: 'write-blocked', uid, reason: 'permission-denied' });
      return false;
    }
    throw error;
  }
};

/**
 * Sanitizes themes array by removing "General" (which should never be auto-added).
 * Use this before storing theme data.
 */
export const sanitizeThemes = (themes) => {
  if (!Array.isArray(themes)) return [];
  const filtered = themes.filter((t) => t !== 'General');
  if (import.meta.env.DEV) {
    if (filtered.length !== themes.length) {
      console.log('[sanitizeThemes] Removed "General" from themes:', themes, '→', filtered);
    }
  }
  return filtered;
};

// Profile payload fields we store (subset used by UI):
// avatar, headerImage, headerPosition, quickProfilePreviewMode, quickProfilePostIds.
export const createUserProfile = async (uid, profile) => {
  const safeProfile = stripClientGateFields(profile);
  const affiliationTransition = applyAffiliationStatusTransitions(safeProfile, {}, {
    timestamp: serverTimestamp(),
    deleteValue: deleteField(),
  });
  const payload = {
    ...safeProfile,
    ...affiliationTransition,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  
  // Sanitize themes: remove "General" which should never be auto-added
  if (payload.themes && Array.isArray(payload.themes)) {
    payload.themes = sanitizeThemes(payload.themes);
  }
  
  if (import.meta.env.DEV) {
    console.log('[createUserProfile] Writing to users/' + uid, payload);
  }

  const userRef = doc(getFirebaseDb(), 'users', uid);
  const existingSnapshot = await getDoc(userRef);

  if (existingSnapshot.exists()) {
    if (import.meta.env.DEV) {
      console.log('[createUserProfile] users/' + uid + ' already exists, applying merge patch instead');
    }
    await safeUserWrite(uid, payload);
    return;
  }

  await safeUserWrite(uid, payload);
};


const createOrUpdateAffiliationRequestCard = async ({ requesterUid, organizationUid, affiliationType, requesterProfile = {}, organizationProfile = {} }) => {
  if (!requesterUid || !organizationUid || requesterUid === organizationUid) return null;
  const db = getFirebaseDb();
  const threadId = getAffiliationRequestThreadId(requesterUid, organizationUid);
  const messageId = getAffiliationRequestMessageId({ requesterUid, organizationUid, affiliationType });
  if (!threadId || !messageId) return null;

  const participantUids = [requesterUid, organizationUid];
  const dmKey = [...participantUids].sort().join('_');
  const now = serverTimestamp();
  const requesterName = requesterProfile?.displayName || requesterProfile?.username || 'Dit profiel';
  const organizationName = organizationProfile?.displayName || organizationProfile?.username || requesterProfile?.[getAffiliationFields(affiliationType).name] || '';
  const text = buildAffiliationRequestMessagePayload({
    requesterUid,
    organizationUid,
    affiliationType,
    requesterName,
    organizationName,
    createdAt: now,
    updatedAt: now,
  }).text;
  const messagePayload = buildAffiliationRequestMessagePayload({
    requesterUid,
    organizationUid,
    affiliationType,
    requesterName,
    organizationName,
    createdAt: now,
    updatedAt: now,
  });

  const batch = writeBatch(db);
  const threadRef = doc(db, 'threads', threadId);
  const messageRef = doc(db, 'threads', threadId, 'messages', messageId);
  const threadSnap = await getDoc(threadRef);
  let messageExists = false;

  if (threadSnap.exists()) {
    const messageSnap = await getDoc(messageRef);
    messageExists = messageSnap.exists();
    batch.set(threadRef, {
      updatedAt: now,
      lastMessageAt: now,
      lastMessageText: text,
      lastSenderUid: requesterUid,
    }, { merge: true });
  } else {
    batch.set(threadRef, {
      type: 'dm',
      participantUids,
      participants: participantUids,
      dmKey,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      lastMessageText: text,
      lastSenderUid: requesterUid,
    }, { merge: true });
  }
  if (messageExists) {
    batch.set(messageRef, {
      statusSnapshot: AFFILIATION_STATUSES.PENDING,
      text,
      updatedAt: now,
    }, { merge: true });
  } else {
    batch.set(messageRef, messagePayload, { merge: true });
  }
  batch.set(doc(db, 'users', requesterUid, 'threadIndex', threadId), {
    threadId,
    pinned: false,
    hidden: false,
    displayTitle: organizationName || 'Chat',
    lastMessageAt: now,
  }, { merge: true });
  batch.set(doc(db, 'users', organizationUid, 'threadIndex', threadId), {
    threadId,
    pinned: false,
    hidden: false,
    displayTitle: requesterName || 'Chat',
    lastMessageAt: now,
    hasAffiliationRequest: true,
  }, { merge: true });
  await batch.commit();
  return { threadId, messageId };
};

export const updateUserAffiliationStatus = async ({ targetUid, type, status }) => {
  const authUser = await waitForAuthReady();
  if (!authUser?.uid) {
    throw new Error('Affiliatie bijwerken mislukt: je bent niet ingelogd.');
  }
  if (!targetUid || targetUid === authUser.uid) {
    throw new Error('Affiliatie bijwerken mislukt: kies een gekoppeld profiel.');
  }
  const normalizedType = type === 'company' ? 'company' : 'agency';
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (![AFFILIATION_STATUSES.APPROVED, AFFILIATION_STATUSES.REJECTED, AFFILIATION_STATUSES.REMOVED].includes(normalizedStatus)) {
    throw new Error('Affiliatie bijwerken mislukt: status moet approved, rejected of removed zijn.');
  }

  const db = getFirebaseDb();
  const targetRef = doc(db, 'users', targetUid);
  const publicRef = doc(db, 'publicUsers', targetUid);
  const publicSnap = await getDoc(publicRef);
  if (!publicSnap.exists()) {
    throw new Error('Affiliatie bijwerken mislukt: openbaar profiel niet gevonden.');
  }

  const target = publicSnap.data() || {};
  const fields = normalizedType === 'company'
    ? {
      id: 'linkedCompanyId',
      name: 'linkedCompanyName',
      status: 'linkedCompanyStatus',
      statusUpdatedAt: 'linkedCompanyStatusUpdatedAt',
      approvedAt: 'linkedCompanyApprovedAt',
      approvedBy: 'linkedCompanyApprovedBy',
    }
    : {
      id: 'linkedAgencyId',
      name: 'linkedAgencyName',
      status: 'linkedAgencyStatus',
      statusUpdatedAt: 'linkedAgencyStatusUpdatedAt',
      approvedAt: 'linkedAgencyApprovedAt',
      approvedBy: 'linkedAgencyApprovedBy',
    };

  if (target?.[fields.id] !== authUser.uid) {
    throw new Error('Affiliatie bijwerken mislukt: dit profiel is niet aan jouw organisatie gekoppeld.');
  }

  const privatePatch = {
    [fields.status]: normalizedStatus,
    [fields.statusUpdatedAt]: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const publicPatch = {
    [fields.id]: target[fields.id],
    [fields.name]: target[fields.name] || '',
    updatedAt: serverTimestamp(),
  };

  if (normalizedStatus === AFFILIATION_STATUSES.APPROVED) {
    privatePatch[fields.approvedAt] = serverTimestamp();
    privatePatch[fields.approvedBy] = authUser.uid;
    publicPatch[fields.status] = AFFILIATION_STATUSES.APPROVED;
  } else {
    privatePatch[fields.id] = null;
    privatePatch[fields.name] = '';
    privatePatch[fields.approvedAt] = deleteField();
    privatePatch[fields.approvedBy] = deleteField();
    publicPatch[fields.id] = null;
    publicPatch[fields.name] = '';
    publicPatch[fields.status] = deleteField();
  }

  const batch = writeBatch(db);
  batch.set(targetRef, privatePatch, { merge: true });
  batch.set(publicRef, publicPatch, { merge: true });
  await batch.commit();

  const threadId = getAffiliationRequestThreadId(targetUid, authUser.uid);
  const messageId = getAffiliationRequestMessageId({
    requesterUid: targetUid,
    organizationUid: authUser.uid,
    affiliationType: normalizedType,
  });
  if (threadId && messageId) {
    try {
      await updateDoc(doc(db, 'threads', threadId, 'messages', messageId), {
        statusSnapshot: normalizedStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (error?.code !== 'not-found') {
        throw error;
      }
    }
  }
};

export const updateUserProfile = async (uid, data) => {
  const authUser = await waitForAuthReady();
  if (!authUser?.uid) {
    throw new Error('Profiel opslaan mislukt: je bent niet ingelogd of auth is nog niet klaar.');
  }
  const resolvedUid = authUser.uid;
  if (uid && uid !== resolvedUid && import.meta.env.DEV) {
    console.warn('[updateUserProfile] uid mismatch, forcing auth uid', { requestedUid: uid, authUid: resolvedUid });
  }

  const safeData = stripClientGateFields(data);
  const avatarBlob = safeData.avatarBlob instanceof Blob ? safeData.avatarBlob : null;
  const headerImageBlob = safeData.headerImageBlob instanceof Blob ? safeData.headerImageBlob : null;
  delete safeData.avatarBlob;
  delete safeData.headerImageBlob;

  if (safeData.avatar && String(safeData.avatar).startsWith('data:')) delete safeData.avatar;
  if (safeData.headerImage && String(safeData.headerImage).startsWith('data:')) delete safeData.headerImage;

  if (avatarBlob || headerImageBlob) {
    const [avatarUrl, headerImageUrl] = await Promise.all([
      avatarBlob ? uploadProfileImageBlob(resolvedUid, avatarBlob, 'avatar.jpg') : null,
      headerImageBlob ? uploadProfileImageBlob(resolvedUid, headerImageBlob, 'header.jpg') : null,
    ]);
    if (avatarUrl) {
      safeData.avatar = avatarUrl;
      safeData.photoURL = avatarUrl;
    }
    if (headerImageUrl) {
      safeData.headerImage = headerImageUrl;
    }
  }

  let existingPrivate = {};
  try {
    const existingPrivateSnap = await getDoc(doc(getFirebaseDb(), 'users', resolvedUid));
    existingPrivate = existingPrivateSnap.exists() ? existingPrivateSnap.data() : {};
  } catch (error) {
    if (error?.code !== 'permission-denied') {
      throw error;
    }
  }

  const affiliationTransition = applyAffiliationStatusTransitions(safeData, existingPrivate, {
    timestamp: serverTimestamp(),
    deleteValue: deleteField(),
  });
  Object.assign(safeData, affiliationTransition);

  const updatePayload = { ...safeData, updatedAt: serverTimestamp() };
  const userDocPath = `users/${resolvedUid}`;
  const publicDocPath = `publicUsers/${resolvedUid}`;

  if (updatePayload.email === undefined && authUser.email) {
    updatePayload.email = authUser.email;
  }

  let existingPublic = {};
  try {
    const existingPublicSnap = await getDoc(doc(getFirebaseDb(), 'publicUsers', resolvedUid));
    existingPublic = existingPublicSnap.exists() ? existingPublicSnap.data() : {};
  } catch (error) {
    if (error?.code !== 'permission-denied') {
      throw error;
    }
  }
  const publicPatch = buildPublicProfilePayload(safeData, resolvedUid, existingPublic);
  const hadLegacyPublicEmail = Object.prototype.hasOwnProperty.call(existingPublic || {}, 'email');
  if (hadLegacyPublicEmail) {
    publicPatch.email = deleteField();
  } else {
    delete publicPatch.email;
  }

  // Sanitize themes: remove "General" which should never be auto-added
  if (updatePayload.themes && Array.isArray(updatePayload.themes)) {
    updatePayload.themes = sanitizeThemes(updatePayload.themes);
  }

  if (import.meta.env.DEV) {
    console.log('[updateUserProfile] PRIVATE WRITE', {
      uid: resolvedUid,
      path: userDocPath,
      keys: Object.keys(updatePayload).sort(),
    });
  }

  let didWriteUser = false;
  try {
    didWriteUser = (await safeUserWrite(resolvedUid, updatePayload, authUser)) === true;
    if (updatePayload.email !== undefined) {
      await setDoc(doc(getFirebaseDb(), 'users', resolvedUid), {
        email: updatePayload.email,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  } catch (e) {
    console.error(
      '[updateUserProfile] USERS WRITE FAILED',
      e.code,
      e.message,
      Object.keys(updatePayload).sort()
    );
    throw e;
  }

  const shouldSyncPublic = Object.keys(publicPatch).length > 0;
  if (!didWriteUser) {
    if (import.meta.env.DEV) {
      devLog('[firestore-gate]', { action: 'public-write-skip', uid: resolvedUid, reason: 'user-write-not-allowed-or-blocked' });
    }
    throw new Error('Profiel opslaan mislukt: private profiel kon niet worden bijgewerkt.');
  }

  let removedLegacyEmail = false;
  try {
    removedLegacyEmail = await cleanupLegacyPublicEmailIfNeeded(getFirebaseDb(), resolvedUid, existingPublic);
  } catch (e) {
    console.error(
      '[updateUserProfile] PUBLIC USERS LEGACY EMAIL CLEANUP FAILED',
      e.code,
      e.message,
      {
        uid: resolvedUid,
        path: publicDocPath,
        keys: ['email', 'updatedAt'],
      }
    );
    throw new Error('Profiel opslaan mislukt: legacy public profiel data kon niet worden opgeschoond.');
  }

  if (import.meta.env.DEV) {
    console.log('[updateUserProfile] PUBLIC WRITE', {
      uid: resolvedUid,
      path: publicDocPath,
      keys: Object.keys(publicPatch).sort(),
      removedLegacyEmail: hadLegacyPublicEmail,
    });
  }

  if (shouldSyncPublic) {
    try {
      await writePublicUserProfile(resolvedUid, publicPatch, existingPublic);

    } catch (e) {
      console.error(
        '[updateUserProfile] PUBLIC USERS WRITE FAILED',
        e.code,
        e.message,
        {
          uid: resolvedUid,
          path: publicDocPath,
          keys: Object.keys(publicPatch).sort(),
        }
      );
      throw new Error('Profiel opslaan mislukt: public profiel kon niet worden bijgewerkt.');
    }
  }

  const requestCardsToCreate = ['agency', 'company'].filter((affiliationType) => (
    shouldCreateAffiliationRequestCard({
      existing: existingPrivate,
      next: updatePayload,
      affiliationType,
    })
  ));

  if (requestCardsToCreate.length > 0) {
    await Promise.all(requestCardsToCreate.map(async (affiliationType) => {
      const fields = getAffiliationFields(affiliationType);
      const organizationUid = updatePayload[fields.id];
      let organizationProfile = {};
      try {
        const organizationSnap = await getDoc(doc(getFirebaseDb(), 'publicUsers', organizationUid));
        organizationProfile = organizationSnap.exists() ? organizationSnap.data() : {};
      } catch (error) {
        if (error?.code !== 'permission-denied') throw error;
      }
      await createOrUpdateAffiliationRequestCard({
        requesterUid: resolvedUid,
        organizationUid,
        affiliationType,
        requesterProfile: updatePayload,
        organizationProfile,
      });
    }));
  }
};

/**
 * One-time backfill: sync safe public profile fields from users -> publicUsers.
 */
export const migrateBackfillPublicUsersFromUsers = async ({ dryRun = false, maxUsers = 1000 } = {}) => {
  const db = getFirebaseDb();
  const usersQuery = query(collection(db, 'users'), limit(Math.max(1, maxUsers)));
  const usersSnapshot = await getDocs(usersQuery);

  let queued = 0;
  let processed = 0;
  let batch = writeBatch(db);
  const commitBatch = async () => {
    if (dryRun || queued === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    queued = 0;
  };

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data() || {};
    const existingPublicSnap = await getDoc(doc(db, 'publicUsers', uid));
    const existingPublic = existingPublicSnap.exists() ? existingPublicSnap.data() : {};
    const payload = buildPublicProfilePayload({ uid, ...userData }, uid, existingPublic);
    if (!Object.keys(payload).length) continue;

    const finalPayload = {
      uid,
      ...payload,
      updatedAt: serverTimestamp(),
    };

    if (!dryRun) {
      batch.set(doc(db, 'publicUsers', uid), finalPayload, { merge: true });
      queued += 1;
      if (queued >= 400) {
        await commitBatch();
      }
    }

    processed += 1;
  }

  await commitBatch();

  if (import.meta.env.DEV) {
    console.log('[migrateBackfillPublicUsersFromUsers] Done', { dryRun, processed, scanned: usersSnapshot.size });
  }

  return {
    dryRun,
    scanned: usersSnapshot.size,
    processed,
  };
};

export const fetchUserProfile = (uid, gate = {}) => {
  const ready = gate?.authReady ?? authStateReady;
  const user = gate?.user ?? authStateUser;
  if (!canAccessFirestore({ authReady: ready, user }) || !uid) {
    devLog('[firestore-gate]', { action: 'read-skip', path: `users/${uid || 'unknown'}` });
    return null;
  }
  return getDoc(doc(getFirebaseDb(), 'users', uid));
};

let appConfigCache = {
  fetchedAt: 0,
  data: null,
  promise: null,
};

const APP_CONFIG_CACHE_TTL = 30 * 1000;

export const getAppConfig = async ({ forceRefresh = false } = {}) => {
  const now = Date.now();
  if (!forceRefresh && appConfigCache.data && now - appConfigCache.fetchedAt < APP_CONFIG_CACHE_TTL) {
    return appConfigCache.data;
  }
  if (!forceRefresh && appConfigCache.promise) {
    return appConfigCache.promise;
  }
  appConfigCache.promise = getDoc(doc(getFirebaseDb(), 'config', 'app'))
    .then((snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : null;
      appConfigCache = {
        fetchedAt: Date.now(),
        data,
        promise: null,
      };
      return data;
    })
    .catch((error) => {
      appConfigCache.promise = null;
      throw error;
    });
  return appConfigCache.promise;
};

let moderationConfigCache = {
  fetchedAt: 0,
  data: null,
  promise: null,
};

const MODERATION_CACHE_TTL = 5 * 60 * 1000;

export const getModerationConfig = async () => {
  const now = Date.now();
  if (moderationConfigCache.data && now - moderationConfigCache.fetchedAt < MODERATION_CACHE_TTL) {
    return moderationConfigCache.data;
  }
  if (moderationConfigCache.promise) {
    return moderationConfigCache.promise;
  }
  moderationConfigCache.promise = getDoc(doc(getFirebaseDb(), 'config', 'moderation'))
    .then((snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : null;
      moderationConfigCache = {
        fetchedAt: Date.now(),
        data,
        promise: null,
      };
      return data;
    })
    .catch((error) => {
      moderationConfigCache.promise = null;
      throw error;
    });
  return moderationConfigCache.promise;
};

export const isModerator = async (user) => {
  if (!user?.email) return false;
  try {
    const config = await getModerationConfig();
    const allowlist = Array.isArray(config?.moderatorEmails) ? config.moderatorEmails : [];
    return allowlist.includes(user.email);
  } catch (error) {
    return false;
  }
};

export const subscribeToProfile = (uid, cb, gate = {}) => {
  const ready = gate?.authReady ?? authStateReady;
  const user = gate?.user ?? authStateUser;
  if (!canAccessFirestore({ authReady: ready, user }) || !uid) {
    devLog('[firestore-gate]', { action: 'listener-skip', path: `users/${uid || 'unknown'}` });
    return null;
  }
  return onSnapshot(
    doc(getFirebaseDb(), 'users', uid),
    cb,
    (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Profile listener users/${uid}`),
  );
};

export const setFanStatus = async (targetUid, shouldBeFan) => {
  const currentUser = await waitForAuthReady();
  logFanProjectContextOnce(currentUser?.uid || null);
  const diagnosticBase = {
    targetUid,
    authUid: currentUser?.uid,
  };
  if (!currentUser?.uid) throw new Error('Je moet ingelogd zijn om fan te worden.');
  if (!targetUid) throw new Error('Doelgebruiker ontbreekt.');
  if (currentUser.uid === targetUid) throw new Error('Je kunt geen fan van jezelf zijn.');

  const fanRef = doc(getFirebaseDb(), 'users', currentUser.uid, 'following', targetUid);
  if (shouldBeFan) {
    try {
      await setDoc(fanRef, {
        targetUid,
        createdAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.warn('Fan write mislukt.', getFanDiagnostics({
        ...diagnosticBase,
        extra: {
          shouldBeFan: true,
          action: 'create',
          errorCode: error?.code || null,
          errorMessage: error?.message || null,
        },
      }));
      throw error;
    }
    return;
  }
  try {
    await deleteDoc(fanRef);
  } catch (error) {
    console.warn('Fan write mislukt.', getFanDiagnostics({
      ...diagnosticBase,
      extra: {
        shouldBeFan: false,
        action: 'delete',
        errorCode: error?.code || null,
        errorMessage: error?.message || null,
      },
    }));
    throw error;
  }
};

export const subscribeToFollowingIds = (cb, options = {}) => {
  let unsubscribed = false;
  let unsubscribeSnapshot = null;

  waitForAuthReady()
    .then((resolvedUser) => {
      if (unsubscribed) return;
      const user = resolvedUser ?? authStateUser ?? getFirebaseAuth().currentUser;
      const expectedAuthUid = options?.expectedAuthUid || null;
      if (!user?.uid) {
        cb(new Set());
        return;
      }
      if (expectedAuthUid && user.uid !== expectedAuthUid) {
        cb(new Set());
        return;
      }

      const followingRef = collection(getFirebaseDb(), 'users', user.uid, 'following');
      unsubscribeSnapshot = onSnapshot(
        followingRef,
        (snapshot) => {
          const nextIds = new Set();
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const targetUid = String(data?.targetUid || docSnap.id || '').trim();
            if (targetUid) nextIds.add(targetUid);
          });
          cb(nextIds);
        },
        () => cb(new Set()),
      );
    })
    .catch(() => {
      if (unsubscribed) return;
      cb(new Set());
    });

  return () => {
    unsubscribed = true;
    if (typeof unsubscribeSnapshot === 'function') {
      unsubscribeSnapshot();
    }
  };
};

export const subscribeToFanStatus = (targetUid, cb, options = {}) => {
  let unsubscribed = false;
  let unsubscribeSnapshot = null;

  waitForAuthReady()
    .then((resolvedUser) => {
      if (unsubscribed) return;
      const user = resolvedUser ?? authStateUser ?? getFirebaseAuth().currentUser;
      logFanProjectContextOnce(user?.uid || null);
      const expectedAuthUid = options?.expectedAuthUid || null;
      if (!user?.uid || !targetUid) {
        cb(false);
        return;
      }
      if (expectedAuthUid && user.uid !== expectedAuthUid) {
        console.info('Fan listener overgeslagen door auth mismatch.', getFanDiagnostics({
          targetUid,
          authUid: user.uid,
          extra: { expectedAuthUid },
        }));
        cb(false);
        return;
      }

      const fanRef = doc(getFirebaseDb(), 'users', user.uid, 'following', targetUid);
      let hasLoggedError = false;
      unsubscribeSnapshot = onSnapshot(
        fanRef,
        (snapshot) => cb(snapshot.exists()),
        (error) => {
          if (!hasLoggedError) {
            hasLoggedError = true;
            console.warn('Fan status listener tijdelijk niet beschikbaar.', getFanDiagnostics({
              targetUid,
              authUid: user.uid,
              extra: {
                errorCode: error?.code || null,
                errorMessage: error?.message || null,
              },
            }));
          }
          cb(false);
        },
      );
    })
    .catch((error) => {
      if (unsubscribed) return;
      console.warn('Fan status listener kon auth-status niet bepalen.', getFanDiagnostics({
        targetUid,
        extra: {
          errorCode: error?.code || null,
          errorMessage: error?.message || null,
        },
      }));
      cb(false);
    });

  return () => {
    unsubscribed = true;
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = null;
  };
};

export const getFanDebugContext = async (targetUid) => {
  const currentUser = await waitForAuthReady();
  return getFanDiagnostics({ targetUid, authUid: currentUser?.uid });
};

export const subscribeToFanCounts = (uid, cb) => {
  if (!uid) {
    cb({ fansCount: 0, fanOfCount: 0 });
    return () => {};
  }

  let hasLoggedError = false;
  return onSnapshot(
    doc(getFirebaseDb(), 'publicUsers', uid),
    (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {};
      cb({
        fansCount: Number(data?.fansCount || 0),
        fanOfCount: Number(data?.fanOfCount || 0),
      });
    },
    (error) => {
      if (!hasLoggedError) {
        hasLoggedError = true;
        console.warn('Fan counters tijdelijk niet beschikbaar:', error?.code || error?.message || error);
      }
      cb({ fansCount: 0, fanOfCount: 0 });
    },
  );
};

const resolveAuthProvider = (user) => {
  if (user?.providerData?.some((provider) => provider?.providerId === 'google.com')) {
    return 'google.com';
  }
  return user?.providerData?.[0]?.providerId ?? null;
};

const canWriteUserProfile = async (user) => {
  if (!user?.uid) return false;
  if (user.emailVerified === true) return true;
  if (!import.meta.env.DEV) return false;
  return isCodexDevUser(user);
};

export const ensureUserProfile = async (user) => {
  if (!canAccessFirestore({ authReady: authStateReady, user }) || !user?.uid) return null;
  const providerId = resolveAuthProvider(user);
  const defaultOnboardingStep = providerId === 'google.com' ? 2 : 1;
  const resolvedDisplayName = resolveDisplayName(user);
  const resolvedEmail = user.email ?? null;
  const writeAllowed = await canWriteUserProfile(user);
  const snapshot = await fetchUserProfile(user.uid, { authReady: authStateReady, user });
  if (!snapshot) return null;
  const isPermissionDenied = (error) => error?.code === 'permission-denied';
  if (snapshot.exists()) {
    const data = snapshot.data();
    if (isOnboardingComplete(data) && Number(data?.onboardingStep || 0) < 5) {
      await safeUserWrite(user.uid, { onboardingStep: 5 }, user);
      data.onboardingStep = 5;
      devLog('[onboarding-state]', { uid: user.uid, action: 'repair-step-to-5' });
    }
    if (!writeAllowed) {
      if (import.meta.env.DEV) {
        console.log('ensureUserProfile skipped write: unverified user');
      }
      return data;
    }
    const updates = {};
    if (!data.displayName && resolvedDisplayName) updates.displayName = resolvedDisplayName;
    if (!data.email && resolvedEmail) updates.email = resolvedEmail;
    if (!data.authProvider && providerId) updates.authProvider = providerId;
    if (data.onboardingStep == null) updates.onboardingStep = defaultOnboardingStep;
    if (data.onboardingComplete == null) {
      const hasRoles = Array.isArray(data.roles) && data.roles.length > 0;
      updates.onboardingComplete = hasRoles;
    }
    if (Object.keys(updates).length) {
      try {
        await safeUserWrite(user.uid, updates, user);
      } catch (error) {
        if (!isPermissionDenied(error)) throw error;
        if (import.meta.env.DEV) {
          console.log('ensureUserProfile skipped update: permission denied');
        }
        return data;
      }
    }
    const displayName = updates.displayName || data.displayName || resolvedDisplayName;
    const username = normalizeUsername(data.username) || generateUsername(displayName, user.uid);
    try {
      await writePublicUserProfile(
        user.uid,
        {
          ...data,
          displayName,
          username,
          photoURL: data.photoURL ?? user.photoURL ?? null,
        },
        {},
      );
    } catch (error) {
      if (!isPermissionDenied(error)) throw error;
      if (import.meta.env.DEV) {
        console.log('ensureUserProfile skipped public profile sync: permission denied');
      }
    }
    return { ...data, ...updates };
  }

  if (!writeAllowed) {
    if (import.meta.env.DEV) {
      console.log('ensureUserProfile skipped write: unverified user');
    }
    return {
      uid: user.uid,
      displayName: resolvedDisplayName,
      email: resolvedEmail,
      onboardingStep: defaultOnboardingStep,
    };
  }

  const profile = {
    uid: user.uid,
    displayName: resolvedDisplayName,
    photoURL: user.photoURL ?? null,
    email: resolvedEmail,
    authProvider: providerId,
    onboardingStep: defaultOnboardingStep,
    onboardingComplete: false,
  };
  try {
    await safeUserWrite(user.uid, {
      ...profile,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, user);
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    if (import.meta.env.DEV) {
      console.log('ensureUserProfile skipped create: permission denied');
    }
    return profile;
  }
  const username = generateUsername(resolvedDisplayName, user.uid);
  try {
    await writePublicUserProfile(user.uid, {
      username,
      displayName: resolvedDisplayName,
      photoURL: user.photoURL ?? null,
    });
  } catch (error) {
    if (!isPermissionDenied(error)) throw error;
    if (import.meta.env.DEV) {
      console.log('ensureUserProfile skipped public profile create: permission denied');
    }
  }
  return profile;
};

export const migrateArtifactsUserData = async (user) => {
  if (!user?.uid) return null;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;
  if (!appId) return null;
  const db = getFirebaseDb();
  const [profileSnap, publicSnap, existingProfileSnap] = await Promise.all([
    getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'main')),
    getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'user_indices', user.uid)),
    getDoc(doc(db, 'users', user.uid)),
  ]);
  const migrations = [];
  let migratedProfile = false;
  if (profileSnap.exists()) {
    const data = profileSnap.data();
    
    // Sanitize themes in migrated data
    if (data.themes && Array.isArray(data.themes)) {
      data.themes = sanitizeThemes(data.themes);
    }
    
    if (!existingProfileSnap.exists()) {
      if (import.meta.env.DEV) {
        console.log('[migrateArtifactsUserData] Creating users/' + user.uid + ' from artifacts', data);
      }
      migrations.push(patchUserProfile(
        user.uid,
        { ...data, updatedAt: serverTimestamp() },
        { label: 'migrateArtifactsUserData(create)' },
      ));
      migratedProfile = true;
    } else {
      const existingData = existingProfileSnap.data() || {};
      const updates = Object.entries(data).reduce((acc, [key, value]) => {
        if (value === undefined) return acc;
        const existingValue = existingData[key];
        if (existingValue === undefined || existingValue === null) {
          acc[key] = value;
        }
        return acc;
      }, {});
      if (Object.keys(updates).length) {
        if (import.meta.env.DEV) {
          console.log('[migrateArtifactsUserData] Updating users/' + user.uid + ' from artifacts', updates);
        }
        migrations.push(patchUserProfile(
          user.uid,
          { ...updates, updatedAt: serverTimestamp() },
          { label: 'migrateArtifactsUserData(update)' },
        ));
        migratedProfile = true;
      }
    }
  }
  if (publicSnap.exists()) {
    const data = publicSnap.data();
    const existingPublicSnap = await getDoc(doc(db, 'publicUsers', user.uid));
    const existingPublic = existingPublicSnap.exists() ? existingPublicSnap.data() : {};
    migrations.push(writePublicUserProfile(user.uid, data, existingPublic));
  }
  if (!migrations.length) return null;
  await Promise.all(migrations);
  return {
    migratedProfile,
    migratedPublic: publicSnap.exists(),
  };
};

const shouldRedirect = (error) =>
  ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error?.code);

export const signInWithGoogle = async () => {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    if (shouldRedirect(error)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
};

export const signInWithApple = async () => {
  const auth = getFirebaseAuth();
  const provider = new OAuthProvider('apple.com');
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    if (shouldRedirect(error)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
};

export const handleAuthRedirectResult = async () => {
  const result = await getRedirectResult(getFirebaseAuth());
  if (result?.user) {
    await ensureUserProfile(result.user);
    return result.user;
  }
  return null;
};

export const addPost = async (post) => {
  const payload = { ...post, createdAt: serverTimestamp() };
  const ref = await addDoc(collection(getFirebaseDb(), 'posts'), payload);
  return ref.id;
};

export const subscribeToPosts = (cb) =>
  onSnapshot(
    query(collection(getFirebaseDb(), 'posts'), orderBy('createdAt', 'desc')),
    cb,
    (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', 'Posts listener posts'),
  );

export const addComment = (postId, comment) =>
  addDoc(collection(getFirebaseDb(), 'posts', postId, 'comments'), {
    ...comment,
    ...(comment?.authorId === 'codex-dev-user' ? { testActor: 'codex' } : {}),
    createdAt: serverTimestamp(),
  });

export const deleteComment = (postId, commentId) =>
  deleteDoc(doc(getFirebaseDb(), 'posts', postId, 'comments', commentId));

export const subscribeToComments = (postId, cb) =>
  onSnapshot(
    query(collection(getFirebaseDb(), 'posts', postId, 'comments'), orderBy('createdAt', 'asc')),
    cb,
    (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Comments listener posts/${postId}/comments`),
  );

export const toggleLike = async (postId, uid) => {
  const likeRef = doc(getFirebaseDb(), 'posts', postId, 'likes', uid);
  const existing = await getDoc(likeRef);
  if (existing.exists()) {
    await deleteDoc(likeRef);
  } else {
    await setDoc(likeRef, { createdAt: serverTimestamp() });
  }
};

export const subscribeToLikes = (postId, cb) =>
  onSnapshot(
    collection(getFirebaseDb(), 'posts', postId, 'likes'),
    cb,
    (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Likes listener posts/${postId}/likes`),
  );

/**
 * Ensures a support thread exists for a user.
 * Creates the thread with base fields if it doesn't exist.
 * 
 * @param {string} threadId - The thread ID (e.g., 'support_uid')
 * @param {string} type - Thread type: 'support' or 'moderation'
 * @param {Object} userProfile - Optional user profile data { displayName, photoURL, username }
 * @returns {Promise<string>} - The threadId
 */
export const ensureThreadExists = async (threadId, type = 'support', userProfile = {}) => {
  if (!threadId) {
    throw new Error('threadId is required');
  }

  const db = getFirebaseDb();
  const threadRef = doc(db, 'threads', threadId);

  try {
    const created = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(threadRef);

      if (snap.exists()) {
        if (import.meta.env.DEV) {
          console.log(`[ensureThreadExists] Thread ${threadId} already exists`);
        }
        return false;
      }

      // Thread doesn't exist, create it
      const { displayName = 'Artes gebruiker', photoURL = null, username = '' } = userProfile;
      const uid = threadId.split('_')[1]; // Extract uid from 'support_uid'

      transaction.set(threadRef, {
        type,
        threadKey: threadId,
        userUid: uid,
        participantUids: [uid],
        participants: [uid],
        userDisplayName: displayName,
        userDisplayNameLower: displayName.toLowerCase(),
        userPhotoURL: photoURL,
        userUsername: username,
        userMessageAllowance: 1,
        userCanSend: true,
        unreadForModerator: 0,
        unreadForUser: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (import.meta.env.DEV) {
        console.log(`[ensureThreadExists] Created thread ${threadId} with type: ${type}`);
      }

      return true;
    });

    return threadId;
  } catch (error) {
    console.error(`[ensureThreadExists] Error ensuring thread ${threadId}:`, error);
    throw error;
  }
};

export const ensureSupportThreadExists = async (uid, authUser = null) => {
  if (!uid) {
    throw new Error('uid is required to ensure support thread');
  }

  const functionsBase = import.meta.env.VITE_FUNCTIONS_BASE_URL || import.meta.env.VITE_FUNCTIONS_BASE;
  if (!functionsBase) {
    throw new Error('VITE_FUNCTIONS_BASE_URL is required');
  }

  const token = authUser ? await authUser.getIdToken() : null;
  const response = await fetch(`${functionsBase}/ensureSupportThread`, {
    method: 'POST',
    headers: token
      ? {
        Authorization: `Bearer ${token}`,
      }
      : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || 'Support thread creation failed';
    throw new Error(message);
  }
  if (import.meta.env.DEV) {
    console.log('[ensureSupportThreadExists] Ensured support thread via function', data?.threadId);
  }
  return data?.threadId || `support_${uid}`;
};

/**
 * DEV-ONLY MIGRATION: Remove "General" from user's themes in both users and publicUsers collections.
 * Call this once to clean up existing data. NOT for production.
 */
export const migrateRemoveGeneralTheme = async (uid) => {
  if (!import.meta.env.DEV) {
    console.warn('[migrateRemoveGeneralTheme] Skipped: only runs in DEV mode');
    return;
  }
  
  const db = getFirebaseDb();
  try {
    // Check users/{uid}
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists() && Array.isArray(userSnap.data().themes)) {
      const userThemes = userSnap.data().themes;
      if (userThemes.includes('General')) {
        const cleaned = userThemes.filter((t) => t !== 'General');
        await setDoc(userRef, { themes: cleaned }, { merge: true });
        console.log('[migrateRemoveGeneralTheme] Updated users/' + uid + ' themes:', cleaned);
      }
    }

    // Check publicUsers/{uid}
    const publicRef = doc(db, 'publicUsers', uid);
    const publicSnap = await getDoc(publicRef);
    if (publicSnap.exists() && Array.isArray(publicSnap.data().themes)) {
      const publicThemes = publicSnap.data().themes;
      if (publicThemes.includes('General')) {
        const cleaned = publicThemes.filter((t) => t !== 'General');
        await setDoc(publicRef, { themes: cleaned }, { merge: true });
        console.log('[migrateRemoveGeneralTheme] Updated publicUsers/' + uid + ' themes:', cleaned);
      }
    }

    console.log('[migrateRemoveGeneralTheme] Completed for uid:', uid);
  } catch (error) {
    console.error('[migrateRemoveGeneralTheme] Error:', error);
    throw error;
  }
};
