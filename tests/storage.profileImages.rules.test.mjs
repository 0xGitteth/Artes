import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes } from 'firebase/storage';

const ownerUid = 'owner_uid';
const otherUid = 'other_uid';

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
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['avatar'], { type: 'image/jpeg' })),
  );

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, `profileImages/${ownerUid}/header.jpg`), new Blob(['header'], { type: 'image/jpeg' })),
  );

  await assertFails(
    uploadBytes(ref(otherStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['hack'], { type: 'image/jpeg' })),
  );


  await assertFails(
    uploadBytes(ref(unauthedStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['anon'], { type: 'image/jpeg' })),
  );

  await assertFails(
    uploadBytes(ref(ownerUnverifiedStorage, `profileImages/${ownerUid}/avatar.jpg`), new Blob(['unverified'], { type: 'image/jpeg' })),
  );


  console.log('storage profileImages rules tests passed');
} finally {
  await testEnv.cleanup();
}
