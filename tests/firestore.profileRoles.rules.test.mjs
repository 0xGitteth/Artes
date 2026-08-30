import fs from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'artes-profile-role-rules-test';

const contextFor = (env, uid) => env.authenticatedContext(uid, {
  email: `${uid}@example.com`,
  email_verified: true,
});

const publicPayload = (uid, roles) => ({
  uid,
  username: uid.replaceAll('_', '').slice(0, 20),
  onboardingComplete: true,
  roles,
});

async function run() {
  const rules = await fs.readFile('firestore.rules', 'utf8');
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });

  try {
    const fanUid = 'fan_only';
    const makerUid = 'maker_multi';
    const mixedUid = 'mixed_roles';

    await assertSucceeds(setDoc(doc(contextFor(env, fanUid).firestore(), 'users', fanUid), {
      roles: ['fan'],
    }));
    await assertSucceeds(setDoc(doc(contextFor(env, makerUid).firestore(), 'users', makerUid), {
      roles: ['photographer', 'artist'],
    }));
    await assertFails(setDoc(doc(contextFor(env, mixedUid).firestore(), 'users', mixedUid), {
      roles: ['fan', 'photographer'],
    }));

    const legacyUid = 'legacy_mixed';
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', legacyUid), {
        onboardingComplete: true,
        roles: ['fan', 'photographer'],
        bio: 'legacy',
      });
    });
    const legacyDb = contextFor(env, legacyUid).firestore();
    await assertSucceeds(updateDoc(doc(legacyDb, 'users', legacyUid), { bio: 'unrelated edit' }));
    await assertFails(updateDoc(doc(legacyDb, 'users', legacyUid), { roles: ['fan', 'artist'] }));
    await assertSucceeds(updateDoc(doc(legacyDb, 'users', legacyUid), { roles: ['photographer'] }));

    for (const [uid, roles] of [
      ['public_fan', ['fan']],
      ['public_makers', ['photographer', 'artist']],
      ['public_mixed', ['fan', 'photographer']],
    ]) {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'users', uid), {
          uid,
          onboardingComplete: true,
          roles,
        });
      });
      const write = setDoc(
        doc(contextFor(env, uid).firestore(), 'publicUsers', uid),
        publicPayload(uid, roles),
      );
      if (uid === 'public_mixed') await assertFails(write);
      else await assertSucceeds(write);
    }

    const legacyPublicUid = 'legacy_public_mixed';
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', legacyPublicUid), {
        uid: legacyPublicUid,
        onboardingComplete: true,
        roles: ['fan', 'photographer'],
      });
      await setDoc(doc(context.firestore(), 'publicUsers', legacyPublicUid), {
        ...publicPayload(legacyPublicUid, ['fan', 'photographer']),
        bio: 'legacy',
      });
    });
    const legacyPublicDb = contextFor(env, legacyPublicUid).firestore();
    await assertSucceeds(updateDoc(doc(legacyPublicDb, 'publicUsers', legacyPublicUid), { bio: 'unrelated edit' }));
    await assertFails(updateDoc(doc(legacyPublicDb, 'publicUsers', legacyPublicUid), { roles: ['fan', 'artist'] }));
    await assertSucceeds(updateDoc(doc(legacyPublicDb, 'publicUsers', legacyPublicUid), { roles: ['photographer'] }));
  } finally {
    await env.cleanup();
  }
}

run().then(() => {
  console.log('firestore.profileRoles.rules.test.mjs passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
