import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  CODEX_DEV_ACTOR,
  buildCodexDevPrivateProfile,
  hasCodexDevClaim,
  isCodexDevToken,
  resolveCodexDevUid,
} from '../functions/codexDevIdentity.js';

test('canonical identity requires the configured uid and both trusted claims', () => {
  const env = { CODEX_DEV_UID: 'isolated-codex' };
  assert.equal(resolveCodexDevUid(env), 'isolated-codex');
  assert.equal(hasCodexDevClaim({ devCodex: true, devActor: CODEX_DEV_ACTOR }), true);
  assert.equal(isCodexDevToken({ uid: 'isolated-codex', devCodex: true, devActor: CODEX_DEV_ACTOR }, env), true);
  assert.equal(isCodexDevToken({ uid: 'ordinary-user', devCodex: true, devActor: CODEX_DEV_ACTOR }, env), false);
  assert.equal(isCodexDevToken({ uid: 'isolated-codex', devCodex: true }, env), false);
});

test('private capability profile passes onboarding gates without being a public payload', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const profile = buildCodexDevPrivateProfile({ uid: 'codex-dev-user', now });
  assert.equal(profile.onboardingComplete, true);
  assert.equal(profile.onboardingStep, 5);
  assert.equal(profile.ageVerified, true);
  assert.equal(profile.isAdult, true);
  assert.equal(profile.devActor, CODEX_DEV_ACTOR);
});

test('ensureCodexDevProfileState deletes rather than writes a publicUsers projection', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const ensureCodexDevProfileState');
  const end = source.indexOf('\n};', start) + 3;
  const implementation = source.slice(start, end);
  assert.match(implementation, /publicUserRef\.delete\(\)/);
  assert.doesNotMatch(implementation, /publicUserRef\.set\(/);
  for (const privateField of ['ageVerified', 'isAdult', 'didit', 'idv', 'email', 'isDevTestUser']) {
    assert.equal(implementation.includes(`publicPayload.${privateField}`), false);
  }
});

test('client routes Codex posts to its isolated collection and supports private self-profile fallback', async () => {
  const source = await fs.readFile(new URL('../src/services/firebaseClient.js', import.meta.url), 'utf8');
  assert.match(source, /isCodexActor \? 'codexDevPosts' : 'posts'/);
  assert.match(source, /user\?\.uid !== userId \|\| !\(await isCodexDevUser\(user\)\)/);
  assert.doesNotMatch(source, /uid === 'codex-dev-user'/);
});
