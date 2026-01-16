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
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
} from 'firebase/firestore';

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

export const getFirebaseAuthInstance = () => getFirebaseAuth();
export const getFirebaseDbInstance = () => getFirebaseDb();

export const initAuth = async () => {
  const auth = getFirebaseAuth();
  await setPersistence(auth, browserLocalPersistence);
  return auth;
};

export const observeAuth = (cb) => onAuthStateChanged(getFirebaseAuth(), cb);

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

const upsertPublicUserProfile = async (uid, payload) => {
  if (!uid) return;
  await setDoc(
    doc(getFirebaseDb(), 'publicUsers', uid),
    {
      uid,
      username: payload.username,
      displayName: payload.displayName,
      displayNameLower: payload.displayNameLower,
      photoURL: payload.photoURL ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

// Profile payload fields we store (subset used by UI):
// avatar, headerImage, headerPosition, quickProfilePreviewMode, quickProfilePostIds.
export const createUserProfile = async (uid, profile) => {
  const payload = {
    ...profile,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(getFirebaseDb(), 'users', uid), payload);
};

export const updateUserProfile = async (uid, data) => {
  await setDoc(
    doc(getFirebaseDb(), 'users', uid),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  );
  const publicUpdates = {};
  if (data.displayName) {
    publicUpdates.displayName = data.displayName;
    publicUpdates.displayNameLower = String(data.displayName || '').toLowerCase();
  }
  if (data.username) {
    publicUpdates.username = normalizeUsername(data.username);
  }
  if (data.photoURL || data.avatar) {
    publicUpdates.photoURL = data.photoURL ?? data.avatar ?? null;
  }
  if (Object.keys(publicUpdates).length > 0) {
    const publicSnap = await getDoc(doc(getFirebaseDb(), 'publicUsers', uid));
    const existing = publicSnap.exists() ? publicSnap.data() : {};
    const displayName = publicUpdates.displayName || existing.displayName || 'Artes gebruiker';
    const displayNameLower = publicUpdates.displayNameLower || existing.displayNameLower || displayName.toLowerCase();
    const username = publicUpdates.username || existing.username || generateUsername(displayName, uid);
    await upsertPublicUserProfile(uid, {
      username,
      displayName,
      displayNameLower,
      photoURL: publicUpdates.photoURL ?? existing.photoURL ?? null,
    });
  }
};

export const fetchUserProfile = (uid) => getDoc(doc(getFirebaseDb(), 'users', uid));

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

export const subscribeToProfile = (uid, cb) => onSnapshot(doc(getFirebaseDb(), 'users', uid), cb);

const resolveAuthProvider = (user) => {
  if (user?.providerData?.some((provider) => provider?.providerId === 'google.com')) {
    return 'google.com';
  }
  return user?.providerData?.[0]?.providerId ?? null;
};

export const ensureUserProfile = async (user) => {
  if (!user?.uid) return null;
  const providerId = resolveAuthProvider(user);
  const defaultOnboardingStep = providerId === 'google.com' ? 2 : 1;
  const resolvedDisplayName = resolveDisplayName(user);
  const resolvedEmail = user.email ?? null;
  const snapshot = await fetchUserProfile(user.uid);
  if (snapshot.exists()) {
    const data = snapshot.data();
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
      await updateUserProfile(user.uid, updates);
    }
    const displayName = updates.displayName || data.displayName || resolvedDisplayName;
    const displayNameLower = String(displayName || '').toLowerCase();
    const username = normalizeUsername(data.username) || generateUsername(displayName, user.uid);
    await upsertPublicUserProfile(user.uid, {
      username,
      displayName,
      displayNameLower,
      photoURL: data.photoURL ?? user.photoURL ?? null,
    });
    return { ...data, ...updates };
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
  await createUserProfile(user.uid, profile);
  const displayNameLower = String(resolvedDisplayName || '').toLowerCase();
  const username = generateUsername(resolvedDisplayName, user.uid);
  await upsertPublicUserProfile(user.uid, {
    username,
    displayName: resolvedDisplayName,
    displayNameLower,
    photoURL: user.photoURL ?? null,
  });
  return profile;
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
  onSnapshot(query(collection(getFirebaseDb(), 'posts'), orderBy('createdAt', 'desc')), cb);

export const addComment = (postId, comment) =>
  addDoc(collection(getFirebaseDb(), 'posts', postId, 'comments'), {
    ...comment,
    createdAt: serverTimestamp(),
  });

export const subscribeToComments = (postId, cb) =>
  onSnapshot(query(collection(getFirebaseDb(), 'posts', postId, 'comments'), orderBy('createdAt', 'asc')), cb);

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
  onSnapshot(collection(getFirebaseDb(), 'posts', postId, 'likes'), cb);
