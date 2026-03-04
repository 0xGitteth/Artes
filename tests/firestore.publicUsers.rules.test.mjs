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
  updateDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';

const PROJECT_ID = 'artes-rules-test';

const authedContext = (env, uid, token = {}) => env.authenticatedContext(uid, {
  email: `${uid}@example.com`,
  ...token,
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

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'publicUsers', ownerUid), {
        uid: ownerUid,
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        email: 'legacy@example.com',
        fansCount: 1,
        fanOfCount: 2,
        updatedAt: new Date(),
      });
      await setDoc(doc(db, 'users', ownerUid), {
        uid: ownerUid,
        displayName: 'Owner One',
      });
      await setDoc(doc(db, 'users', ownerUid, 'following', 'target_a'), {
        targetUid: 'target_a',
        createdAt: new Date(),
      });
    });

    const ownerDb = authedContext(testEnv, ownerUid, { email_verified: true }).firestore();
    const ownerUnverifiedDb = authedContext(testEnv, ownerUid).firestore();
    const otherDb = authedContext(testEnv, otherUid, { email_verified: true }).firestore();

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime',
      }),
    );

    // Compat: owner can still update normal public profile fields,
    // even when counter fields already exist on the doc.
    await assertSucceeds(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime',
        displayNameLower: 'owner prime',
        email: deleteField(),
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        fansCount: 99,
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        fanOfCount: 99,
      }),
    );

    // Also deny mixed payloads where a normal field update attempts
    // to sneak in a counter write.
    await assertFails(
      updateDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        displayName: 'Owner Prime 2',
        fansCount: 100,
      }),
    );

    await assertFails(
      updateDoc(doc(otherDb, 'publicUsers', ownerUid), {
        displayName: 'Impersonation Attempt',
      }),
    );

    await assertFails(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        uid: 'other_uid',
        username: 'owner1',
        displayName: 'Owner One',
        displayNameLower: 'owner one',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, 'publicUsers', ownerUid), {
        username: 'owner1',
        displayName: 'Owner No Uid',
        displayNameLower: 'owner no uid',
        updatedAt: new Date(),
      }, { merge: true }),
    );

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

    await assertSucceeds(
      setDoc(doc(ownerDb, 'users', ownerUid), {
        displayName: 'Owner Profile',
        bio: 'Allowed profile update',
        updatedAt: new Date(),
      }, { merge: true }),
    );

    await assertSucceeds(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_b'), {
        targetUid: 'target_b',
        createdAt: new Date(),
      }),
    );

    await assertFails(
      setDoc(doc(ownerUnverifiedDb, 'users', ownerUid, 'following', 'target_c'), {
        targetUid: 'target_c',
        createdAt: new Date(),
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_b'), {
        createdAt: new Date(),
      }),
    );

    // following create deny: self-follow
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', ownerUid), {
        targetUid: ownerUid,
        createdAt: new Date(),
      }),
    );

    // following create deny: path/data mismatch
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_d'), {
        targetUid: 'other-target',
        createdAt: new Date(),
      }),
    );

    // following create deny: extra client key fanUid
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_e'), {
        targetUid: 'target_e',
        createdAt: new Date(),
        fanUid: ownerUid,
      }),
    );

    // following create deny: extra client key countersApplied
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_f'), {
        targetUid: 'target_f',
        createdAt: new Date(),
        countersApplied: true,
      }),
    );

    await assertFails(getDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_a')));

    await assertFails(
      setDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_z'), {
        targetUid: 'target_z',
        createdAt: new Date(),
      }),
    );

    await assertFails(deleteDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_a')));

    await assertSucceeds(deleteDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_a')));

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
