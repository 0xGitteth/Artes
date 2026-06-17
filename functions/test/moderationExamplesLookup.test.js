import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  fetchModerationExamplesForFingerprints,
  hammingDistance,
  rankModerationExampleMatches,
  resolveEffectiveUploadId,
  resolveModerationExampleFingerprints,
  resolveModerationSourceFinalOutcome,
  sanitizeModerationExample,
} from '../moderationExamplesLookup.js';

const example = {
  createdAt: '2026-01-01T00:00:00.000Z',
  finalOutcome: 'forbidden',
  learningStatus: 'resolved',
  source: 'moderatorDecide',
  reviewCaseId: 'case1',
  uploadId: 'upload1',
  uploaderUid: 'private-user',
  rawOutput: 'secret raw',
  prompt: 'secret prompt',
  imageData: 'large blob',
  upload: { title: 'full upload data' },
  moderatorDecision: { action: 'rejectForbidden', reasonCode: 'explicit', notes: 'internal note' },
  aiSnapshot: {
    outcome: 'forbidden',
    classification: 'adult',
    shouldReview: true,
    appliedTriggers: ['adultEroticSuggestive'],
    suggestedTriggers: ['adultEroticSuggestive'],
    forbiddenReasons: ['explicit'],
    requiredThemes: ['Art Nude'],
    rawOutput: 'nested secret',
    prompt: 'nested prompt',
  },
  aiSafetySignals: { safeSearch: { adult: 'LIKELY' }, geminiAdultDecision: 'forbidden', explicitnessConfidence: 0.91, extraSecret: 'nope' },
  policyDecision: { outcome: 'forbidden', shouldReview: true, forbiddenReasons: ['explicit'], appliedPolicyTriggers: ['adultEroticSuggestive'], requiredThemes: ['Art Nude'], needsCorrection: false, fullDebug: 'nope' },
  analytics: { mismatchType: 'none', debug: 'nope' },
};

test('resolveModerationExampleFingerprints uses case or upload fingerprint fields', () => {
  assert.deepEqual(resolveModerationExampleFingerprints({ fingerprints: { sha256: 'a' } }, { fingerprints: { dhash: '1234567890abcdef' } }), {
    sha256: 'a',
    dhash: '1234567890abcdef',
    dhashPrefix: '1234',
  });
  assert.deepEqual(resolveModerationExampleFingerprints({ sha256: 'b', dhashPrefix: 'pref' }), { sha256: 'b', dhashPrefix: 'pref' });
});

test('exact sha256 match ranks before near dhash and dhashPrefix matches', () => {
  const ranked = rankModerationExampleMatches([
    { id: 'near-prefix', data: { createdAt: '2026-01-03T00:00:00.000Z' }, matchType: 'dhashPrefix' },
    { id: 'exact', data: { createdAt: '2026-01-01T00:00:00.000Z' }, matchType: 'sha256' },
    { id: 'near-dhash', data: { createdAt: '2026-01-02T00:00:00.000Z' }, matchType: 'dhash' },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ['exact', 'near-dhash', 'near-prefix']);
});

test('sanitized response only returns approved moderator context fields', () => {
  const sanitized = sanitizeModerationExample({ id: 'example1', data: example, matchType: 'sha256' });
  assert.equal(sanitized.exampleId, 'example1');
  assert.equal(sanitized.fingerprintMatchType, 'sha256');
  assert.equal(sanitized.moderatorDecision.action, 'rejectForbidden');
  assert.equal(sanitized.aiSnapshot.outcome, 'forbidden');
  assert.equal(sanitized.rawOutput, undefined);
  assert.equal(sanitized.prompt, undefined);
  assert.equal(sanitized.uploaderUid, undefined);
  assert.equal(sanitized.upload, undefined);
  assert.equal(sanitized.aiSnapshot.rawOutput, undefined);
  assert.equal(sanitized.aiSnapshot.prompt, undefined);
  assert.equal(sanitized.moderatorDecision.notes, undefined);
  assert.equal(sanitized.aiSafetySignals.extraSecret, undefined);
  assert.equal(sanitized.policyDecision.fullDebug, undefined);
});

test('getModerationExamplesForCase endpoint keeps moderator auth and clear input errors', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const getModerationExamplesForCase');
  assert.notEqual(start, -1, 'endpoint should be exported');
  const body = source.slice(start, source.indexOf('export const moderatorClaim', start));
  assert.match(body, /const decoded = await verifyToken\(req\)/, 'unauthenticated requests are denied by verifyToken');
  assert.match(body, /await ensureModerator\(decoded\)/, 'non moderators are denied by existing moderator check');
  assert.match(body, /reviewCaseId or uploadId is required/, 'missing ids return a clear error');
  assert.match(body, /Review case not found/, 'unknown review case has consistent not found response');
  assert.match(body, /Upload not found/, 'unknown upload has consistent not found response');
  assert.match(body, /collection\('reviewCases'\)\.doc\(reviewCaseId\)/, 'moderators can fetch by reviewCase');
  assert.match(body, /collection\('uploads'\)\.doc\(effectiveUploadId\)/, 'moderators can fetch by uploadId');
});


