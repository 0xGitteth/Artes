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
  runTransaction,
} from 'firebase/firestore';
import { SUPPORT_INTRO_TEXT } from './utils/supportChat';

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

const PUBLIC_PROFILE_FIELDS = [
  'bio',
  'roles',
  'themes',
  'linkedAgencyName',
  'linkedCompanyName',
  'linkedAgencyLink',
  'linkedCompanyLink',
  'headerImage',
  'headerPosition',
  'quickProfilePreviewMode',
  'quickProfilePostIds',
  'avatar',
];

const buildPublicProfilePayload = (data = {}, uid, existingPublic = {}) => {
  const payload = {};
  PUBLIC_PROFILE_FIELDS.forEach((field) => {
    if (data[field] !== undefined) {
      payload[field] = data[field];
    }
  });
  const hasDisplayName = data.displayName !== undefined;
  const hasUsername = data.username !== undefined;
  if (hasDisplayName) {
    payload.displayName = data.displayName;
    payload.displayNameLower = String(data.displayName || '').toLowerCase();
  }
  if (hasUsername) {
    payload.username = normalizeUsername(data.username);
  }
  if (data.photoURL !== undefined || data.avatar !== undefined) {
    payload.photoURL = data.photoURL ?? data.avatar ?? null;
  }
  if ((hasDisplayName || hasUsername) && !payload.username) {
    const fallbackUsername = existingPublic.username || (hasDisplayName ? generateUsername(data.displayName, uid) : null);
    if (fallbackUsername) {
      payload.username = fallbackUsername;
    }
  }
  return payload;
};

const writePublicUserProfile = async (uid, data = {}, existingPublic = {}) => {
  if (!uid) return;
  const payload = buildPublicProfilePayload(data, uid, existingPublic);
  if (!Object.keys(payload).length) return;
  
  // Sanitize themes: remove "General" which should never be auto-added
  if (payload.themes && Array.isArray(payload.themes)) {
    payload.themes = sanitizeThemes(payload.themes);
  }
  
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
  const payload = {
    ...profile,
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
  
  await setDoc(doc(getFirebaseDb(), 'users', uid), payload);
};

export const updateUserProfile = async (uid, data) => {
  const updatePayload = { ...data, updatedAt: serverTimestamp() };
  
  // Sanitize themes: remove "General" which should never be auto-added
  if (updatePayload.themes && Array.isArray(updatePayload.themes)) {
    updatePayload.themes = sanitizeThemes(updatePayload.themes);
  }
  
  if (import.meta.env.DEV) {
    console.log('[updateUserProfile] Writing to users/' + uid, updatePayload);
  }
  
  await setDoc(
    doc(getFirebaseDb(), 'users', uid),
    updatePayload,
    { merge: true },
  );
  const shouldSyncPublic = PUBLIC_PROFILE_FIELDS.some((field) => field in data)
    || data.displayName !== undefined
    || data.username !== undefined
    || data.photoURL !== undefined
    || data.avatar !== undefined;
  if (shouldSyncPublic) {
    let existingPublic = {};
    if (data.displayName !== undefined && data.username === undefined) {
      const publicSnap = await getDoc(doc(getFirebaseDb(), 'publicUsers', uid));
      existingPublic = publicSnap.exists() ? publicSnap.data() : {};
    }
    await writePublicUserProfile(uid, data, existingPublic);
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

export const subscribeToProfile = (uid, cb) => onSnapshot(
  doc(getFirebaseDb(), 'users', uid),
  cb,
  (err) => console.error('SNAPSHOT ERROR:', err.code, err.message, 'LABEL:', `Profile listener users/${uid}`),
);

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
    const username = normalizeUsername(data.username) || generateUsername(displayName, user.uid);
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
  const username = generateUsername(resolvedDisplayName, user.uid);
  await writePublicUserProfile(user.uid, {
    username,
    displayName: resolvedDisplayName,
    photoURL: user.photoURL ?? null,
  });
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
    const targetRef = doc(db, 'users', user.uid);
    
    // Sanitize themes in migrated data
    if (data.themes && Array.isArray(data.themes)) {
      data.themes = sanitizeThemes(data.themes);
    }
    
    if (!existingProfileSnap.exists()) {
      if (import.meta.env.DEV) {
        console.log('[migrateArtifactsUserData] Creating users/' + user.uid + ' from artifacts', data);
      }
      migrations.push(setDoc(
        targetRef,
        { ...data, updatedAt: serverTimestamp() },
        { merge: true },
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
        migrations.push(setDoc(
          targetRef,
          { ...updates, updatedAt: serverTimestamp() },
          { merge: true },
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
    createdAt: serverTimestamp(),
  });

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
 * Ensures a support or moderation thread exists for a user.
 * Creates the thread with base fields if it doesn't exist.
 * 
 * @param {string} threadId - The thread ID (e.g., 'support_uid' or 'moderation_uid')
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
      const uid = threadId.split('_')[1]; // Extract uid from 'support_uid' or 'moderation_uid'

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

export const ensureSupportThreadExists = async (uid) => {
  if (!uid) {
    throw new Error('uid is required to ensure support thread');
  }

  const db = getFirebaseDb();
  const threadId = `support_${uid}`;
  const threadRef = doc(db, 'threads', threadId);

  try {
    const snap = await getDoc(threadRef);
    if (snap.exists()) {
      if (import.meta.env.DEV) {
        console.log(`[ensureSupportThreadExists] Thread ${threadId} already exists`);
      }
      return threadId;
    }

    await setDoc(threadRef, {
      type: 'support',
      threadKey: threadId,
      userUid: uid,
      participants: [uid],
      participantUids: [uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessagePreview: SUPPORT_INTRO_TEXT,
      lastMessageAt: serverTimestamp(),
      userCanSend: true,
      userMessageAllowance: 1,
    });

    await addDoc(collection(db, 'threads', threadId, 'messages'), {
      text: SUPPORT_INTRO_TEXT,
      createdAt: serverTimestamp(),
      senderRole: 'system',
      senderUid: null,
      senderId: uid,
    });

    if (import.meta.env.DEV) {
      console.log(`[ensureSupportThreadExists] Created support thread ${threadId} with intro message`);
    }

    return threadId;
  } catch (error) {
    console.error(`[ensureSupportThreadExists] Error ensuring support thread ${threadId}:`, error);
    throw error;
  }
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
