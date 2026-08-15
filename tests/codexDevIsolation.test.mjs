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
import { createClaimInviteAtomically } from '../functions/claimInviteTransaction.js';
import { runUserModerationActionMutation } from '../functions/userModerationActionIsolation.js';
import { parseArgs } from '../functions/scripts/reconcileCodexDevIsolation.js';

const noModeratorAuth = { getUser: async () => ({ email: null }) };
import {
  acquireCodexDevMergeFence,
  acquireCodexDevLifecycleFence,
  ensureCodexDevActorRegistered,
  isKnownCodexDevActorUid,
  queueCodexDevMergeFenceRenewal,
  readAndValidateCodexDevMergeFence,
  readAndValidateCodexDevLifecycleFence,
  releaseCodexDevMergeFence,
  releaseCodexDevMergeFenceIfUnmutated,
  releaseCodexDevLifecycleFence,
} from '../functions/codexDevActorRegistry.js';

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
    path: `${collection}/${uid}`,
    get: async () => ({ exists: docs.has(`${collection}/${uid}`) }),
    set: async (data) => docs.set(`${collection}/${uid}`, data),
  }) }), runTransaction: async (callback) => callback({
    get: (ref) => ref.get(),
    set: (ref, data) => docs.set(ref.path, data),
  }) };
  const env = { CODEX_DEV_UID: 'current-codex' };
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'current-codex', env }), true);
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'retired-codex', env }), false);
  assert.equal(await ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'retired-codex', now: 123 }), true);
  assert.equal(await ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'retired-codex', now: 456 }), false);
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'retired-codex', env }), true);
  assert.equal(await isKnownCodexDevActorUid({
    db, uid: 'retired-codex', env, transaction: { get: (ref) => ref.get() },
  }), true, 'approval transactions read the same deny-only registry');
  assert.equal(isCodexDevToken({ uid: 'retired-codex', devCodex: true, devActor: 'codex' }, env), false,
    'registry membership cannot grant strict privilege');
  assert.equal(await isKnownCodexDevActorUid({ db, uid: 'spoofed-marker-user', env }), false,
    'private marker data is not consulted');
});

test('merge-wide fence prevents mid-merge registration and releases after successful completion', async () => {
  const docs = new Map();
  const refFor = (path) => ({
    path,
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  });
  const db = {
    collection: (collection) => ({ doc: (uid) => refFor(`${collection}/${uid}`) }),
    runTransaction: async (callback) => callback({
      get: (ref) => ref.get(),
      set: (ref, data, options) => docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) || {} : {}), ...data }),
      delete: (ref) => docs.delete(ref.path),
    }),
  };
  await acquireCodexDevMergeFence({ db, uid: 'merge-user', token: 'merge-token' });
  await assert.rejects(
    ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'merge-user', now: 1100 }),
    (error) => error.code === 'codex-merge-fence-active' && error.retryable === true,
  );
  assert.equal(docs.has('codexDevActorRegistry/merge-user'), false, 'registration cannot appear halfway through merge');
  await releaseCodexDevMergeFence({ db, uid: 'merge-user', token: 'merge-token' });
  assert.equal(await ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'merge-user', now: 1200 }), true);
  assert.equal(docs.has('codexDevActorRegistry/merge-user'), true, 'registration succeeds after merge completion');
});

test('merge fence validation permits all content reads before renewal and merge writes', async () => {
  for (const contentPaths of [
    [],
    ['posts/post-1'],
    ['contributorAliases/alias-1'],
    ['posts/post-1', 'contributorAliases/alias-1'],
  ]) {
    let writeQueued = false;
    const reads = [];
    const writes = [];
    const snapshots = new Map([
      ['codexDevActorRegistry/merge-user', { exists: false }],
      ['codexDevActorMergeFences/merge-user', {
        exists: true,
        data: () => ({ token: 'merge-token', leaseExpiresAtMs: 2000 }),
      }],
      ...contentPaths.map((path) => [path, { exists: true, data: () => ({ path }) }]),
    ]);
    const refFor = (path) => ({ path });
    const db = { collection: (collection) => ({ doc: (uid) => refFor(`${collection}/${uid}`) }) };
    const transaction = {
      get: async (ref) => {
        assert.equal(writeQueued, false, `read-after-write attempted for ${ref.path}`);
        reads.push(ref.path);
        return snapshots.get(ref.path) || { exists: false };
      },
      set: (ref) => {
        writeQueued = true;
        writes.push(ref.path);
      },
      update: (ref) => {
        writeQueued = true;
        writes.push(ref.path);
      },
    };

    const validation = await readAndValidateCodexDevMergeFence({
      db, uid: 'merge-user', token: 'merge-token', transaction, nowMs: 1000,
    });
    for (const path of contentPaths) await transaction.get(refFor(path));
    queueCodexDevMergeFenceRenewal({ transaction, validation });
    for (const path of contentPaths) transaction.update(refFor(path));

    assert.deepEqual(reads.slice(0, 2), [
      'codexDevActorRegistry/merge-user',
      'codexDevActorMergeFences/merge-user',
    ]);
    assert.deepEqual(reads.slice(2), contentPaths);
    assert.equal(writes[0], 'codexDevActorMergeFences/merge-user', 'fence renewal is the first queued write');
    assert.deepEqual(writes.slice(1), contentPaths);
  }
});

