import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
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

// Debug logging helper (dev mode only)
const logFirestoreOp = (operation, path, context = '') => {
  if (import.meta.env.DEV) {
    console.log(`[Firestore ${operation}] ${path} ${context ? `(${context})` : ''}`);
  }
};

export const ensureUserSignedIn = async (customToken) => {
  if (customToken) return signInWithCustomToken(auth, customToken);
  return signInAnonymously(auth);
};

export const subscribeToAuth = (callback) =>
  onAuthStateChanged(auth, (user) => {
    console.log("AUTH STATE:", user ? user.uid : null);
    callback(user);
  });

export const subscribeToProfile = (uid, callback) => {
  logFirestoreOp('SUBSCRIBE', `users/${uid}`, 'profile');
  return onSnapshot(doc(db, 'users', uid), callback);
};

export const subscribeToPosts = (callback) => {
  if (!auth.currentUser) {
    console.log('subscribeToPosts skipped: not signed in');
    return () => {};
  }

  logFirestoreOp('SUBSCRIBE', 'posts', 'all posts ordered by createdAt');
  return onSnapshot(
    query(collection(db, 'posts'), orderBy('createdAt', 'desc')),
    (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
  );
};

export const subscribeToUsers = (callback) => {
  if (!auth.currentUser) {
    console.log('subscribeToUsers skipped: not signed in');
    return () => {};
  }

  logFirestoreOp('SUBSCRIBE', 'publicUsers', 'all public users');
  return onSnapshot(collection(db, 'publicUsers'), (snapshot) =>
    callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
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
  const displayNameLower = String(profile?.displayName || '').toLowerCase();
  const publicPayload = {
    ...profile,
    uid,
    displayNameLower,
    username: profile?.username ? normalizeUsername(profile.username) : profile?.username,
    updatedAt: serverTimestamp(),
  };
  logFirestoreOp('WRITE', `publicUsers/${uid}`, 'createProfile');
  await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
};

// Update is merged into both private and public profile indices.
// Keep profile preview preferences in sync with UI expectations.
export const updateProfile = async (uid, payload) => {
  logFirestoreOp('UPDATE', `users/${uid}`, 'updateProfile');
  await setDoc(doc(db, 'users', uid), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
  const publicPayload = {
    ...payload,
    uid,
    updatedAt: serverTimestamp(),
  };
  if (payload.displayName) {
    publicPayload.displayNameLower = String(payload.displayName).toLowerCase();
  }
  if (payload.username) {
    publicPayload.username = normalizeUsername(payload.username);
  }
  logFirestoreOp('UPDATE', `publicUsers/${uid}`, 'updateProfile');
  await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
};

export const publishPost = async (post) => {
  if (!auth.currentUser) throw new Error('Not signed in');

  logFirestoreOp('WRITE', 'posts/{auto}', 'publishPost');
  await addDoc(collection(db, 'posts'), {
    ...post,
    authorUid: auth.currentUser.uid,
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

export const fetchUserIndex = async (userId) => {
  const snapshot = await getDoc(doc(db, 'publicUsers', userId));
  return snapshot.exists() ? snapshot.data() : null;
};

export const logout = () => signOut(auth);

export const getAppId = () => appId;
