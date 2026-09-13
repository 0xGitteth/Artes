import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'artes-post-publication-rules-test';

const validModeratedPost = (authorId) => ({
  title: 'Post',
  description: '',
  imageUrl: 'https://example.test/image.jpg',
  authorId,
  authorUid: authorId,
  authorProfileId: authorId,
  authorOwnerUid: authorId,
  styles: ['Portrait'],
  makerTags: [],
  appliedTriggers: [],
  outcome: 'allowed',
  shouldReview: false,
  credits: [{
    role: 'photographer',
    isSelf: true,
    isMaker: true,
    makerFunction: 'photographer',
    consentStatus: 'accepted',
  }],
  uploadConsent: {
    version: 1,
    hasMaker: true,
    makerCreditIndex: 0,
    makerRoles: ['photographer', 'artist', 'videographer', 'retoucher', 'art_director'],
    consentStatuses: ['pending', 'accepted', 'rejected', 'notRequired', 'anonymous', 'pressOrStreetException'],
  },
  consentAudit: [{ action: 'uploadConsentCaptured' }],
});

async function run() {
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });
  try {
    const uid = 'adult-user';
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', uid), {
        uid,
        ageVerified: true,
        isAdult: true,
        didit: { status: 'approved' },
        idv: { status: 'approved' },
      });
    });
    const adult = env.authenticatedContext(uid, {
      email: 'adult@example.test',
      email_verified: true,
      idvVerified: true,
      isAdult: true,
    }).firestore();
    await assertFails(setDoc(doc(adult, 'posts', 'client-created'), validModeratedPost(uid)));


    const serverPostRef = doc(adult, 'posts', 'server-created');
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'posts', 'server-created'), validModeratedPost(uid));
    });
    await assertSucceeds(updateDoc(serverPostRef, { title: 'Edited title' }));
    await assertSucceeds(updateDoc(serverPostRef, { description: 'Edited description' }));
    await assertFails(updateDoc(serverPostRef, { imageUrl: 'https://attacker.invalid/replacement.jpg' }));
    await assertFails(updateDoc(serverPostRef, { styles: ['Art Nude'] }));
    await assertFails(updateDoc(serverPostRef, { makerTags: ['kinkBdsm'] }));
    await assertFails(updateDoc(serverPostRef, { appliedTriggers: ['adultArtNude'] }));
    await assertFails(updateDoc(serverPostRef, { uploadConsent: { version: 1 } }));
    await assertFails(updateDoc(serverPostRef, { consentAudit: [] }));

    const codexUid = 'codex-dev-user';
    const codex = env.authenticatedContext(codexUid, {
      email: 'codex@example.test',
      email_verified: true,
      devCodex: true,
      devActor: 'codex',
    }).firestore();
    await assertSucceeds(setDoc(doc(codex, 'codexDevPosts', 'isolated-client-created'), validModeratedPost(codexUid)));
  } finally {
    await env.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