test('merge fence releases only before the first committed production mutation', async () => {
  const nowMs = Date.now();
  const docs = new Map();
  const refFor = (path) => ({ path, get: async () => ({
    exists: docs.has(path),
    data: () => docs.get(path),
  }) });
  const db = {
    collection: (collection) => ({ doc: (uid) => refFor(`${collection}/${uid}`) }),
    runTransaction: async (callback) => callback({
      get: (ref) => ref.get(),
      set: (ref, data, options) => docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) || {} : {}), ...data }),
      delete: (ref) => docs.delete(ref.path),
    }),
  };

  await acquireCodexDevMergeFence({ db, uid: 'pre-mutation', token: 'token-a', nowMs });
  assert.equal(await releaseCodexDevMergeFenceIfUnmutated({ db, uid: 'pre-mutation', token: 'wrong' }), false);
  assert.equal(await releaseCodexDevMergeFenceIfUnmutated({ db, uid: 'pre-mutation', token: 'token-a' }), true);
  assert.equal(docs.has('codexDevActorMergeFences/pre-mutation'), false, 'safe retry is immediate before mutation');

  await acquireCodexDevMergeFence({ db, uid: 'partial-merge', token: 'token-b', nowMs });
  await db.runTransaction(async (transaction) => {
    const validation = await readAndValidateCodexDevMergeFence({
      db, uid: 'partial-merge', token: 'token-b', transaction, nowMs: nowMs + 1,
    });
    queueCodexDevMergeFenceRenewal({ transaction, validation, mutationCommitted: true });
  });
  assert.equal(await releaseCodexDevMergeFenceIfUnmutated({ db, uid: 'partial-merge', token: 'token-b' }), false);
  assert.equal(docs.get('codexDevActorMergeFences/partial-merge')?.mutationCommitted, true);
  await assert.rejects(
    ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'partial-merge', now: 1200 }),
    (error) => error.code === 'codex-merge-fence-recovery-required' && error.retryable === false,
  );
  await releaseCodexDevMergeFence({ db, uid: 'partial-merge', token: 'token-b' });
  assert.equal(docs.has('codexDevActorMergeFences/partial-merge'), false, 'full-success release remains token-safe');
});

test('account lifecycle fence blocks registration through Auth deletion and releases token-safely', async () => {
  const nowMs = Date.now();
  const docs = new Map();
  const refFor = (path) => ({ path, get: async () => ({
    exists: docs.has(path), data: () => docs.get(path),
  }) });
  const db = {
    collection: (collection) => ({ doc: (uid) => refFor(`${collection}/${uid}`) }),
    runTransaction: async (callback) => callback({
      get: (ref) => ref.get(),
      set: (ref, data, options) => docs.set(ref.path, { ...(options?.merge ? docs.get(ref.path) || {} : {}), ...data }),
      delete: (ref) => docs.delete(ref.path),
    }),
  };

  await acquireCodexDevLifecycleFence({ db, uid: 'deleting-user', token: 'delete-token', nowMs });
  assert.equal(docs.get('codexDevActorLifecycleFences/deleting-user')?.operation, 'deleteOnboardingAccount');
  await assert.rejects(
    ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'deleting-user' }),
    (error) => error.code === 'codex-lifecycle-fence-active' && error.retryable === true,
  );
  await db.runTransaction((transaction) => readAndValidateCodexDevLifecycleFence({
    db, uid: 'deleting-user', token: 'delete-token', transaction, nowMs: nowMs + 1,
  }));
  assert.equal(await releaseCodexDevLifecycleFence({ db, uid: 'deleting-user', token: 'wrong-token' }), false);
  assert.equal(await releaseCodexDevLifecycleFence({ db, uid: 'deleting-user', token: 'delete-token' }), true);
  assert.equal(await ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'deleting-user' }), true,
    'registration resumes only after the destructive lifecycle operation ends');

  docs.set('codexDevActorLifecycleFences/expired-user', {
    uid: 'expired-user', operation: 'deleteOnboardingAccount', token: 'expired', leaseExpiresAtMs: nowMs - 1,
  });
  assert.equal(await ensureCodexDevActorRegistered({ db, auth: noModeratorAuth, uid: 'expired-user' }), true,
    'an expired lifecycle fence cannot block recovery forever');
});

