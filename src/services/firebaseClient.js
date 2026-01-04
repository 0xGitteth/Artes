import { initializeApp } from 'firebase/app';
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
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '0:000000000000:web:demo',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = import.meta.env.VITE_FIREBASE_APP_ID || 'default-app-id';

const artifactsPath = ['artifacts', appId];

export const ensureUserSignedIn = async (customToken) => {
  if (customToken) return signInWithCustomToken(auth, customToken);
  return signInAnonymously(auth);
};

export const subscribeToAuth = (callback) => onAuthStateChanged(auth, callback);

export const subscribeToProfile = (uid, callback) => {
  return onSnapshot(doc(db, ...artifactsPath, 'users', uid, 'profile', 'main'), callback);
};

export const subscribeToPosts = (callback) =>
  onSnapshot(
    query(collection(db, ...artifactsPath, 'public', 'data', 'posts'), orderBy('createdAt', 'desc')),
    (snapshot) => callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
  );

export const subscribeToUsers = (callback) =>
  onSnapshot(collection(db, ...artifactsPath, 'public', 'data', 'user_indices'), (snapshot) =>
    callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
  );

export const seedDemoContent = async (seedUsers, seedPosts) => {
  const check = await getDoc(doc(db, ...artifactsPath, 'public', 'data', 'user_indices', 'user_sophie'));
  if (check.exists()) return;

  const batch = writeBatch(db);
  seedUsers.forEach((user) => batch.set(doc(db, ...artifactsPath, 'public', 'data', 'user_indices', user.uid), user));
  seedPosts.forEach((post) => {
    batch.set(doc(db, ...artifactsPath, 'public', 'data', 'posts', post.id), {
      ...post,
      createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
};

export const createProfile = async (uid, profile) => {
  const payload = {
    createdAt: serverTimestamp(),
    ...profile,
  };
  await setDoc(doc(db, ...artifactsPath, 'users', uid, 'profile', 'main'), payload);
  await setDoc(doc(db, ...artifactsPath, 'public', 'data', 'user_indices', uid), payload);
};

export const updateProfile = async (uid, payload) => {
  await updateDoc(doc(db, ...artifactsPath, 'users', uid, 'profile', 'main'), payload);
  await updateDoc(doc(db, ...artifactsPath, 'public', 'data', 'user_indices', uid), payload);
};

export const publishPost = async (post) => {
  await addDoc(collection(db, ...artifactsPath, 'public', 'data', 'posts'), {
    ...post,
    createdAt: serverTimestamp(),
  });
};

export const fetchUserIndex = async (userId) => {
  const snapshot = await getDoc(doc(db, ...artifactsPath, 'public', 'data', 'user_indices', userId));
  return snapshot.exists() ? snapshot.data() : null;
};

export const logout = () => signOut(auth);

export const getAppId = () => appId;
