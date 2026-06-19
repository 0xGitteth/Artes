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
  resolveReviewCaseUploadIds,
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
        this.queries.push({ field, op, value, limit: null });
        return {
          limit: (requestedLimit) => {
            this.queries[this.queries.length - 1].limit = requestedLimit;
            return {
              get: async () => ({
                docs: docs
                  .filter((doc) => field.split('.').reduce((acc, key) => acc?.[key], doc.data) === value)
                  .slice(0, requestedLimit || docs.length)
                  .map((doc) => ({ id: doc.id, data: () => doc.data })),
              }),
            };
          },
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



test('resolveReviewCaseUploadIds collects uploadId, linkedUploadId, and linkedUploadIds', () => {
  assert.deepEqual(resolveReviewCaseUploadIds({
    uploadId: 'primary',
    linkedUploadId: 'linked',
    linkedUploadIds: ['', 'array-linked', null],
  }), ['primary', 'linked', 'array-linked']);
});

test('endpoint validates explicit uploadId against reviewCase linked upload ids', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const getModerationExamplesForCase');
  const body = source.slice(start, source.indexOf('export const moderatorClaim', start));
  assert.match(body, /const allowedUploadIds = resolveReviewCaseUploadIds\(reviewCase\)/);
  assert.match(body, /if \(uploadId && !allowedUploadIds\.includes\(uploadId\)\)/);
  assert.match(body, /uploadId is not linked to reviewCaseId/);
  assert.match(body, /if \(!uploadSnap\.exists\)/, 'linked but missing explicit upload returns 404');
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

test('selected upload fingerprints are preferred over reviewCase fingerprints', () => {
  const reviewCase = { fingerprints: { sha256: 'image-a', dhash: 'aaaaaaaaaaaaaaaa', dhashPrefix: 'aaaa' } };
  const upload = { fingerprints: { sha256: 'image-b', dhash: 'bbbbbbbbbbbbbbbb', dhashPrefix: 'bbbb' } };
  assert.deepEqual(resolveModerationExampleFingerprints(upload, reviewCase), {
    sha256: 'image-b',
    dhash: 'bbbbbbbbbbbbbbbb',
    dhashPrefix: 'bbbb',
  });

  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const getModerationExamplesForCase');
  const body = source.slice(start, source.indexOf('export const moderatorClaim', start));
  assert.match(body, /resolveModerationExampleFingerprints\(upload, reviewCase\)/);
});

test('upload-only endpoint loads linked reviewCase as optional source context', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const getModerationExamplesForCase');
  const body = source.slice(start, source.indexOf('export const moderatorClaim', start));
  assert.match(body, /const linkedReviewCaseId = String\(upload\?\.reviewCaseId \|\| ''\)\.trim\(\)/);
  assert.match(body, /if \(!reviewCase && linkedReviewCaseId\)/);
  assert.match(body, /collection\('reviewCases'\)\.doc\(linkedReviewCaseId\)\.get\(\)/);
  assert.match(body, /reviewCase = linkedReviewSnap\.exists \? linkedReviewSnap\.data\(\) \|\| \{\} : null/);
});

test('upload-only linked reviewCase finalPolicyOutcome can drive fallback context', () => {
  assert.equal(resolveModerationSourceFinalOutcome({
    reviewCase: { moderatorDecision: { finalPolicyOutcome: 'linkedPolicyOutcome' } },
    upload: { outcome: 'uploadOutcome' },
  }), 'linkedPolicyOutcome');
});

test('upload-only lookup with missing linked reviewCase still uses upload outcome', () => {
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: null, upload: { outcome: 'uploadOutcome' } }), 'uploadOutcome');
});

test('no fingerprints but finalOutcome returns similar examples', async () => {
  const db = makeDb([{ id: 'similar', data: { finalOutcome: 'allowed' } }]);
  const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints: null, sourceContext: { finalOutcome: 'allowed' }, limit: 5 });
  assert.deepEqual(examples.map((item) => item.exampleId), ['similar']);
  assert.deepEqual(db.queries.map((query) => [query.field, query.value]), [['finalOutcome', 'allowed']]);
});