test('persisted retired actor checks precede all DM and claim mutations', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const createDm = section('export const createDmThread', 'export const createDevCodexToken');
  assert.ok(createDm.indexOf('await isKnownCodexDevActorUid({ db, uid: decoded.uid })') < createDm.indexOf('canonicalRef.get()'));
  assert.ok(createDm.indexOf('await isKnownCodexDevActorUid({ db, uid: recipientUid })') < createDm.indexOf('canonicalRef.get()'));
  const dmTransaction = createDm.indexOf('db.runTransaction');
  assert.ok(dmTransaction < createDm.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })'));
  assert.ok(dmTransaction < createDm.indexOf('transaction.create(canonicalRef'));
  assert.ok(createDm.indexOf('transaction.create(canonicalRef') < createDm.indexOf('transaction.set(senderIndexRef'));
  const sendDm = section('export const sendDmMessage', 'export const sendSupportMessage');
  assert.match(sendDm, /const codexScanParticipants = \[\.\.\.new Set/);
  assert.match(sendDm, /const authorizedParticipants = \(participantUids \|\| legacyParticipants\)/);
  assert.match(sendDm, /codexScanParticipants\.map/);
  assert.match(sendDm, /!authorizedParticipants\.includes\(decoded\.uid\)/);
  assert.doesNotMatch(sendDm, /!codexScanParticipants\.includes\(decoded\.uid\)/);
  assert.match(sendDm, /freshAuthorizedParticipants\.forEach\(\(uid\) =>/);
  assert.match(sendDm, /const freshCodexScanParticipants = \[\.\.\.new Set/);
  assert.match(sendDm, /const freshAuthorizedParticipants = \(freshParticipantUids \|\| freshLegacyParticipants\)/);
  assert.ok(sendDm.indexOf('transaction.get(threadRef)') < sendDm.indexOf('transaction.set(messageRef'));
  assert.ok(sendDm.indexOf('isKnownCodexDevActorUid({ db, uid, transaction })') < sendDm.indexOf('transaction.set(messageRef'));
  assert.doesNotMatch(sendDm, /threadRef\.set\(/, 'a deleted thread cannot be recreated by message sending');
  const dmDeny = sendDm.indexOf('if (knownCodexParticipant)');
  for (const mutation of ["collection('messages').doc()", 'transaction.update(threadRef', "collection('threadIndex')"]) {
    assert.ok(dmDeny < sendDm.indexOf(mutation), `DM denial precedes ${mutation}`);
  }
  const approve = section('export const moderatorApproveClaimRequest', 'export const getVouchRequests');
  assert.ok(approve.indexOf('await isKnownCodexDevActorUid') < approve.indexOf("requestData?.status === 'approved'"));
  const proof = section('export const verifyClaimProofScreenshot', 'export const onFollowingCreated');
  assert.ok(proof.indexOf('await isKnownCodexDevActorUid') < proof.indexOf('visionClient.textDetection'));
  assert.ok(proof.indexOf('await isKnownCodexDevActorUid') < proof.indexOf("collection('contributors')"));
});

test('every automatic claim approval path checks persisted claimant registry membership first', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const cases = [
    ['export const verifyEmailClaimProof', 'export const verifyWebsiteClaimProof'],
    ['export const verifyWebsiteClaimProof', 'export const mergeContributors'],
    ['export const submitClaimVouch', 'export const expireClaimRequests'],
  ];
  for (const [start, end] of cases) {
    const implementation = section(start, end);
    const registryGuard = implementation.indexOf('await isKnownCodexDevActorUid');
    assert.notEqual(registryGuard, -1, `${start} checks persisted claimant registry`);
    assert.ok(registryGuard < implementation.indexOf('transaction.update'), `${start} denies before transaction writes`);
    assert.ok(registryGuard < implementation.indexOf("status: 'approved'"), `${start} denies before approval write`);
    assert.ok(registryGuard < implementation.indexOf('claimedByUid:'), `${start} denies before ownership write`);
  }
});

test('website proof failure persistence cannot recreate or mutate a quarantined claim', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const verifyWebsiteClaimProof');
  const end = source.indexOf('export const mergeContributors', start);
  const implementation = source.slice(start, end);
  const helperStart = implementation.indexOf('const persistWebsiteProofFailure');
  const fetchStart = implementation.indexOf('const url = buildWebsiteClaimUrl', helperStart);
  const helper = implementation.slice(helperStart, fetchStart);

  assert.ok(helper.indexOf('transaction.get(requestRef)') < helper.indexOf('if (!freshRequestSnap.exists) return false'));
  assert.ok(helper.indexOf('freshData?.requestedByUid !== request.auth.uid') < helper.indexOf('transaction.update(requestRef, updates)'));
  assert.ok(helper.indexOf("freshData?.status !== 'pending'") < helper.indexOf('transaction.update(requestRef, updates)'));
  assert.ok(helper.indexOf('isKnownCodexDevActorUid({ db, uid: freshData.requestedByUid, transaction })')
    < helper.indexOf('transaction.update(requestRef, updates)'));

  const failureBranches = implementation.slice(fetchStart, implementation.indexOf('let resolvedStatus', fetchStart));
  assert.equal((failureBranches.match(/persistWebsiteProofFailure\(\{/g) || []).length, 2,
    'network and invalid-content failures use authoritative persistence');
  assert.doesNotMatch(failureBranches, /requestRef\.set\(/,
    'post-fetch failure handling never recreates a missing claim request');
  assert.match(failureBranches, /'proofData\.website\.lastCheckedAt'/);
  assert.match(failureBranches, /'proofData\.website\.lastCheckResult'/);
  assert.match(failureBranches, /'proofData\.websiteVerified'/);
  assert.doesNotMatch(failureBranches, /proofData:\s*\{/,
    'website token configuration and unrelated proof siblings are not replaced');
});

test('email proof failures update only an existing ordinary pending claim transactionally', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const verifyEmailClaimProof');
  const end = source.indexOf('export const verifyWebsiteClaimProof', start);
  const implementation = source.slice(start, end);
  const helperStart = implementation.indexOf('const persistEmailProofFailure');
  const failureStart = implementation.indexOf('if (!expiresAtMs', helperStart);
  const helper = implementation.slice(helperStart, failureStart);

  assert.ok(helper.indexOf('transaction.get(requestRef)') < helper.indexOf('if (!freshRequestSnap.exists) return false'));
  assert.ok(helper.indexOf('freshData?.requestedByUid !== request.auth.uid') < helper.indexOf('transaction.update(requestRef, updates)'));
  assert.ok(helper.indexOf("freshData?.status !== 'pending'") < helper.indexOf('transaction.update(requestRef, updates)'));
  assert.ok(helper.indexOf('freshEmailProof.tokenHash !== emailProof.tokenHash') < helper.indexOf('transaction.update(requestRef, updates)'));
  assert.ok(helper.indexOf('isKnownCodexDevActorUid({ db, uid: freshData.requestedByUid, transaction })')
    < helper.indexOf('transaction.update(requestRef, updates)'));

  const failureBranches = implementation.slice(failureStart, implementation.indexOf('let resolvedStatus', failureStart));
  assert.equal((failureBranches.match(/persistEmailProofFailure\(\{/g) || []).length, 2,
    'expired and invalid token failures use guarded persistence');
  assert.doesNotMatch(failureBranches, /requestRef\.set\(/,
    'email failure handling cannot recreate a deleted claim request');
  assert.match(failureBranches, /'proofData\.email\.lastCheckedAt'/);
  assert.match(failureBranches, /'proofData\.email\.lastCheckResult'/);
  assert.match(failureBranches, /'proofData\.emailVerified'/);
  assert.doesNotMatch(failureBranches, /proofData:\s*\{/,
    'email token configuration and unrelated proof siblings are not replaced');
});

test('merge content transactions finish reads before queueing fence renewal', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const postStart = source.indexOf('const updatePostsForContributorMerge');
  const aliasStart = source.indexOf('const moveContributorAliases', postStart);
  const mergeStart = source.indexOf('const mergeContributorsInternal', aliasStart);
  for (const implementation of [source.slice(postStart, aliasStart), source.slice(aliasStart, mergeStart)]) {
    const contentRead = implementation.indexOf('await transaction.get(docSnap.ref)');
    const renewal = implementation.indexOf('queueCodexDevMergeFenceRenewal');
    const contentWrite = implementation.indexOf('transaction.update(ref');
    assert.ok(contentRead < renewal, 'content reads precede fence renewal');
    assert.ok(renewal < contentWrite, 'fence renewal precedes merge content writes');
  }
});

test('publishNow and repairPublished recheck historical registry in the authoritative mutation transaction', async () => {
  const [source, helper] = await Promise.all([
    fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../functions/userModerationActionIsolation.js', import.meta.url), 'utf8'),
  ]);
  const start = source.indexOf('export const userModerationAction');
  const end = source.indexOf('export const moderatorDecide', start);
  const implementation = source.slice(start, end);

  assert.match(implementation, /await runUserModerationActionMutation\(\{[\s\S]*uid: userId,[\s\S]*isKnownCodexDevActorUid,[\s\S]*mutate: async \(transaction\) =>/);
  assert.match(implementation, /collection\(isCodexDevUid\(userId\) \? 'codexDevPosts' : 'posts'\)/,
    'defense in depth keeps canonical Codex publication out of production posts');
  assert.match(implementation, /transaction\.create\(postRef/);
  assert.match(implementation, /transaction\.set\(\s*uploadRef/);

  const transactionStart = helper.indexOf('db.runTransaction(async (transaction) =>');
  const registryGuard = helper.indexOf('isKnownCodexDevActorUid({ db, uid, transaction })', transactionStart);
  const mutationCallback = helper.indexOf('return mutate(transaction)', registryGuard);
  assert.ok(transactionStart !== -1 && transactionStart < registryGuard,
    'shared helper reads registry from the transaction snapshot');
  assert.ok(registryGuard < mutationCallback,
    'registry denial is evaluated before the action mutation callback can queue writes');
});

test('moderateImage derives all quarantine decisions from production-deny identity', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const moderate = source.slice(source.indexOf('export const moderateImage'), source.indexOf('export const isModerator'));
  assert.match(moderate, /const isCodexActor = isCodexDevForProductionDeny\(decoded\)\s*\|\| await isKnownCodexDevActorUid/);
  assert.match(moderate, /isCodexActor \? null : await findExactModerationExample/);
  assert.match(moderate, /findExactUpload\([^\n]+\{ isCodexActor \}/);
  assert.match(moderate, /shouldCreateProductionReviewCase\(\{ isCodexActor/);
  assert.match(moderate, /\.\.\.\(isCodexActor \? \{ testActor: CODEX_DEV_ACTOR \} : \{\}\)/);
  assert.doesNotMatch(moderate, /isCodexDevUid\(userId\)/);
});

test('historical registry blocks claim actors, screenshot races, and production publication paths', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  for (const [start, end] of [
    ['export const createClaimRequest', 'export const startEmailClaimProof'],
    ['export const submitClaimVouch', 'export const expireClaimRequests'],
    ['export const userModerationAction', 'export const moderatorDecide'],
  ]) {
    const implementation = section(start, end);
    assert.ok(implementation.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid })') < implementation.indexOf('db.runTransaction'), `${start} denies historical caller before shared writes`);
  }
  const screenshot = section('export const verifyClaimProofScreenshot', 'export const onFollowingCreated');
  const transactionStart = screenshot.indexOf('db.runTransaction');
  const transactionalGuard = screenshot.indexOf('isKnownCodexDevActorUid({ db, uid: data?.requestedByUid, transaction })');
  assert.ok(transactionStart < transactionalGuard);
  assert.ok(transactionalGuard < screenshot.indexOf('transaction.set(requestRef'));
  assert.ok(transactionalGuard < screenshot.indexOf('transaction.update(contributorRef'));
  assert.match(section('export const userModerationAction', 'export const moderatorDecide'), /collection\(isCodexDevUid\(userId\) \? 'codexDevPosts' : 'posts'\)/);

  const contributor = section('export const createTemporaryContributor', 'export const createClaimInvite');
  const contributorTransaction = contributor.indexOf('db.runTransaction');
  const contributorGuard = contributor.indexOf('isKnownCodexDevActorUid({ db, uid: request.auth.uid, transaction })');
  assert.ok(contributorTransaction < contributorGuard && contributorGuard < contributor.indexOf('transaction.get(alias.ref)'));
  assert.ok(contributor.indexOf('transaction.get(alias.ref)') < contributor.indexOf('transaction.set(contributorRef'));

  const claim = section('export const createClaimRequest', 'export const startEmailClaimProof');
  const claimTransaction = claim.indexOf('db.runTransaction');
  const claimGuard = claim.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })');
  assert.ok(claimTransaction < claimGuard && claimGuard < claim.indexOf('transaction.get(inviteRef)'));
  assert.ok(claimGuard < claim.indexOf('transaction.set(requestRef'));
  assert.ok(claimGuard < claim.indexOf('transaction.update(inviteRef'));

  const vouch = section('export const submitClaimVouch', 'export const expireClaimRequests');
  const vouchTransaction = vouch.indexOf('db.runTransaction');
  const voterGuard = vouch.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })');
  assert.ok(vouchTransaction < voterGuard && voterGuard < vouch.indexOf('transaction.get(requestRef)'));
  assert.ok(voterGuard < vouch.indexOf('transaction.set(voteRef'));
});

test('Firestore production deny helper is registry-backed but grants no Codex privileges', async () => {
  const rules = await fs.readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /function isKnownCodexProductionDeniedUid\(uid\)[^]*codexDevActorRegistry/);
  assert.doesNotMatch(rules, /allow [^;]+: if isKnownCodexProductionDenied\(\)/);
  assert.equal((rules.match(/!isCodexDev\(\)/g) || []).length, 0);
  for (const surface of ['/publicUsers/', '/profiles/', '/posts/', '/following/', '/threads/', '/contributors/', '/claimRequests/']) {
    assert.ok(rules.includes(surface), `${surface} remains covered by production rules`);
  }
});

test('remaining reviewed production callables deny historical registry actors before writes', async () => {
  const index = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const support = await fs.readFile(new URL('../functions/supportChat.js', import.meta.url), 'utf8');
  const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  for (const [start, end, firstWrite] of [
    ['export const reportPost', 'export const requestUploadReviewCase', 'transaction.create(reviewRef'],
    ['export const requestUploadReviewCase', 'export const getModerationExamplesForCase', "collection('reviewCases')"],
    ['export const createTemporaryContributor', 'export const createClaimInvite', 'db.runTransaction'],
    ['export const createClaimInvite', 'export const getClaimInvitePreview', 'createClaimInviteAtomically'],
  ]) {
    const implementation = section(index, start, end);
    assert.ok(implementation.indexOf('isKnownCodexDevActorUid') < implementation.indexOf(firstWrite), `${start} denies before production writes`);
  }
  const ensureSupport = section(support, 'export const ensureSupportThread', 'export const ensureModerationThread');
  assert.ok(ensureSupport.indexOf('isKnownCodexDevActorUid') < ensureSupport.indexOf('threadRef.get()'));
});

test('moderation and moderator claim writes serialize registry reads with production mutations', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const moderate = source.slice(source.indexOf('export const moderateImage'), source.indexOf('export const isModerator'));
  assert.match(moderate, /runTransaction[^]*isKnownCodexDevActorUid\(\{ db, uid: userId, transaction \}\)[^]*transaction\.create\(reviewRef/);
  assert.match(moderate, /runTransaction[^]*!isCodexActor && await isKnownCodexDevActorUid[^]*transaction\.create\(uploadRef/);
  const approve = source.slice(source.indexOf('export const moderatorApproveClaimRequest'), source.indexOf('export const getVouchRequests'));
  assert.match(approve, /denyActorUid: requestedByUid/);
  assert.match(approve, /freshRequestSnap[^]*isKnownCodexDevActorUid\(\{ db, uid: freshRequestedByUid, transaction \}\)/);
  assert.match(source, /assertMergeActorAllowed[^]*updatePostsForContributorMerge[^]*moveContributorAliases/);
});

test('reviewed actor-owned mutations recheck historical registry before writes', async () => {
  const index = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const lifecycle = await fs.readFile(new URL('../functions/accountLifecycle.js', import.meta.url), 'utf8');
  const unpublish = await fs.readFile(new URL('../functions/publicProfileUnpublish.js', import.meta.url), 'utf8');
  const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const support = section(index, 'export const sendSupportMessage', 'export const reportPost');
  assert.ok(support.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })') < support.indexOf('transaction.set(messageRef'));
  for (const [start, end] of [
    ['export const startEmailClaimProof', 'export const startWebsiteClaimProof'],
    ['export const startWebsiteClaimProof', 'export const verifyEmailClaimProof'],
  ]) {
    const proof = section(index, start, end);
    assert.ok(proof.indexOf('isKnownCodexDevActorUid({ db, uid: request.auth.uid })') < proof.indexOf('transaction.set(requestRef'));
    assert.ok(proof.indexOf('requestedByUid !== request.auth.uid') < proof.indexOf('transaction.set(requestRef'));
  }
  assert.match(section(index, 'export const resetPersonalOnboarding', 'export const createDevCodexToken'), /isKnownCodexDevActorUid\(\{ db, uid \}\)/);
  assert.ok(lifecycle.indexOf('isKnownCodexDevActorUid({ db, uid, transaction })') < lifecycle.indexOf('transaction.delete(userRef)'));
  assert.ok(unpublish.indexOf('isKnownCodexDevActorUid({ db, uid, transaction })') < unpublish.indexOf('transaction.set(privateRef'));
});

test('latest historical-registry races are guarded at their final authoritative mutations', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const moderate = section('export const moderateImage', 'export const isModerator');
  const suppression = moderate.indexOf('uploadSuppressedByHistoricalRegistry = true');
  const previewDelete = moderate.indexOf("file(persistedPreview.storagePath).delete({ ignoreNotFound: true })");
  assert.ok(suppression < previewDelete, 'only authoritative historical suppression triggers preview cleanup');
  assert.match(moderate, /previewCreatedByRequest && persistedPreview\?\.storagePath/);

  const report = section('export const reportPost', 'export const requestUploadReviewCase');
  assert.ok(report.indexOf('db.runTransaction') < report.indexOf('transaction.create(reviewRef'));
  assert.ok(report.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })')
    < report.indexOf('transaction.create(reviewRef'));

  const uploadReview = section('export const requestUploadReviewCase', 'export const getModerationExamplesForCase');
  const finalTransaction = uploadReview.lastIndexOf('await db.runTransaction');
  const registryGuard = uploadReview.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })', finalTransaction);
  const freshUploadRead = uploadReview.indexOf('transaction.get(uploadRef)', finalTransaction);
  const candidateRead = uploadReview.indexOf('transaction.get(candidateReviewRef)', finalTransaction);
  const caseCreate = uploadReview.indexOf('transaction.create(reviewRef', finalTransaction);
  const uploadLink = uploadReview.indexOf('transaction.set(uploadRef', finalTransaction);
  assert.ok(finalTransaction < registryGuard && registryGuard < freshUploadRead);
  assert.ok(freshUploadRead < candidateRead && candidateRead < caseCreate, 'all reuse reads precede new-case writes');
  assert.ok(caseCreate < uploadLink, 'case creation and upload linkage share the authoritative transaction');
  assert.doesNotMatch(uploadReview, /await uploadRef\.set\(/);

  const vouches = section('export const getVouchRequests', 'export const cleanupCodexTestData');
  assert.ok(vouches.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid })')
    < vouches.indexOf("collection('claimRequests')"));

  const archive = section('export const archiveDmThread', 'export const dismissSupportThread');
  assert.ok(archive.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })')
    < archive.indexOf('transaction.set(indexRef'));
  assert.match(archive, /transaction\.get\(threadRef\)/);
  assert.doesNotMatch(archive, /indexRef\.set\(/, 'archive cannot recreate an index outside the transaction');

  const reset = section('export const resetSupportThread', 'export const sendDmMessage');
  assert.ok(reset.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })')
    < reset.indexOf('transaction.set(introRef'));
  assert.ok(reset.indexOf('transaction.get(threadRef)') < reset.indexOf('transaction.update(threadRef'));
  assert.doesNotMatch(reset, /threadRef\.set\(/, 'support reset cannot recreate a deleted thread');
  assert.doesNotMatch(reset, /messagesRef\.add\(/, 'intro creation is serialized with thread existence');
});

