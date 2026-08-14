import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

const ownerUid = 'owner_uid';
const otherUid = 'other_uid';
const jpegMeta = { contentType: 'image/jpeg' };
const managedProfileId = 'managed_profile_1';
const retiredUid = 'retired_codex_uid';

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
    await setDoc(doc(context.firestore(), 'profiles', managedProfileId), {
      type: 'company',
      displayName: 'Managed Profile',
      ownerUid,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(context.firestore(), 'codexDevActorRegistry', retiredUid), { uid: retiredUid, productionDenyOnly: true });
  });

  const ownerStorage = testEnv.authenticatedContext(ownerUid, { email_verified: true }).storage();
  const otherStorage = testEnv.authenticatedContext(otherUid, { email_verified: true }).storage();
  const unauthedStorage = testEnv.unauthenticatedContext().storage();
  const ownerUnverifiedStorage = testEnv.authenticatedContext(ownerUid, { email_verified: false }).storage();
  const retiredStorage = testEnv.authenticatedContext(retiredUid, { email_verified: true }).storage();

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['avatar'], { type: 'image/jpeg' }), jpegMeta),
  );
  await assertFails(uploadBytes(ref(retiredStorage, `profileImages/${retiredUid}/avatar.jpg`), new Blob(['blocked'], { type: 'image/jpeg' }), jpegMeta));

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/header.jpg`), new Blob(['header'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(otherStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['hack'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(unauthedStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['anon'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerUnverifiedStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['unverified'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['x'.repeat(360 * 1024)], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['png-file'], { type: 'image/png' }), { contentType: 'image/png' }),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/malware.html`), new Blob(['<script/>'], { type: 'text/html' }), { contentType: 'text/html' }),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/random.png`), new Blob(['png-file'], { type: 'image/png' }), { contentType: 'image/png' }),
  );

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, `managedProfiles/${ownerUid}/${managedProfileId}/avatar/avatar.jpg`), new Blob(['managed-avatar'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(otherStorage, `managedProfiles/${ownerUid}/${managedProfileId}/avatar/avatar.jpg`), new Blob(['hack'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `managedProfiles/${ownerUid}/missing_profile/avatar/avatar.jpg`), new Blob(['missing'], { type: 'image/jpeg' }), jpegMeta),
  );

  await assertFails(
    uploadBytes(ref(ownerStorage, `managedProfiles/${ownerUid}/${managedProfileId}/avatar/header.jpg`), new Blob(['wrong-name'], { type: 'image/jpeg' }), jpegMeta),
  );

  console.log('storage profileImages rules tests passed');
} finally {
  await testEnv.cleanup();
}
