import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const ownerUid = 'owner_uid';
const otherUid = 'other_uid';
const moderatorUid = 'moderator_uid';
const moderatorEmail = 'mod@example.com';
const uploadPath = `uploads/${ownerUid}/publication.jpg`;
const claimRequestId = 'claim_request_1';
const claimProofPath = `claimProofs/${claimRequestId}/${ownerUid}.png`;
const jpegMeta = { contentType: 'image/jpeg' };
const pngMeta = { contentType: 'image/png' };
const textMeta = { contentType: 'text/plain' };
const webpMeta = { contentType: 'image/webp' };

const testEnv = await initializeTestEnvironment({
  projectId: 'artes-media-app',
  firestore: {
    rules: readFileSync('firestore.rules', 'utf8'),
  },
  storage: {
    rules: readFileSync('storage.rules', 'utf8'),
  },
});

try {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'config', 'moderation'), {
      moderatorEmails: [moderatorEmail],
    });
  });

  const ownerStorage = testEnv.authenticatedContext(ownerUid, { email_verified: true, email: 'owner@example.com' }).storage();
  const otherStorage = testEnv.authenticatedContext(otherUid, { email_verified: true, email: 'other@example.com' }).storage();
  const moderatorStorage = testEnv.authenticatedContext(moderatorUid, {
    email_verified: true,
    email: moderatorEmail,
  }).storage();
  const unauthedStorage = testEnv.unauthenticatedContext().storage();

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, uploadPath), new Blob(['valid-image'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(otherStorage, `uploads/${ownerUid}/intrusion.jpg`), new Blob(['hack'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(unauthedStorage, `uploads/${ownerUid}/anon.jpg`), new Blob(['anon'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `uploads/${ownerUid}/not-image.txt`), new Blob(['not-image'], { type: 'text/plain' }), textMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `uploads/${ownerUid}/oversized.jpg`), new Blob(['x'.repeat(10 * 1024 * 1024 + 1)], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `uploads/${ownerUid}/nested/publication.jpg`), new Blob(['nested'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertSucceeds(getBytes(ref(ownerStorage, uploadPath)));
  await assertSucceeds(getBytes(ref(moderatorStorage, uploadPath)));
  await assertFails(getBytes(ref(otherStorage, uploadPath)));

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, claimProofPath), new Blob(['valid-png-proof'], { type: 'image/png' }), pngMeta),
  );

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, claimProofPath), new Blob(['valid-jpeg-proof'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, claimProofPath), new Blob(['valid-webp-proof'], { type: 'image/webp' }), webpMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, claimProofPath), new Blob(['not-image-proof'], { type: 'text/plain' }), textMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `claimProofs/${claimRequestId}/wrong.png`), new Blob(['wrong-name'], { type: 'image/png' }), pngMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `claimProofs/${claimRequestId}/${ownerUid}.jpg`), new Blob(['wrong-filename-extension'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `claimProofs/${claimRequestId}/${ownerUid}.png`), new Blob(['x'.repeat(10 * 1024 * 1024 + 1)], { type: 'image/png' }), pngMeta),
  );

  await assertSucceeds(getBytes(ref(moderatorStorage, claimProofPath)));
  await assertFails(getBytes(ref(otherStorage, claimProofPath)));

  console.log('storage uploads and claimProofs rules tests passed');
} finally {
  await testEnv.cleanup();
}