test('historical private markers never establish destructive identity', () => {
  assert.equal(isCodexDevPrivateProfile('ordinary', { isDevTestUser: true, devActor: 'codex' }, {}), false);
  assert.equal(isCodexDevPrivateProfile('codex-dev-user', {}, {}), true);
});

test('reconciliation CLI accepts explicit identity/storage configuration', () => {
  assert.deepEqual(parseArgs(['--apply', '--uid', 'canonical', '--bucket=test.appspot.com']), {
    apply: true, skipStorage: false, project: null, uid: 'canonical', bucket: 'test.appspot.com',
    legacyManagedProfileIds: [], legacyPostIds: [],
  });
  assert.deepEqual(parseArgs([
    '--apply', '--uid=canonical', '--skip-storage',
    '--legacy-managed-profile-ids=old-agency,old-company', '--legacy-post-ids', 'old-post-1,old-post-2',
  ]), {
    apply: true, skipStorage: true, project: null, uid: 'canonical', bucket: null,
    legacyManagedProfileIds: ['old-agency', 'old-company'], legacyPostIds: ['old-post-1', 'old-post-2'],
  });
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
  assert.match(implementation, /ensureCodexDevActorRegistered\(\{ db, auth: admin\.auth\(\), uid, now \}\)/);
  assert.ok(implementation.indexOf('ensureCodexDevActorRegistered') < implementation.indexOf('userRef.get()'));
  assert.ok(implementation.indexOf('ensureCodexDevActorRegistered') < implementation.indexOf('userRef.set('));
  assert.ok(implementation.indexOf('ensureCodexDevActorRegistered') < implementation.indexOf('publicUserRef.delete()'));
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
  assert.ok(report.indexOf('isCodexDevForProductionDeny(decoded)') < report.indexOf('transaction.create(reviewRef'));
  assert.ok(report.indexOf('isKnownCodexDevActorUid({ db, uid: decoded.uid, transaction })')
    < report.indexOf('transaction.create(reviewRef'));
  const support = section('export const sendSupportMessage', 'export const reportPost');
  assert.ok(support.indexOf('isCodexDevForProductionDeny(decoded)') < support.indexOf('db.runTransaction'));
  const contributor = section('export const createTemporaryContributor', 'export const createClaimInvite');
  assert.ok(contributor.indexOf('isCodexDevForProductionDeny') < contributor.indexOf('db.runTransaction'));
  const invite = section('export const createClaimInvite', 'export const getClaimInvitePreview');
  assert.ok(invite.indexOf('isCodexDevForProductionDeny') < invite.indexOf('createClaimInviteAtomically'));
  const claim = section('export const createClaimRequest', 'export const startEmailClaimProof');
  assert.ok(claim.indexOf('isCodexDevForProductionDeny(decoded)') < claim.indexOf('db.runTransaction'));
  const dmMessage = section('export const sendDmMessage', 'export const sendSupportMessage');
  assert.ok(dmMessage.indexOf('isCodexDevForProductionDeny(decoded)') < dmMessage.indexOf("collection('messages').doc()"));
  assert.ok(dmMessage.indexOf('isKnownCodexDevActorUid({ db, uid })') < dmMessage.indexOf("collection('messages').doc()"));
  const moderationAction = section('export const userModerationAction', 'export const moderatorDecide');
  assert.ok(moderationAction.indexOf('isCodexDevForProductionDeny(decoded)') < moderationAction.indexOf("collection('moderationExamples')"));
});

