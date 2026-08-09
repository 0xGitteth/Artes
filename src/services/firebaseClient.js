import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { canAccessFirestore, devLog, isOnboardingComplete } from '../utils/firestoreGate';
import { buildUploadConsent, hasMakerCredit, normalizeConsentCredit, normalizeConsentException, sanitizePostCreditForWrite } from '../utils/uploadConsent';
import { buildPostAuthorFields, isLegacySetupProfileId, isPublishedPersonalUserProfile, resolvePostAuthorProfile } from '../utils/managedProfiles';
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  writeBatch,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';

const firebaseProjectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project';
const firebaseStorageBucket = String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim()
  || `${firebaseProjectId}.firebasestorage.app`;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo.firebaseapp.com',
  projectId: firebaseProjectId,
  storageBucket: firebaseStorageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '0:000000000000:web:demo',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = import.meta.env.VITE_FIREBASE_APP_ID || 'default-app-id';

const artifactsPath = ['artifacts', appId];
const normalizeUsername = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')
  .slice(0, 20);

const PUBLIC_NULLABLE_STRING_FIELDS = [
  'photoURL', 'avatar', 'headerImage', 'linkedAgencyName', 'linkedCompanyName',
  'linkedAgencyId', 'linkedCompanyId', 'linkedAgencyLink', 'linkedCompanyLink',
];
const PUBLIC_STRING_FIELDS = [
  'bio', 'headerPosition', 'linkedAgencyStatus', 'linkedCompanyStatus',
];
const PUBLIC_ARRAY_FIELDS = ['roles', 'themes', 'quickProfilePostIds'];
const cleanStringArray = (value) => (Array.isArray(value)
  ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
  : []);

const toPublicProfilePayload = (payload = {}, uid) => {
  const publicPayload = {
    uid,
    profileId: uid,
    ownerUid: uid,
    updatedAt: serverTimestamp(),
  };

  if (typeof payload?.displayName === 'string') {
    publicPayload.displayName = payload.displayName;
    publicPayload.displayNameLower = payload.displayName.toLowerCase();
  }
  if (typeof payload?.username === 'string') {
    publicPayload.username = normalizeUsername(payload.username);
  }
  PUBLIC_NULLABLE_STRING_FIELDS.forEach((field) => {
    if (typeof payload?.[field] === 'string' || payload?.[field] === null) {
      publicPayload[field] = payload[field];
    }
  });
  PUBLIC_STRING_FIELDS.forEach((field) => {
    if (typeof payload?.[field] === 'string') publicPayload[field] = payload[field];
  });
  PUBLIC_ARRAY_FIELDS.forEach((field) => {
    if (payload?.[field] !== undefined) publicPayload[field] = cleanStringArray(payload[field]);
  });
  if (['latest', 'best', 'manual'].includes(payload?.quickProfilePreviewMode)) {
    publicPayload.quickProfilePreviewMode = payload.quickProfilePreviewMode;
  }
  const step = Number(payload?.onboardingStep);
  if (Number.isInteger(step) && step >= 0 && step <= 10) {
    publicPayload.onboardingStep = step;
  }

  return publicPayload;
};

// Debug logging helper (dev mode only)
const logFirestoreOp = (operation, path, context = '') => {
  if (import.meta.env.DEV) {
    console.log(`[Firestore ${operation}] ${path} ${context ? `(${context})` : ''}`);
  }
};

export const subscribeToAuth = (callback) =>
  onAuthStateChanged(auth, async (user) => {
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

    callback(user);
  });

export const subscribeToProfile = (uid, callback, gate = {}) => {
  const authReady = gate?.authReady ?? true;
  const user = gate?.user ?? auth.currentUser;
  if (!canAccessFirestore({ authReady, user }) || !uid) {
    devLog('[firestore-gate]', { action: 'listener-skip', path: `users/${uid || 'unknown'}` });
    return null;
  }
  logFirestoreOp('SUBSCRIBE', `users/${uid}`, 'profile');

  return onSnapshot(
    doc(db, 'users', uid),
    (snapshot) => callback(snapshot),
    (err) => console.error('PROFILE LISTENER ERROR:', err.code, err.message, `path=users/${uid}`)
  );
};

export const subscribeToPosts = (callback, gate = {}) => {
  const authReady = gate?.authReady ?? true;
  const user = gate?.user ?? auth.currentUser;
  if (!canAccessFirestore({ authReady, user })) {
    devLog('[firestore-gate]', { action: 'listener-skip', path: 'posts' });
    return null;
  }
  logFirestoreOp('SUBSCRIBE', 'posts', 'all posts ordered by createdAt');

  return onSnapshot(
    query(collection(db, 'posts'), orderBy('createdAt', 'desc')),
    (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))),
    (err) => console.error('POSTS LISTENER ERROR:', err.code, err.message, 'path=posts')
  );
};

export const subscribeToUsers = (callback, gate = {}) => {
  const authReady = gate?.authReady ?? true;
  const user = gate?.user ?? auth.currentUser;
  if (!canAccessFirestore({ authReady, user })) {
    devLog('[firestore-gate]', { action: 'listener-skip', path: 'publicUsers' });
    return null;
  }
  logFirestoreOp('SUBSCRIBE', 'publicUsers', 'all public users');

  return onSnapshot(
    collection(db, 'publicUsers'),
    (snapshot) => callback(snapshot.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      const { email, ...safeData } = data;
      const resolvedUid = safeData.uid || docSnap.id;
      return {
        id: docSnap.id,
        ...safeData,
        uid: resolvedUid,
        profileId: safeData.profileId || resolvedUid,
        ownerUid: safeData.ownerUid || resolvedUid,
      };
    }).filter(isPublishedPersonalUserProfile)),
    (err) => console.error('PUBLICUSERS LISTENER ERROR:', err.code, err.message, 'path=publicUsers')
  );
};

