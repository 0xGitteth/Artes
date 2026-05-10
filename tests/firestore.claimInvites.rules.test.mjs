import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

const PROJECT_ID = 'artes-claim-invites-rules-test';

const authedContext = (env, uid) => env.authenticatedContext(uid, {
  email: `${uid}@example.com`,
  email_verified: true,
});

async function run() {
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });

  try {
    const creatorUid = 'creator_1';
    const otherUid = 'other_1';
    const creatorDb = authedContext(testEnv, creatorUid).firestore();
    const otherDb = authedContext(testEnv, otherUid).firestore();

    const invitePayload = {
      contributorId: 'contributor_1',
      postId: 'post_1',
      createdByUid: creatorUid,
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 60_000)),
      usedAt: null,
      usedByUid: null,
    };

    await assertFails(
      setDoc(doc(creatorDb, 'claimInvites', 'direct-create'), invitePayload),
      'normal clients cannot directly create claim invites',
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, 'claimInvites', 'created-by'), invitePayload);
      await setDoc(doc(adminDb, 'claimInvites', 'legacy-creator'), {
        ...invitePayload,
        createdByUid: null,
        creatorUid: creatorUid,
      });
    });

    await assertSucceeds(
      getDoc(doc(creatorDb, 'claimInvites', 'created-by')),
      'creator can read invite created with createdByUid',
    );
    await assertSucceeds(
      getDoc(doc(creatorDb, 'claimInvites', 'legacy-creator')),
      'creator can read legacy invite created with creatorUid',
    );
    await assertFails(
      getDoc(doc(otherDb, 'claimInvites', 'created-by')),
      'other signed-in users cannot read creator invites',
    );
  } finally {
    await testEnv.cleanup();
  }
}

run().then(() => console.log('firestore claimInvites rules tests passed')).catch((error) => {
  console.error(error);
  process.exit(1);
});