test('claim invite transaction rechecks registry before all invite-side writes', async () => {
  const stores = {
    codexDevActorRegistry: new Map(),
    claimInviteRateLimits: new Map(),
    claimInvites: new Map(),
  };
  const operations = [];
  const ref = (collection, id) => ({ collection, id });
  const db = {
    collection: (collection) => ({ doc: (id) => ref(collection, id) }),
    runTransaction: async (callback) => {
      // Models registration committing after the endpoint preflight and before
      // the authoritative transaction begins.
      stores.codexDevActorRegistry.set('racing-user', { productionDenyOnly: true });
      const pending = [];
      const transaction = {
        get: async (documentRef) => {
          assert.equal(pending.length, 0, 'transaction reads must precede writes');
          operations.push(`read:${documentRef.collection}`);
          const value = stores[documentRef.collection].get(documentRef.id);
          return { exists: value !== undefined, data: () => value };
        },
        set: (documentRef, data) => {
          operations.push(`write:${documentRef.collection}`);
          pending.push({ documentRef, data });
        },
      };
      const result = await callback(transaction);
      pending.forEach(({ documentRef, data }) => stores[documentRef.collection].set(documentRef.id, data));
      return result;
    },
  };
  const run = (uid, token = uid) => createClaimInviteAtomically({
    db,
    uid,
    rateRef: ref('claimInviteRateLimits', uid),
    inviteRef: ref('claimInvites', token),
    inviteData: { createdByUid: uid },
    todayKey: '2026-08-15',
    rateLimitPerDay: 2,
    serverTimestamp: () => 'timestamp',
    createError: (code, message) => Object.assign(new Error(message), { code }),
  });

  await assert.rejects(() => run('racing-user'), { code: 'permission-denied' });
  assert.equal(stores.claimInvites.size, 0, 'registration race creates no invite');
  assert.equal(stores.claimInviteRateLimits.size, 0, 'registration race consumes no rate limit');
  assert.deepEqual(operations, ['read:claimInviteRateLimits', 'read:codexDevActorRegistry']);

  stores.codexDevActorRegistry.delete('racing-user');
  await run('ordinary-user', 'ordinary-one');
  assert.equal(stores.claimInvites.has('ordinary-one'), true, 'ordinary invite creation is preserved');
  assert.equal(stores.claimInviteRateLimits.get('ordinary-user').count, 1);
  await run('ordinary-user', 'ordinary-two');
  await assert.rejects(() => run('ordinary-user', 'ordinary-three'), { code: 'resource-exhausted' });
  assert.equal(stores.claimInvites.has('ordinary-three'), false, 'rate limiting remains atomic');
  assert.equal(stores.claimInviteRateLimits.get('ordinary-user').count, 2);
});

