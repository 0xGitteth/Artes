import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { canAccessFirestore, devLog } from '../utils/firestoreGate';
import { buildUploadConsent, hasMakerCredit, normalizeConsentCredit, normalizeConsentException } from '../utils/uploadConsent';
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

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project',
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

const toPublicProfilePayload = (payload = {}, uid) => {
  const {
    email,
    ...rest
  } = payload || {};

  const publicPayload = {
    ...rest,
    uid,
    updatedAt: serverTimestamp(),
  };

  if (payload?.displayName) {
    publicPayload.displayNameLower = String(payload.displayName).toLowerCase();
  }
  if (payload?.username) {
    publicPayload.username = normalizeUsername(payload.username);
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
      return {
        id: docSnap.id,
        ...safeData,
        uid: safeData.uid || docSnap.id,
      };
    })),
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
  };
  logFirestoreOp('WRITE', `users/${uid}`, 'createProfile');
  await setDoc(doc(db, 'users', uid), payload);
  const publicPayload = toPublicProfilePayload(profile, uid);
  logFirestoreOp('WRITE', `publicUsers/${uid}`, 'createProfile');
  await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
};

// Update is merged into both private and public profile indices.
// Keep profile preview preferences in sync with UI expectations.
export const updateProfile = async (uid, payload) => {
  logFirestoreOp('UPDATE', `users/${uid}`, 'updateProfile');
  await setDoc(doc(db, 'users', uid), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
  const publicPayload = toPublicProfilePayload(payload, uid);
  logFirestoreOp('UPDATE', `publicUsers/${uid}`, 'updateProfile');
  await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
};

export const publishPost = async (post) => {
  if (!auth.currentUser) throw new Error('Not signed in');

  const normalizedException = normalizeConsentException(post.consentException || post.uploadConsent?.exception || {});
  const normalizedCredits = Array.isArray(post.credits)
    ? post.credits.map((credit) => normalizeConsentCredit(credit, { exception: normalizedException }))
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
    credits: normalizedCredits,
    uploadConsent,
    consentException: normalizedException,
    contributorIds,
    authorUid: auth.currentUser.uid,
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
  const { email: _publicEmail, ...safePublicData } = publicData;

  if (user?.uid !== userId) {
    return safePublicData;
  }

  const privateSnap = await getDoc(doc(db, 'users', userId));
  if (!privateSnap.exists()) return safePublicData;

  const privateData = privateSnap.data() || {};
  return {
    ...safePublicData,
    email: privateData.email ?? null,
  };
};

export const logout = () => signOut(auth);

export const getAppId = () => appId;