test('no fingerprints and no finalOutcome returns empty result', async () => {
  const db = makeDb([{ id: 'similar', data: { finalOutcome: 'allowed' } }]);
  const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints: null, sourceContext: {}, limit: 5 });
  assert.deepEqual(examples, []);
  assert.deepEqual(db.queries, []);
});

test('fallback runs when raw matches hit limit but unique ranked count is still low', async () => {
  const db = makeDb([
    { id: 'duplicate', data: { fingerprints: { sha256: 'sha', dhash: '0000000000000000', dhashPrefix: '0000' } } },
    { id: 'similar1', data: { finalOutcome: 'allowed', createdAt: '2026-01-01T00:00:00.000Z' } },
    { id: 'similar2', data: { finalOutcome: 'allowed', createdAt: '2026-01-02T00:00:00.000Z' } },
  ]);
  const examples = await fetchModerationExamplesForFingerprints({
    db,
    fingerprints: { sha256: 'sha', dhash: '0000000000000000', dhashPrefix: '0000' },
    sourceContext: { finalOutcome: 'allowed' },
    limit: 3,
  });
  assert.deepEqual(examples.map((item) => item.exampleId), ['duplicate', 'similar2', 'similar1']);
  assert.ok(db.queries.some((query) => query.field === 'finalOutcome' && query.value === 'allowed'));
});

test('dhashPrefix query uses larger candidate window before hamming filtering', async () => {
  const docs = Array.from({ length: 5 }, (_, index) => ({
    id: `far${index}`,
    data: { fingerprints: { dhashPrefix: '0000', dhash: 'ffffffffffffffff' } },
  }));
  docs.push({ id: 'later-near', data: { fingerprints: { dhashPrefix: '0000', dhash: '0000000000000001' } } });
  const db = makeDb(docs);
  const examples = await fetchModerationExamplesForFingerprints({
    db,
    fingerprints: { dhash: '0000000000000000', dhashPrefix: '0000' },
    limit: 3,
  });
  assert.deepEqual(examples.map((item) => item.exampleId), ['later-near']);
});

