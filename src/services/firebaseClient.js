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

export const ensureUserSignedIn = async (customToken) => {
  if (customToken) return signInWithCustomToken(auth, customToken);
  return signInAnonymously(auth);
};

export const subscribeToAuth = (callback) => onAuthStateChanged(auth, callback);

export const subscribeToProfile = (uid, callback) => onSnapshot(doc(db, 'users', uid), callback);

export const subscribeToPosts = (callback) =>
  onSnapshot(
    query(collection(db, ...artifactsPath, 'public', 'data', 'posts'), orderBy('createdAt', 'desc')),
    (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
  );

export const subscribeToUsers = (callback) =>
  onSnapshot(collection(db, 'publicUsers'), (snapshot) =>
    callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
  );

export const seedDemoContent = async (seedUsers, seedPosts) => {
  const check = await getDoc(doc(db, 'publicUsers', 'user_sophie'));
  if (check.exists()) return;

  const batch = writeBatch(db);
  seedUsers.forEach((user) => batch.set(doc(db, 'publicUsers', user.uid), user));
  seedPosts.forEach((post) => {
    batch.set(doc(db, ...artifactsPath, 'public', 'data', 'posts', post.id), {
      ...post,
      createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
};

// Profile payload fields we store (subset used by UI):
// avatar, headerImage, headerPosition, quickProfilePreviewMode, quickProfilePostIds.
export const createProfile = async (uid, profile) => {
  const payload = {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...profile,
  };
  await setDoc(doc(db, 'users', uid), payload);
  const displayNameLower = String(profile?.displayName || '').toLowerCase();
  const publicPayload = {
    ...profile,
    uid,
    displayNameLower,
    username: profile?.username ? normalizeUsername(profile.username) : profile?.username,
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
};

// Update is merged into both private and public profile indices.
// Keep profile preview preferences in sync with UI expectations.
export const updateProfile = async (uid, payload) => {
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
  await setDoc(doc(db, 'publicUsers', uid), publicPayload, { merge: true });
};

export const publishPost = async (post) => {
  await addDoc(collection(db, ...artifactsPath, 'public', 'data', 'posts'), {
    ...post,
    createdAt: serverTimestamp(),
  });
};

export const updatePost = async (postId, payload) => {
  await updateDoc(doc(db, ...artifactsPath, 'public', 'data', 'posts', postId), {
    ...payload,
    updatedAt: serverTimestamp(),
  });
};

export const deletePost = async (postId) => {
  await deleteDoc(doc(db, ...artifactsPath, 'public', 'data', 'posts', postId));
};

export const fetchUserIndex = async (userId) => {
  const snapshot = await getDoc(doc(db, 'publicUsers', userId));
  return snapshot.exists() ? snapshot.data() : null;
};

export const logout = () => signOut(auth);

export const getAppId = () => appId;
