import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'artes-moodboards-rules-test';
const authedContext = (env, uid) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true });

const moodboardPayload = (uid, overrides = {}) => ({
  ownerUid: uid,
  title: 'Inspiration',
  description: '',
  visibility: 'private',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  postCount: 0,
  coverPostIds: [],
  coverImageUrls: [],
  collaboratorUids: [],
  sharedWith: [],
  ...overrides,
});

const itemPayload = (uid, moodboardId, postId, overrides = {}) => ({
  postId,
  ownerUid: uid,
  moodboardId,
  createdAt: serverTimestamp(),
  postSnapshot: {
    imageUrl: 'https://example.test/post.jpg',
    title: 'Saved post',
    authorId: 'author-1',
  },
  ...overrides,
});

async function run() {
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });

  try {
    const ownerUid = 'owner_1';
    const otherUid = 'other_1';
    const boardId = 'board_1';
    const postId = 'post_1';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ownerUid), { uid: ownerUid });
      await setDoc(doc(context.firestore(), 'users', otherUid), { uid: otherUid });
    });

    const ownerDb = authedContext(testEnv, ownerUid).firestore();
    const otherDb = authedContext(testEnv, otherUid).firestore();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const ownerBoardRef = doc(ownerDb, 'users', ownerUid, 'moodboards', boardId);
    const otherBoardRef = doc(otherDb, 'users', ownerUid, 'moodboards', boardId);
    const publicBoardRef = doc(publicDb, 'users', ownerUid, 'moodboards', boardId);

    await assertSucceeds(setDoc(ownerBoardRef, moodboardPayload(ownerUid)), 'owner can create moodboard');
    await assertSucceeds(getDoc(ownerBoardRef), 'owner can read own moodboard');
    await assertSucceeds(updateDoc(ownerBoardRef, { title: 'Nieuwe titel', updatedAt: serverTimestamp() }), 'owner can update own moodboard title');
    await assertFails(getDoc(otherBoardRef), 'other user cannot read moodboard');
    await assertFails(getDoc(publicBoardRef), 'unauthenticated user cannot read moodboard');
    await assertFails(setDoc(doc(otherDb, 'users', ownerUid, 'moodboards', 'evil'), moodboardPayload(ownerUid)), 'other user cannot create moodboard under someone else');
    await assertFails(setDoc(doc(ownerDb, 'users', ownerUid, 'moodboards', 'spoof'), moodboardPayload(otherUid)), 'owner cannot spoof ownerUid');

    const ownerItemRef = doc(ownerDb, 'users', ownerUid, 'moodboards', boardId, 'items', postId);
    const otherItemReadRef = doc(otherDb, 'users', ownerUid, 'moodboards', boardId, 'items', postId);
    const otherItemRef = doc(otherDb, 'users', ownerUid, 'moodboards', boardId, 'items', 'post_2');
    const publicItemRef = doc(publicDb, 'users', ownerUid, 'moodboards', boardId, 'items', postId);
    await assertSucceeds(setDoc(ownerItemRef, itemPayload(ownerUid, boardId, postId)), 'owner can add item to own moodboard');
    await assertFails(getDoc(otherItemReadRef), 'other user cannot read moodboard items');
    await assertFails(setDoc(otherItemRef, itemPayload(ownerUid, boardId, 'post_2')), 'other user cannot add item to someone else moodboard');
    await assertFails(getDoc(publicItemRef), 'public visitor cannot read moodboard items');
    await assertSucceeds(deleteDoc(ownerItemRef), 'owner can remove item from own moodboard');
    await assertSucceeds(deleteDoc(ownerBoardRef), 'owner can delete own moodboard');
  } finally {
    await testEnv.cleanup();
  }
}

run().then(() => console.log('firestore moodboards rules tests passed')).catch((error) => {
  console.error(error);
  process.exit(1);
});
