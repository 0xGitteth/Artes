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
import { isCodexDevIdentity as isClientCodexIdentity, sortCodexDevPostsNewestFirst } from '../src/utils/codexDevIdentity.js';
import { isUploadReusableForActor, selectExactReusableUpload, selectNearReusableUpload, shouldCreateProductionReviewCase } from '../functions/uploadReuseIsolation.js';

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

test('client identity trusts authenticated claims regardless of missing or mismatched build UID', () => {
  const trustedClaims = { devCodex: true, devActor: 'codex' };
  assert.equal(isClientCodexIdentity({ claims: trustedClaims, uid: 'non-default-server-uid' }), true);
  assert.equal(isClientCodexIdentity({ claims: trustedClaims, uid: 'different-from-vite-config' }), true);
  assert.equal(isClientCodexIdentity({ claims: {}, uid: 'codex-dev-user' }), false);
});

test('upload-result reuse is isolated in both directions', () => {
  const ordinary = { id: 'ordinary', outcome: 'allowed' };
  const codex = { id: 'codex', testActor: 'codex', outcome: 'forbidden', reviewCaseId: 'test-case' };
  assert.equal(isUploadReusableForActor(codex, false), false);
  assert.equal(isUploadReusableForActor(ordinary, true), false);
  assert.equal(selectExactReusableUpload([codex, ordinary], false), ordinary);
  assert.equal(selectExactReusableUpload([ordinary, codex], true), codex);
  const nearCandidates = [{ id: 'test-near', data: codex }, { id: 'ordinary-near', data: ordinary }];
  assert.equal(selectNearReusableUpload({ uploads: nearCandidates, isCodexActor: false, distanceFor: () => 1, threshold: 5 }).id, 'ordinary-near');
  assert.equal(selectNearReusableUpload({ uploads: nearCandidates, isCodexActor: true, distanceFor: () => 1, threshold: 5 }).id, 'test-near');
});

test('automatic production review cases are suppressed only for Codex', () => {
  const forbiddenReasons = [{ trigger: 'test' }];
  assert.equal(shouldCreateProductionReviewCase({ isCodexActor: true, forbiddenReasons }), false);
  assert.equal(shouldCreateProductionReviewCase({ isCodexActor: false, forbiddenReasons }), true);
  assert.equal(shouldCreateProductionReviewCase({ isCodexActor: false, forbiddenReasons: [] }), false);
});

test('single-field Codex feed results retain newest-first display ordering', () => {
  const ordered = sortCodexDevPostsNewestFirst([
    { id: 'old', createdAt: { seconds: 1 } },
    { id: 'new', createdAt: { toMillis: () => 3000 } },
    { id: 'middle', createdAt: { _seconds: 2 } },
  ]);
  assert.deepEqual(ordered.map(({ id }) => id), ['new', 'middle', 'old']);
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
  assert.match(source, /where\('authorId', '==', user\.uid\)/);
  assert.doesNotMatch(source, /where\('authorId', '==', user\.uid\), orderBy/);
  assert.match(source, /sortCodexDevPostsNewestFirst\(posts\)/);
  assert.match(source, /user\?\.uid !== userId \|\| !\(await isCodexDevUser\(user\)\)/);
  assert.doesNotMatch(source, /uid === 'codex-dev-user'/);
});

test('production side-effect endpoints reject Codex before shared writes', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const report = section('export const reportPost', 'export const requestUploadReviewCase');
  assert.ok(report.indexOf('isCodexDevToken(decoded)') < report.indexOf("db.collection('reviewCases').add"));
  const support = section('export const sendSupportMessage', 'export const reportPost');
  assert.ok(support.indexOf('isCodexDevToken(decoded)') < support.indexOf('db.runTransaction'));
  const contributor = section('export const createTemporaryContributor', 'export const createClaimInvite');
  assert.ok(contributor.indexOf('isCodexDevToken') < contributor.indexOf('db.runTransaction'));
  const invite = section('export const createClaimInvite', 'export const getClaimInvitePreview');
  assert.ok(invite.indexOf('isCodexDevToken') < invite.indexOf('db.runTransaction'));
});
