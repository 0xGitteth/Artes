import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import {
  CODEX_DEV_ACTOR,
  buildCodexDevPrivateProfile,
  hasCodexDevClaim,
  isCodexDevToken,
  isCodexDevForProductionDeny,
  resolveCodexDevUid,
  isCodexDevPrivateProfile,
} from '../functions/codexDevIdentity.js';
import { isCodexDevIdentity as isClientCodexIdentity, sortCodexDevPostsNewestFirst } from '../src/utils/codexDevIdentity.js';
import { findBestReusableAcrossPages, findReusableAcrossPages, isUploadReusableForActor, selectExactReusableUpload, selectNearReusableUpload, shouldCreateProductionReviewCase } from '../functions/uploadReuseIsolation.js';
import { cleanupCodexDevPostTrees } from '../functions/codexTestDataCleanup.js';
import { parseArgs } from '../functions/scripts/reconcileCodexDevIsolation.js';
import { ensureCodexDevActorRegistered, isKnownCodexDevActorUid } from '../functions/codexDevActorRegistry.js';

test('canonical identity requires the configured uid and both trusted claims', () => {
  const env = { CODEX_DEV_UID: 'isolated-codex' };
  assert.equal(resolveCodexDevUid(env), 'isolated-codex');
  assert.equal(hasCodexDevClaim({ devCodex: true, devActor: CODEX_DEV_ACTOR }), true);
  assert.equal(isCodexDevToken({ uid: 'isolated-codex', devCodex: true, devActor: CODEX_DEV_ACTOR }, env), true);
  assert.equal(isCodexDevToken({ uid: 'ordinary-user', devCodex: true, devActor: CODEX_DEV_ACTOR }, env), false);
  assert.equal(isCodexDevToken({ uid: 'isolated-codex', devCodex: true }, env), false);
});

test('production denial is broader than strict Codex privilege identity', () => {
  const env = { CODEX_DEV_UID: 'new-codex' };
  assert.equal(isCodexDevToken({ uid: 'new-codex', devCodex: true, devActor: 'codex' }, env), true);
  assert.equal(isCodexDevToken({ uid: 'new-codex' }, env), false);
  assert.equal(isCodexDevToken({ uid: 'old-codex', devCodex: true, devActor: 'codex' }, env), false);
  assert.equal(isCodexDevForProductionDeny({ uid: 'new-codex' }, env), true);
  assert.equal(isCodexDevForProductionDeny({ uid: 'old-codex', devCodex: true, devActor: 'codex' }, env), true);
  assert.equal(isCodexDevForProductionDeny({ uid: 'ordinary' }, env), false);
});

test('historical actor registry is deny-only and ignores spoofed profile markers', async () => {
  const docs = new Map();
  const db = { collection: (collection) => ({ doc: (uid) => ({
    get: async () => ({ exists: docs.has(`${collection}/${uid}`) }),
    set: async (data) => docs.set(`${collection}/${uid}`, data),
  }) }) };
  const env = { CODEX_DEV_UID: 'current-codex' };
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'current-codex', env }), true);
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'retired-codex', env }), false);
  assert.equal(await ensureCodexDevActorRegistered({ db, uid: 'retired-codex', now: 123 }), true);
  assert.equal(await ensureCodexDevActorRegistered({ db, uid: 'retired-codex', now: 456 }), false);
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'retired-codex', env }), true);
  assert.equal(isCodexDevToken({ uid: 'retired-codex', devCodex: true, devActor: 'codex' }, env), false,
    'registry membership cannot grant strict privilege');
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'spoofed-marker-user', env }), false,
    'private marker data is not consulted');
});

test('persisted retired actor checks precede all DM and claim mutations', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const createDm = section('export const createDmThread', 'export const createDevCodexToken');
  assert.ok(createDm.indexOf('await isKnownCodexDevActorUid({ db, uid: recipientUid })') < createDm.indexOf('canonicalRef.get()'));
  const sendDm = section('export const sendDmMessage', 'export const sendSupportMessage');
  assert.match(sendDm, /threadData\?\.participantUids/);
  assert.match(sendDm, /threadData\?\.participants/);
  const dmDeny = sendDm.indexOf('if (knownCodexParticipant)');
  for (const mutation of ["collection('messages').doc()", 'threadRef.set(', "collection('threadIndex')"]) {
    assert.ok(dmDeny < sendDm.indexOf(mutation), `DM denial precedes ${mutation}`);
  }
  const approve = section('export const moderatorApproveClaimRequest', 'export const getVouchRequests');
  assert.ok(approve.indexOf('await isKnownCodexDevActorUid') < approve.indexOf("requestData?.status === 'approved'"));
  const proof = section('export const verifyClaimProofScreenshot', 'export const onFollowingCreated');
  assert.ok(proof.indexOf('await isKnownCodexDevActorUid') < proof.indexOf('visionClient.textDetection'));
  assert.ok(proof.indexOf('await isKnownCodexDevActorUid') < proof.indexOf("collection('contributors')"));
});

