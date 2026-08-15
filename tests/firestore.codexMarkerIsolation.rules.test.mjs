import fs from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'artes-codex-marker-rules-test';
const rules = await fs.readFile('firestore.rules', 'utf8');
const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules } });

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'spoofed-marker'), {
      uid: 'spoofed-marker', onboardingComplete: true, isDevTestUser: true, devActor: 'codex',
    });
    await setDoc(doc(db, 'codexDevActorRegistry', 'registered-codex'), {
      uid: 'registered-codex', actor: 'codex', productionDenyOnly: true,
    });
  });

  const ownerDb = env.authenticatedContext('owner', { email: 'owner@example.test' }).firestore();
  const spoofedDb = env.authenticatedContext('spoofed-marker', { email: 'spoofed@example.test' }).firestore();

  await assertSucceeds(setDoc(doc(ownerDb, 'users', 'owner', 'following', 'spoofed-marker'), {
    targetUid: 'spoofed-marker', createdAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(spoofedDb, 'users', 'spoofed-marker', 'following', 'owner'), {
    targetUid: 'owner', createdAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(ownerDb, 'threads', 'owner_spoofed'), {
    type: 'dm', participantUids: ['owner', 'spoofed-marker'], dmKey: 'owner_spoofed',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  await assertFails(setDoc(doc(ownerDb, 'users', 'owner', 'following', 'registered-codex'), {
    targetUid: 'registered-codex', createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(ownerDb, 'threads', 'owner_registered_codex'), {
    type: 'dm', participantUids: ['owner', 'registered-codex'], dmKey: 'owner_registered_codex',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  console.log('PASS firestore.codexMarkerIsolation.rules.test');
} finally {
  await env.cleanup();
}
