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
      await setDoc(doc(adminDb, 'contributors', 'contributor_private'), {
        displayName: 'Private Contact',
        displayNameLower: 'private contact',
        hasEmail: true,
        status: 'unclaimed',
      });
      await setDoc(doc(adminDb, 'contributors', 'contributor_private', 'private', 'contact'), {
        email: 'private@example.com',
      });
      await setDoc(doc(adminDb, 'contributorAliases', 'email:private@example.com'), {
        type: 'email',
        value: 'private@example.com',
        contributorId: 'contributor_private',
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

    const publicContributorSnap = await assertSucceeds(
      getDoc(doc(creatorDb, 'contributors', 'contributor_private')),
      'signed-in clients can read public contributor document',
    );
    const publicContributor = publicContributorSnap.data() || {};
    if (publicContributor.email !== undefined) {
      throw new Error('public contributor document exposed raw email');
    }
    await assertFails(
      setDoc(doc(creatorDb, 'contributors', 'client_email_leak'), {
        displayName: 'Email Leak',
        email: 'leak@example.com',
      }),
      'normal clients cannot create public contributor documents with raw email',
    );
    if (publicContributor.hasEmail !== true) {
      throw new Error('public contributor document should expose hasEmail only');
    }
    await assertFails(
      getDoc(doc(creatorDb, 'contributors', 'contributor_private', 'private', 'contact')),
      'normal clients cannot read private contributor contact doc',
    );
    await assertFails(
      setDoc(doc(creatorDb, 'contributors', 'contributor_private', 'private', 'contact'), { email: 'new@example.com' }),
      'normal clients cannot write private contributor contact doc',
    );
    await assertFails(
      getDoc(doc(creatorDb, 'contributorAliases', 'email:private@example.com')),
      'normal clients cannot read raw email contributor alias docs',
    );
  } finally {
    await testEnv.cleanup();
  }
}

run().then(() => console.log('firestore claimInvites rules tests passed')).catch((error) => {
  console.error(error);
  process.exit(1);
});
