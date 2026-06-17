import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  rankModerationExampleMatches,
  resolveModerationExampleFingerprints,
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
    dhashPrefix: '12345678',
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
