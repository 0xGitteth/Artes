import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes } from 'firebase/storage';

const ownerUid = 'owner_uid';
const otherUid = 'other_uid';
const jpegMeta = { contentType: 'image/jpeg' };

const testEnv = await initializeTestEnvironment({
  projectId: `artes-storage-rules-${Date.now()}`,
  storage: {
    rules: readFileSync('storage.rules', 'utf8'),
  },
});

try {
  const ownerStorage = testEnv.authenticatedContext(ownerUid, { email_verified: true }).storage();
  const otherStorage = testEnv.authenticatedContext(otherUid, { email_verified: true }).storage();
  const unauthedStorage = testEnv.unauthenticatedContext().storage();
  const ownerUnverifiedStorage = testEnv.authenticatedContext(ownerUid, { email_verified: false }).storage();

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['avatar'], { type: 'image/jpeg' }), jpegMeta),
  );

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

  console.log('storage profileImages rules tests passed');
} finally {
  await testEnv.cleanup();
}