test('dhashPrefix ranking prefers smaller hamming distance over newer createdAt', () => {
  const ranked = rankModerationExampleMatches([
    { id: 'distance-8-newer', matchType: 'dhashPrefix', distance: 8, data: { createdAt: '2026-01-03T00:00:00.000Z' } },
    { id: 'distance-1-older', matchType: 'dhashPrefix', distance: 1, data: { createdAt: '2026-01-01T00:00:00.000Z' } },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ['distance-1-older', 'distance-8-newer']);
});

test('dhashPrefix ranking falls back to newest createdAt when distance is equal', () => {
  const ranked = rankModerationExampleMatches([
    { id: 'older', matchType: 'dhashPrefix', distance: 2, data: { createdAt: '2026-01-01T00:00:00.000Z' } },
    { id: 'newer', matchType: 'dhashPrefix', distance: 2, data: { createdAt: '2026-01-02T00:00:00.000Z' } },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ['newer', 'older']);
});

test('dhashPrefix dedupe keeps better same-type distance but exact matches keep priority', () => {
  const ranked = rankModerationExampleMatches([
    { id: 'same', matchType: 'dhashPrefix', distance: 8, data: { createdAt: '2026-01-03T00:00:00.000Z' } },
    { id: 'same', matchType: 'dhashPrefix', distance: 1, data: { createdAt: '2026-01-01T00:00:00.000Z' } },
    { id: 'sha', matchType: 'sha256', data: { createdAt: '2026-01-01T00:00:00.000Z' } },
    { id: 'dhash', matchType: 'dhash', data: { createdAt: '2026-01-01T00:00:00.000Z' } },
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ['sha', 'dhash', 'same']);
  assert.equal(ranked.find((item) => item.id === 'same').distance, 1);
});

test('sha256 query uses candidate window and local ranking returns newest capped results', async () => {
  const docs = Array.from({ length: 6 }, (_, index) => ({
    id: `sha${index}`,
    data: { fingerprints: { sha256: 'sha' }, createdAt: `2026-01-0${index + 1}T00:00:00.000Z` },
  }));
  const db = makeDb(docs);
  const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints: { sha256: 'sha' }, limit: 3 });
  assert.deepEqual(examples.map((item) => item.exampleId), ['sha5', 'sha4', 'sha3']);
  assert.equal(db.queries.find((query) => query.field === 'fingerprints.sha256').limit, 25);
  assert.equal(examples.length, 3);
});

test('dhash query uses candidate window and final response remains capped', async () => {
  const docs = Array.from({ length: 6 }, (_, index) => ({
    id: `dhash${index}`,
    data: { fingerprints: { dhash: '0000000000000000' }, createdAt: `2026-01-0${index + 1}T00:00:00.000Z` },
  }));
  const db = makeDb(docs);
  const examples = await fetchModerationExamplesForFingerprints({ db, fingerprints: { dhash: '0000000000000000' }, limit: 3 });
  assert.deepEqual(examples.map((item) => item.exampleId), ['dhash5', 'dhash4', 'dhash3']);
  assert.equal(db.queries.find((query) => query.field === 'fingerprints.dhash').limit, 25);
  assert.equal(examples.length, 3);
});

test('fallback still uses unique count after dedupe with candidate windows', async () => {
  const db = makeDb([
    { id: 'duplicate', data: { fingerprints: { sha256: 'sha', dhash: '0000000000000000', dhashPrefix: '0000' }, finalOutcome: 'ignored' } },
    { id: 'fallback', data: { finalOutcome: 'allowed', createdAt: '2026-01-02T00:00:00.000Z' } },
  ]);
  const examples = await fetchModerationExamplesForFingerprints({
    db,
    fingerprints: { sha256: 'sha', dhash: '0000000000000000', dhashPrefix: '0000' },
    sourceContext: { finalOutcome: 'allowed' },
    limit: 2,
  });
  assert.deepEqual(examples.map((item) => item.exampleId), ['duplicate', 'fallback']);
  assert.ok(db.queries.some((query) => query.field === 'finalOutcome'));
});

test('finalOutcome fallback uses candidate window and fills capped response after duplicate candidates', async () => {
  const docs = [
    { id: 'fingerprint', data: { fingerprints: { sha256: 'sha' }, finalOutcome: 'allowed', createdAt: '2026-01-01T00:00:00.000Z' } },
    ...Array.from({ length: 5 }, () => ({
      id: 'fingerprint',
      data: { finalOutcome: 'allowed', createdAt: '2026-01-01T00:00:00.000Z' },
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `later-similar-${index}`,
      data: { finalOutcome: 'allowed', createdAt: `2026-01-0${index + 2}T00:00:00.000Z` },
    })),
  ];
  const db = makeDb(docs);
  const examples = await fetchModerationExamplesForFingerprints({
    db,
    fingerprints: { sha256: 'sha' },
    sourceContext: { finalOutcome: 'allowed' },
    limit: 3,
  });
  assert.deepEqual(examples.map((item) => item.exampleId), ['fingerprint', 'later-similar-3', 'later-similar-2']);
  assert.equal(db.queries.find((query) => query.field === 'finalOutcome').limit, 25);
  assert.equal(examples.length, 3);
});

test('source reviewCaseId and uploadId examples are excluded across exact and fallback matches', async () => {
  const db = makeDb([
    {
      id: 'current-review-case-sha',
      data: { reviewCaseId: 'case-current', uploadId: 'other-upload', fingerprints: { sha256: 'sha' }, finalOutcome: 'allowed' },
    },
    {
      id: 'current-upload-sha',
      data: { reviewCaseId: 'other-case', uploadId: 'upload-current', fingerprints: { sha256: 'sha' }, finalOutcome: 'allowed' },
    },
    {
      id: 'other-sha',
      data: { reviewCaseId: 'case-other', uploadId: 'upload-other', fingerprints: { sha256: 'sha' }, finalOutcome: 'allowed', createdAt: '2026-01-03T00:00:00.000Z' },
    },
    {
      id: 'fallback-current-case',
      data: { reviewCaseId: 'case-current', uploadId: 'fallback-upload', finalOutcome: 'allowed', createdAt: '2026-01-04T00:00:00.000Z' },
    },
    {
      id: 'fallback-other',
      data: { reviewCaseId: 'case-fallback-other', uploadId: 'upload-fallback-other', finalOutcome: 'allowed', createdAt: '2026-01-02T00:00:00.000Z' },
    },
  ]);
  const examples = await fetchModerationExamplesForFingerprints({
    db,
    fingerprints: { sha256: 'sha' },
    sourceContext: { finalOutcome: 'allowed' },
    sourceIdentifiers: { sourceReviewCaseId: 'case-current', sourceUploadId: 'upload-current' },
    limit: 3,
  });
  assert.deepEqual(examples.map((item) => item.exampleId), ['other-sha', 'fallback-other']);
});

test('source exclusion still caps final response when enough other examples exist', async () => {
  const docs = [
    { id: 'current-upload', data: { uploadId: 'upload-current', fingerprints: { sha256: 'sha' } } },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `other-${index}`,
      data: { fingerprints: { sha256: 'sha' }, createdAt: `2026-01-0${index + 1}T00:00:00.000Z` },
    })),
  ];
  const db = makeDb(docs);
  const examples = await fetchModerationExamplesForFingerprints({
    db,
    fingerprints: { sha256: 'sha' },
    sourceIdentifiers: { sourceUploadId: 'upload-current' },
    limit: 3,
  });
  assert.deepEqual(examples.map((item) => item.exampleId), ['other-4', 'other-3', 'other-2']);
  assert.equal(examples.length, 3);
});