test('moderateImage derives all quarantine decisions from production-deny identity', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const moderate = source.slice(source.indexOf('export const moderateImage'), source.indexOf('export const isModerator'));
  assert.match(moderate, /const isCodexActor = isCodexDevForProductionDeny\(decoded\)/);
  assert.match(moderate, /isCodexActor \? null : await findExactModerationExample/);
  assert.match(moderate, /findExactUpload\([^\n]+\{ isCodexActor \}/);
  assert.match(moderate, /shouldCreateProductionReviewCase\(\{ isCodexActor/);
  assert.match(moderate, /\.\.\.\(isCodexActor \? \{ testActor: CODEX_DEV_ACTOR \} : \{\}\)/);
  assert.doesNotMatch(moderate, /isCodexDevUid\(userId\)/);
});

test('historical private markers never establish destructive identity', () => {
  assert.equal(isCodexDevPrivateProfile('ordinary', { isDevTestUser: true, devActor: 'codex' }, {}), false);
  assert.equal(isCodexDevPrivateProfile('codex-dev-user', {}, {}), true);
});

test('reconciliation CLI accepts explicit identity/storage configuration', () => {
  assert.deepEqual(parseArgs(['--apply', '--uid', 'canonical', '--bucket=test.appspot.com']), {
    apply: true, skipStorage: false, project: null, uid: 'canonical', bucket: 'test.appspot.com',
  });
  assert.equal(parseArgs(['--skip-storage']).skipStorage, true);
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

test('moderation reuse paginates past opposite-scope candidate pages', async () => {
  const doc = (id, testActor = null) => ({ id, data: () => testActor ? { testActor } : {} });
  const productionPages = [Array.from({ length: 25 }, (_, i) => doc(`codex-${i}`, 'codex')), [doc('ordinary')]];
  const foundOrdinary = await findReusableAcrossPages({ isCodexActor: false, fetchPage: async () => productionPages.shift() || [], select: (docs) => docs[0] || null });
  assert.equal(foundOrdinary.id, 'ordinary');
  const codexPages = [Array.from({ length: 25 }, (_, i) => doc(`ordinary-${i}`)), [doc('codex-later', 'codex')]];
  const foundCodex = await findReusableAcrossPages({ isCodexActor: true, fetchPage: async () => codexPages.shift() || [], select: (docs) => docs[0] || null });
  assert.equal(foundCodex.id, 'codex-later');
  const nearPages = [Array.from({ length: 25 }, (_, i) => doc(`codex-near-${i}`, 'codex')), [{ id: 'ordinary-near', data: () => ({ fingerprints: { dhash: '0000' } }) }]];
  const near = await findReusableAcrossPages({
    isCodexActor: false,
    fetchPage: async () => nearPages.shift() || [],
    select: (docs) => selectNearReusableUpload({ uploads: docs.map((entry) => ({ id: entry.id, data: entry.data() })), isCodexActor: false, distanceFor: () => 1, threshold: 5 }),
  });
  assert.equal(near.id, 'ordinary-near');
  assert.equal(await findReusableAcrossPages({ isCodexActor: false, fetchPage: async () => [], select: (docs) => docs[0] }), null);
});

test('near reuse chooses the globally closest same-scope candidate', async () => {
  const doc = (id, distance, testActor = null) => ({ id, distance, data: () => testActor ? { testActor } : {} });
  const run = async (pages, isCodexActor = false) => findBestReusableAcrossPages({
    isCodexActor,
    fetchPage: async () => pages.shift() || [],
    selectBest: (docs) => docs.reduce((best, entry) => (!best || entry.distance < best.distance ? entry : best), null),
  });
  assert.equal((await run([[doc('six', 6)], [doc('one', 1)]])).id, 'one');
  assert.equal((await run([[doc('first-one', 1)], [doc('six', 6)]])).id, 'first-one');
  assert.equal((await run([[doc('first', 2)], [doc('equal', 2)]])).id, 'first');
  assert.equal((await run([[doc('codex', 0, 'codex')], [doc('ordinary', 1)]])).id, 'ordinary');
  assert.equal((await run([[doc('ordinary', 1)], [doc('zero', 0, 'codex')]], true)).id, 'zero');
  assert.equal(await run([[doc('codex-only', 1, 'codex')]]), null);
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
  assert.match(implementation, /ensureCodexDevActorRegistered\(\{ db, uid, now \}\)/);
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
  assert.ok(report.indexOf('isCodexDevForProductionDeny(decoded)') < report.indexOf("db.collection('reviewCases').add"));
  const support = section('export const sendSupportMessage', 'export const reportPost');
  assert.ok(support.indexOf('isCodexDevForProductionDeny(decoded)') < support.indexOf('db.runTransaction'));
  const contributor = section('export const createTemporaryContributor', 'export const createClaimInvite');
  assert.ok(contributor.indexOf('isCodexDevForProductionDeny') < contributor.indexOf('db.runTransaction'));
  const invite = section('export const createClaimInvite', 'export const getClaimInvitePreview');
  assert.ok(invite.indexOf('isCodexDevForProductionDeny') < invite.indexOf('db.runTransaction'));
  const claim = section('export const createClaimRequest', 'export const startEmailClaimProof');
  assert.ok(claim.indexOf('isCodexDevForProductionDeny(decoded)') < claim.indexOf('db.runTransaction'));
  const dmMessage = section('export const sendDmMessage', 'export const sendSupportMessage');
  assert.ok(dmMessage.indexOf('isCodexDevForProductionDeny(decoded)') < dmMessage.indexOf("collection('messages').doc()"));
  assert.ok(dmMessage.indexOf('isKnownCodexDevActorUid({ db, uid })') < dmMessage.indexOf("collection('messages').doc()"));
  const moderationAction = section('export const userModerationAction', 'export const moderatorDecide');
  assert.ok(moderationAction.indexOf('isCodexDevForProductionDeny(decoded)') < moderationAction.indexOf("collection('moderationExamples')"));
});

test('trusted account lifecycle endpoints reject Codex before destructive work', async () => {
  const index = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const reset = index.slice(index.indexOf('export const resetPersonalOnboarding'), index.indexOf('export const createDevCodexToken'));
  assert.ok(reset.indexOf('isCodexDevForProductionDeny') < reset.indexOf('resetPersonalOnboardingAtomically'));
  const lifecycle = await fs.readFile(new URL('../functions/accountLifecycle.js', import.meta.url), 'utf8');
  assert.ok(lifecycle.indexOf('isCodexDevForProductionDeny(decoded)') < lifecycle.indexOf('userRef.delete()'));
});

test('client blocks Codex contributor content requests before production writes', async () => {
  const source = await fs.readFile(new URL('../src/firebase.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const createContributorContentRequest');
  const end = source.indexOf('\n};', start);
  const implementation = source.slice(start, end);
  assert.ok(implementation.indexOf('isCodexDevUser(user)') < implementation.indexOf('addDoc('));
});

test('operational cleanup recursively removes all selected Codex post trees only', async () => {
  const paths = new Set(['codexDevPosts/one', 'codexDevPosts/one/comments/a', 'codexDevPosts/two', 'codexDevPosts/two/likes/codex', 'posts/ordinary']);
  const docs = ['codexDevPosts/one', 'codexDevPosts/two'].map((path) => ({ ref: { path } }));
  const db = { recursiveDelete: async (ref) => [...paths].filter((path) => path === ref.path || path.startsWith(`${ref.path}/`)).forEach((path) => paths.delete(path)) };
  assert.deepEqual(await cleanupCodexDevPostTrees({ db, postDocs: docs, dryRun: true }), { deleted: 0, failed: [] });
  assert.equal(paths.has('codexDevPosts/one'), true);
  assert.deepEqual(await cleanupCodexDevPostTrees({ db, postDocs: docs, dryRun: false }), { deleted: 2, failed: [] });
  assert.deepEqual([...paths], ['posts/ordinary']);
  assert.deepEqual(await cleanupCodexDevPostTrees({ db, postDocs: [], dryRun: false }), { deleted: 0, failed: [] });
});