const makeDb = (docs = []) => ({
  queries: [],
  collection(name) {
    assert.equal(name, 'moderationExamples');
    return {
      where: (field, op, value) => {
        this.queries.push({ field, op, value });
        return {
          limit: () => ({
            get: async () => ({
              docs: docs
                .filter((doc) => field.split('.').reduce((acc, key) => acc?.[key], doc.data) === value)
                .map((doc) => ({ id: doc.id, data: () => doc.data })),
            }),
          }),
        };
      },
    };
  },
});

test('resolveEffectiveUploadId supports linkedUploadIds and preserves request override', () => {
  assert.equal(resolveEffectiveUploadId({ reviewCase: { linkedUploadIds: ['', 'linked1'] } }), 'linked1');
  assert.equal(resolveEffectiveUploadId({ reviewCase: { uploadId: 'upload1', linkedUploadIds: ['linked1'] } }), 'upload1');
  assert.equal(resolveEffectiveUploadId({ requestUploadId: 'override1', reviewCase: { uploadId: 'upload1' } }), 'override1');
});

test('reportedFingerprints object resolves sha256, dhash, and dhashPrefix', () => {
  assert.deepEqual(resolveModerationExampleFingerprints({ reportedFingerprints: { sha256: 'sha', dhash: 'abcd1234', dhashPrefix: 'abcd' } }), {
    sha256: 'sha',
    dhash: 'abcd1234',
    dhashPrefix: 'abcd',
  });
});

test('fingerprint arrays and malformed entries resolve first available values safely', () => {
  assert.deepEqual(resolveModerationExampleFingerprints({ fingerprints: [null, 'bad', { dhash: 'abcd1234' }, { sha256: 'sha' }] }), {
    sha256: 'sha',
    dhash: 'abcd1234',
    dhashPrefix: 'abcd',
  });
  assert.deepEqual(resolveModerationExampleFingerprints({ reportedFingerprints: ['bad', { sha256: 'reportedSha' }, { dhash: 'beef1234' }] }), {
    sha256: 'reportedSha',
    dhash: 'beef1234',
    dhashPrefix: 'beef',
  });
});

test('dhash without dhashPrefix derives existing 4 character stored prefix length', () => {
  assert.deepEqual(resolveModerationExampleFingerprints({ fingerprints: { dhash: '1234567890abcdef' } }), {
    dhash: '1234567890abcdef',
    dhashPrefix: '1234',
  });
});

test('dhashPrefix candidates require low full dHash distance when source has full dHash', async () => {
  const sourceDhash = '0000000000000000';
  const db = makeDb([
    { id: 'near', data: { fingerprints: { dhashPrefix: '0000', dhash: '0000000000000001' } } },
    { id: 'far', data: { fingerprints: { dhashPrefix: '0000', dhash: 'ffffffffffffffff' } } },
    { id: 'missing-full-dhash', data: { fingerprints: { dhashPrefix: '0000' } } },
  ]);
  const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints: { dhashPrefix: '0000', dhash: sourceDhash }, limit: 5 });
  assert.deepEqual(examples.map((item) => item.exampleId), ['near']);
  assert.equal(hammingDistance(sourceDhash, '0000000000000001') <= 8, true);
  assert.equal(hammingDistance(sourceDhash, 'ffffffffffffffff') > 8, true);
});

test('exact sha256 ranks before dhash and exact dhash ranks before dhashPrefix', async () => {
  const db = makeDb([
    { id: 'prefix', data: { fingerprints: { dhashPrefix: '0000', dhash: '0000000000000001' } } },
    { id: 'dhash', data: { fingerprints: { dhashPrefix: '0000', dhash: '0000000000000000' } } },
    { id: 'sha', data: { fingerprints: { sha256: 'sha', dhashPrefix: 'ffff', dhash: 'ffffffffffffffff' } } },
  ]);
  const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints: { sha256: 'sha', dhash: '0000000000000000', dhashPrefix: '0000' }, limit: 5 });
  assert.deepEqual(examples.map((item) => item.exampleId), ['sha', 'dhash', 'prefix']);
});

test('fallback outcome resolution supports upload outcome, review decision, and finalPolicyOutcome', () => {
  assert.equal(resolveModerationSourceFinalOutcome({ upload: { outcome: 'uploadOutcome' } }), 'uploadOutcome');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { decision: 'reviewDecision' }, upload: { outcome: 'uploadOutcome' } }), 'reviewDecision');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { finalPolicyOutcome: 'policyOutcome' }, decision: 'reviewDecision' } }), 'policyOutcome');
});

test('fallback outcome value triggers similar finalOutcome query', async () => {
  const db = makeDb([{ id: 'similar', data: { finalOutcome: 'reviewDecision' } }]);
  const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints: { sha256: 'missing' }, sourceContext: { finalOutcome: 'reviewDecision' }, limit: 5 });
  assert.deepEqual(examples.map((item) => item.exampleId), ['similar']);
  assert.deepEqual(db.queries.map((query) => [query.field, query.value]), [
    ['fingerprints.sha256', 'missing'],
    ['finalOutcome', 'reviewDecision'],
  ]);
});