test('finalOutcome mapping uses moderationExampleBuilder mapper before raw finalPolicyOutcome', () => {
  assert.equal(resolveModerationSourceFinalOutcome({
    reviewCase: { moderatorDecision: { action: 'requestUserCorrection', finalPolicyOutcome: 'allowed' } },
  }), 'needs_user_correction');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { action: 'approveAsIs' } } }), 'allowed');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { action: 'approveWithTaxonomyCorrection' } } }), 'allowed');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { action: 'approve' } } }), 'allowed');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { action: 'rejectForbidden' } } }), 'forbidden');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { decision: 'rejected' } }), 'forbidden');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { action: 'queueFreshEvaluation' } } }), 'fresh_eval_queued');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { action: 'acceptCorrection' } } }), 'correction_accepted');
  assert.equal(resolveModerationSourceFinalOutcome({ reviewCase: { moderatorDecision: { action: 'rejectCorrection' } } }), 'user_disagreed');
});

test('explicit reviewCase finalOutcome remains highest priority over mapped action', () => {
  assert.equal(resolveModerationSourceFinalOutcome({
    reviewCase: { finalOutcome: 'stored_final', moderatorDecision: { action: 'rejectForbidden' }, decision: 'rejected' },
  }), 'stored_final');
});

test('upload moderatorDecision action mapping is used when reviewCase has no usable outcome', () => {
  assert.equal(resolveModerationSourceFinalOutcome({
    reviewCase: { decision: 'unknownDecision' },
    upload: { moderatorDecision: { action: 'requestUserCorrection', finalPolicyOutcome: 'allowed' } },
  }), 'unknownDecision');
  assert.equal(resolveModerationSourceFinalOutcome({
    upload: { moderatorDecision: { action: 'requestUserCorrection', finalPolicyOutcome: 'allowed' } },
  }), 'needs_user_correction');
});