export const seedDemoContent = async () => {
  if (!import.meta.env.DEV) return;
  if (!auth.currentUser) return;

  console.log('Seeding disabled for now');
};

// Profile payload fields we store (subset used by UI):
// avatar, headerImage, headerPosition, quickProfilePreviewMode, quickProfilePostIds.
export const createProfile = async (uid, profile) => {
  const payload = {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...profile,
    uid: profile?.uid || uid,
    profileId: profile?.profileId || uid,
    ownerUid: profile?.ownerUid || uid,
  };
  logFirestoreOp('WRITE', `users/${uid}`, 'createProfile');
  await setDoc(doc(db, 'users', uid), payload);
  if (isOnboardingComplete(profile)) {
    const publicPayload = { ...toPublicProfilePayload(profile, uid), onboardingComplete: true };
    logFirestoreOp('WRITE', `publicUsers/${uid}`, 'createProfile');
    await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
  }
};

// Update is merged into both private and public profile indices.
// Keep profile preview preferences in sync with UI expectations.
export const updateProfile = async (uid, payload) => {
  const privateSnap = await getDoc(doc(db, 'users', uid));
  const resultingProfile = { ...(privateSnap.exists() ? privateSnap.data() : {}), ...payload };
  logFirestoreOp('UPDATE', `users/${uid}`, 'updateProfile');
  await setDoc(doc(db, 'users', uid), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
  if (isOnboardingComplete(resultingProfile)) {
    const publicPayload = { ...toPublicProfilePayload(resultingProfile, uid), onboardingComplete: true };
    logFirestoreOp('UPDATE', `publicUsers/${uid}`, 'updateProfile');
    await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
  }
};

export const publishPost = async (post) => {
  if (!auth.currentUser) throw new Error('Not signed in');

  const authUid = auth.currentUser.uid;
  const requestedAuthorProfileId = post?.authorProfileId;
  let profileDoc = null;
  if (isLegacySetupProfileId(requestedAuthorProfileId)) {
    throw new Error('Dit profiel is nog niet openbaar. Sla het eerst op voordat je ermee kunt publiceren.');
  }
  if (requestedAuthorProfileId && requestedAuthorProfileId !== authUid) {
    const profileSnap = await getDoc(doc(db, 'profiles', requestedAuthorProfileId));
    if (!profileSnap.exists()) {
      throw new Error('Het gekozen actieve profiel bestaat niet of is niet beschikbaar.');
    }
    profileDoc = { id: profileSnap.id, profileId: profileSnap.id, ...profileSnap.data() };
  }
  const resolvedAuthorProfile = resolvePostAuthorProfile({
    authUid,
    requestedProfileId: requestedAuthorProfileId,
    profileDoc,
  });
  const authorFields = buildPostAuthorFields({
    authUid,
    resolvedProfileId: resolvedAuthorProfile.profileId,
  });

  const normalizedException = normalizeConsentException(post.consentException || post.uploadConsent?.exception || {});
  const normalizedCredits = Array.isArray(post.credits)
    ? post.credits.map((credit) => sanitizePostCreditForWrite(normalizeConsentCredit(credit, { exception: normalizedException })))
    : [];
  if (!hasMakerCredit(normalizedCredits)) {
    throw new Error('Upload requires at least one maker credit.');
  }
  const uploadConsent = post.uploadConsent || buildUploadConsent({
    credits: normalizedCredits,
    exception: normalizedException,
    aiPeoplePresent: false,
    subjectWarningAcknowledged: false,
  });
  const contributorIds = Array.from(new Set(normalizedCredits.map((credit) => credit?.contributorId).filter(Boolean)));

  logFirestoreOp('WRITE', 'posts/{auto}', 'publishPost');
  const isCodexActor = auth.currentUser.uid === 'codex-dev-user';
  return addDoc(collection(db, 'posts'), {
    ...post,
    ...authorFields,
    credits: normalizedCredits,
    uploadConsent,
    consentException: normalizedException,
    contributorIds,
    ...(isCodexActor ? { testActor: 'codex' } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updatePost = async (postId, payload) => {
  logFirestoreOp('UPDATE', `posts/${postId}`, 'updatePost');
  await updateDoc(doc(db, 'posts', postId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
};

export const deletePost = async (postId) => {
  logFirestoreOp('DELETE', `posts/${postId}`, 'deletePost');
  await deleteDoc(doc(db, 'posts', postId));
};

export const fetchUserIndex = async (userId, gate = {}) => {
  const authReady = gate?.authReady ?? true;
  const user = gate?.user ?? auth.currentUser;
  if (!canAccessFirestore({ authReady, user }) || !userId) {
    devLog('[firestore-gate]', { action: 'read-skip', path: `publicUsers/${userId || 'unknown'}` });
    return null;
  }
  const snapshot = await getDoc(doc(db, 'publicUsers', userId));
  if (!snapshot.exists()) return null;

  const publicData = snapshot.data() || {};
  if (!isPublishedPersonalUserProfile(publicData)) return null;
  const { email: _publicEmail, ...safePublicData } = publicData;
  const resolvedPublicData = {
    ...safePublicData,
    profileId: safePublicData.profileId || safePublicData.uid || userId,
    ownerUid: safePublicData.ownerUid || safePublicData.uid || userId,
  };

  if (user?.uid !== userId) {
    return resolvedPublicData;
  }

  const privateSnap = await getDoc(doc(db, 'users', userId));
  if (!privateSnap.exists()) return resolvedPublicData;

  const privateData = privateSnap.data() || {};
  return {
    ...resolvedPublicData,
    email: privateData.email ?? null,
  };
};

export const logout = () => signOut(auth);

export const getAppId = () => appId;
