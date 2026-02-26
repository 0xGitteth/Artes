import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  updateDoc,
  deleteField,
} from 'firebase/firestore';

const PROJECT_ID = 'artes-rules-test';

const authedContext = (env, uid) => env.authenticatedContext(uid, { email: `${uid}@example.com` });

async function run() {
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });

  try {
    const ownerUid = 'owner_1';
    const otherUid = 'other_1';

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'publicUsers', ownerUid), {
        uid: ownerUid,
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        email: 'legacy@example.com',
        updatedAt: new Date(),
      });
    });

    const ownerDb = authedContext(testEnv, ownerUid).firestore();
    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime',
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime',
        displayNameLower: 'owner prime',
        email: deleteField(),
      }),
    );

    const otherDb = authedContext(testEnv, otherUid).firestore();
    await assertFails(
      updateDoc(doc(otherDb, 'publicUsers', ownerUid), {
        displayName: 'Impersonation Attempt',
      }),
    );

    // Test 1: uid mismatch should be denied for owner writes.
    await assertFails(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        uid: 'other_uid',
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    // Test 2: uid absent should still be allowed when owner + allowlisted keys.
    await assertSucceeds(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        username: 'owner1',
        displayName: 'Owner No Uid',
        displayNameLower: 'owner no uid',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    // Test 3: users update must reject server-managed/sensitive fields.
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        moderator: true,
      }, { merge: true }),
    );
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        claims: { moderator: true },
      }, { merge: true }),
    );

    // Test 4: normal users profile updates remain allowed for owner.
    await assertSucceeds(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        displayName: 'Owner Profile',
        bio: 'Allowed profile update',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    console.log('PASS firestore.publicUsers.rules.test');
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error('FAIL firestore.publicUsers.rules.test');
  console.error(error);
  process.exitCode = 1;
});
