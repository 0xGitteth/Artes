import fs from 'node:fs/promises';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

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
    await setDoc(doc(db, 'config', 'moderation'), { moderatorEmails: ['mod@example.test'] });
    await Promise.all(Array.from({ length: 20 }, (_, index) => setDoc(doc(db, 'threads', `support_bulk_${index}`), {
      type: 'support', userUid: `ordinary_${index}`, createdAt: new Date(), updatedAt: new Date(),
    })));
  });

  const ownerDb = env.authenticatedContext('owner', { email: 'owner@example.test' }).firestore();
  const spoofedDb = env.authenticatedContext('spoofed-marker', { email: 'spoofed@example.test' }).firestore();
  const moderatorDb = env.authenticatedContext('moderator-user', { email: 'mod@example.test', email_verified: true }).firestore();
  const registeredCodexModeratorDb = env.authenticatedContext('registered-codex', { email: 'mod@example.test', email_verified: true }).firestore();
  const claimedCodexModeratorDb = env.authenticatedContext('claimed-codex', {
    email: 'mod@example.test', email_verified: true, devCodex: true, devActor: 'codex',
  }).firestore();

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

  const supportSnapshot = await assertSucceeds(getDocs(query(
    collection(moderatorDb, 'threads'),
    where('type', '==', 'support'),
  )));
  if (supportSnapshot.size !== 20) throw new Error(`Expected 20 support threads, got ${supportSnapshot.size}`);
  await assertFails(getDocs(query(collection(registeredCodexModeratorDb, 'threads'), where('type', '==', 'support'))));
  await assertFails(getDocs(query(collection(claimedCodexModeratorDb, 'threads'), where('type', '==', 'support'))));

  console.log('PASS firestore.codexMarkerIsolation.rules.test');
} finally {
  await env.cleanup();
}