test('trusted account lifecycle endpoints reject Codex before destructive work', async () => {
  const index = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const reset = index.slice(index.indexOf('export const resetPersonalOnboarding'), index.indexOf('export const createDevCodexToken'));
  assert.ok(reset.indexOf('isCodexDevForProductionDeny') < reset.indexOf('resetPersonalOnboardingAtomically'));
  const lifecycle = await fs.readFile(new URL('../functions/accountLifecycle.js', import.meta.url), 'utf8');
  assert.ok(lifecycle.indexOf('isCodexDevForProductionDeny(decoded)') < lifecycle.indexOf('transaction.delete(userRef)'));
  assert.ok(lifecycle.indexOf('acquireCodexDevLifecycleFence') < lifecycle.indexOf('transaction.delete(userRef)'));
  assert.ok(lifecycle.indexOf('readAndValidateCodexDevLifecycleFence') < lifecycle.indexOf('transaction.delete(userRef)'));
  assert.ok(lifecycle.indexOf('transaction.delete(userRef)') < lifecycle.indexOf('auth.deleteUser(uid)'));
  assert.ok(lifecycle.indexOf('auth.deleteUser(uid)') < lifecycle.indexOf('await releaseCodexDevLifecycleFence'));
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


test('userModerationAction guarded mutation retries into quarantine with zero committed writes', async () => {
  const shapes = new Map([
    ['correction', ['uploads/u', 'moderationExamples/e']],
    ['prompt', ['uploads/u', 'threads/t/messages/m', 'threads/t']],
    ['discard', ['uploads/u', 'reviewCases/r', 'threads/t/messages/m', 'threads/t']],
    ['saveDraft', ['users/u/drafts/d', 'uploads/u', 'threads/t/messages/m', 'threads/t']],
    ['dismiss', ['threads/t/messages/m', 'threads/t']],
    ['publish', ['posts/u', 'uploads/u', 'threads/t/messages/m', 'threads/t']],
  ]);

  for (const [name, paths] of shapes) {
    let denied = false;
    const committed = [];
    let attempts = 0;
    const makeTransaction = (queued) => ({
      set: (ref) => queued.push(ref.path),
      create: (ref) => queued.push(ref.path),
      update: (ref) => queued.push(ref.path),
    });
    const db = {
      runTransaction: async (callback) => {
        attempts += 1;
        const firstQueued = [];
        await callback(makeTransaction(firstQueued));
        // Simulate Firestore detecting a concurrent registry write at commit:
        // first-attempt writes are discarded and the callback is retried.
        denied = true;
        attempts += 1;
        const retryQueued = [];
        await callback(makeTransaction(retryQueued));
        committed.push(...retryQueued);
      },
    };
    const isKnown = async () => denied;
    await assert.rejects(
      runUserModerationActionMutation({
        db,
        uid: 'ordinary-becoming-codex',
        isKnownCodexDevActorUid: isKnown,
        mutate: async (transaction) => {
          paths.forEach((path) => transaction.set({ path }, {}));
        },
      }),
      (error) => error.status === 403 && error.code === 'codex-dev-production-denied',
      name,
    );
    assert.equal(attempts, 2, name + ' retried after concurrent registry registration');
    assert.deepEqual(committed, [], name + ' commits zero writes after quarantine');
  }
});

test('userModerationAction guarded mutation allows an ordinary transaction and denies an already registered actor before mutate', async () => {
  const committed = [];
  const ordinaryDb = {
    runTransaction: async (callback) => {
      const queued = [];
      const result = await callback({ set: (ref) => queued.push(ref.path) });
      committed.push(...queued);
      return result;
    },
  };
  await runUserModerationActionMutation({
    db: ordinaryDb,
    uid: 'ordinary',
    isKnownCodexDevActorUid: async () => false,
    mutate: async (transaction) => transaction.set({ path: 'uploads/ordinary' }, {}),
  });
  assert.deepEqual(committed, ['uploads/ordinary']);

  let mutateCalls = 0;
  const deniedDb = { runTransaction: async (callback) => callback({}) };
  await assert.rejects(
    runUserModerationActionMutation({
      db: deniedDb,
      uid: 'retired-codex',
      isKnownCodexDevActorUid: async () => true,
      mutate: async () => { mutateCalls += 1; },
    }),
    (error) => error.status === 403 && error.code === 'codex-dev-production-denied',
  );
  assert.equal(mutateCalls, 0);
});

test('userModerationAction has one authoritative transaction boundary and no direct Firestore writes afterward', async () => {
  const source = await fs.readFile(new URL('../functions/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const userModerationAction');
  const end = source.indexOf('export const getContributorByAliasCallable', start);
  assert.ok(start >= 0 && end > start);
  const section = source.slice(start, end);
  assert.match(section, /runUserModerationActionMutation\(\{/);
  assert.doesNotMatch(section, /\b(?:uploadRef|messageRef|threadRef|draftRef)\.set\(/);
  assert.doesNotMatch(section, /db\.collection\('moderationExamples'\)\.doc\([^\n]+\)\.set\(/);
  assert.match(section, /transaction\.set\(threadRef, \{ updatedAt:/);
  assert.match(section, /transaction\.set\(correctionPlan\.moderationExampleRef/);
  assert.match(section, /transaction\.set\(draftRef/);
  assert.match(section, /transaction\.create\(postRef/);
  const lastRead = section.lastIndexOf('transaction.get(');
  const writeIndexes = [
    section.indexOf('transaction.set('),
    section.indexOf('transaction.create('),
    section.indexOf('transaction.update('),
  ].filter((index) => index >= 0);
  assert.ok(writeIndexes.length > 0);
  assert.ok(lastRead >= 0 && lastRead < Math.min(...writeIndexes), 'all transaction reads precede every queued write');
});
