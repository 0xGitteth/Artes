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
  serverTimestamp,
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
      await setDoc(doc(db, 'config', 'moderation'), {
        moderatorEmails: ['mod_1@example.com'],
      });
      await setDoc(doc(db, 'announcements', 'active_update'), {
        type: 'appUpdate',
        title: 'Nieuwe versie',
        body: 'Welkom bij de nieuwe app update',
        status: 'active',
        isCurrent: true,
        version: 2,
      });
      await setDoc(doc(db, 'announcements', 'draft_update'), {
        type: 'appUpdate',
        title: 'Draft',
        body: 'Niet zichtbaar',
        status: 'draft',
        isCurrent: false,
        version: 1,
      });
    });

    const ownerDb = authedContext(testEnv, ownerUid, { email_verified: true }).firestore();
    const ownerUnverifiedDb = authedContext(testEnv, ownerUid).firestore();
    const otherDb = authedContext(testEnv, otherUid, { email_verified: true }).firestore();
    const moderatorDb = authedContext(testEnv, 'mod_1', { email_verified: true, email: 'mod_1@example.com' }).firestore();

    await assertSucceeds(getDoc(doc(ownerDb, 'announcements', 'active_update')));
    await assertFails(getDoc(doc(ownerDb, 'announcements', 'draft_update')));
    await assertFails(setDoc(doc(ownerDb, 'announcements', 'hacked'), { title: 'x' }));
    await assertSucceeds(setDoc(doc(moderatorDb, 'announcements', 'mod_update'), {
      type: 'appUpdate',
      title: 'Moderator update',
      body: 'Nieuwe release',
      status: 'active',
      isCurrent: true,
      version: 3,
    }));

    await assertSucceeds(setDoc(doc(ownerDb, 'users', ownerUid, 'announcementReads', 'active_update'), {
      dismissedAt: serverTimestamp(),
      version: 2,
    }));
    await assertFails(setDoc(doc(otherDb, 'users', ownerUid, 'announcementReads', 'active_update'), {
      dismissedAt: serverTimestamp(),
      version: 2,
    }));

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
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(
      setDoc(doc(ownerUnverifiedDb, 'users', ownerUid, 'following', 'target_c'), {
        targetUid: 'target_c',
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(getDoc(doc(ownerUnverifiedDb, 'users', ownerUid, 'following', 'target_a')));

    await assertFails(
      updateDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_b'), {
        createdAt: new Date(),
      }),
    );

    // following create deny: self-follow
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', ownerUid), {
        targetUid: ownerUid,
        createdAt: serverTimestamp(),
      }),
    );

    // following create deny: path/data mismatch
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_d'), {
        targetUid: 'other-target',
        createdAt: serverTimestamp(),
      }),
    );

    // following create deny: extra client key fanUid
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_e'), {
        targetUid: 'target_e',
        createdAt: serverTimestamp(),
        fanUid: ownerUid,
      }),
    );

    // following create deny: extra client key countersApplied
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_f'), {
        targetUid: 'target_f',
        createdAt: serverTimestamp(),
        countersApplied: true,
      }),
    );

    // following create deny: createdAt wrong type
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_g'), {
        targetUid: 'target_g',
        createdAt: 'not-a-timestamp',
      }),
    );

    // following create deny: client-selected timestamp (not request.time)
    await assertFails(
      setDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_h'), {
        targetUid: 'target_h',
        createdAt: new Date(),
      }),
    );

    await assertFails(getDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_a')));

    await assertFails(
      setDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_z'), {
        targetUid: 'target_z',
        createdAt: serverTimestamp(),
      }),
    );

    await assertFails(deleteDoc(doc(otherDb, 'users', ownerUid, 'following', 'target_a')));

    await assertSucceeds(deleteDoc(doc(ownerUnverifiedDb, 'users', ownerUid, 'following', 'target_a')));

    await assertSucceeds(deleteDoc(doc(ownerDb, 'users', ownerUid, 'following', 'target_a')));

    const communityId = 'community_1';
    const topicId = 'topic_1';
    const commentId = 'comment_1';

    await assertSucceeds(
      setDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        text: 'Legit owner comment',
        authorId: ownerUid,
        authorName: 'Owner One',
        createdAt: serverTimestamp(),
      }),
    );

    await assertFails(
      setDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', 'spoofed'), {
        text: 'Spoofed author',
        authorId: otherUid,
        authorName: 'Bad Actor',
        createdAt: serverTimestamp(),
      }),
    );

    await assertSucceeds(
      updateDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        text: 'Updated owner text',
        updatedAt: serverTimestamp(),
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        authorId: otherUid,
      }),
    );

    await assertFails(
      updateDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId), {
        authorName: 'Tampered Name',
      }),
    );

    await assertFails(deleteDoc(doc(otherDb, 'communities', communityId, 'topics', topicId, 'comments', commentId)));

    await assertSucceeds(deleteDoc(doc(ownerDb, 'communities', communityId, 'topics', topicId, 'comments', commentId)));

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
