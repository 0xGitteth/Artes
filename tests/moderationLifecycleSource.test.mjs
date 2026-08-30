import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

test('all review-opening paths share the canonical review access gate', () => {
  assert.match(source, /from '\.\/reviewLifecycle\.js'/);
  const calls = source.match(/getReviewAccessDecision\(\{/g) || [];
  assert.ok(calls.length >= 4, `expected at least four shared review gates, found ${calls.length}`);
  assert.match(source, /correctionReviewAccess = getReviewAccessDecision/);
  assert.match(source, /freshReviewAccess = getReviewAccessDecision/);
});

test('queueFreshEvaluation releases upload review capacity transactionally', () => {
  const start = source.indexOf('export const moderatorQueueFreshEvaluation');
  const end = source.indexOf('export const userModerationAction', start);
  const queueSource = source.slice(start, end);
  assert.match(queueSource, /db\.runTransaction/);
  assert.match(queueSource, /wasOpenUploadCase/);
  assert.match(queueSource, /getOpenReviewCountAfterCaseExit/);
  assert.match(queueSource, /openReviewCount/);
});

test('final moderator decisions release exactly one upload-review capacity slot', () => {
  const start = source.indexOf('export const moderatorDecide');
  const end = source.indexOf('export const moderatorQueueFreshEvaluation', start);
  const decideSource = source.slice(start, end);
  assert.match(decideSource, /decidingUserModerationSnap = await transaction\.get/);
  assert.match(decideSource, /getOpenReviewCountAfterCaseExit\(\{/);
  assert.match(decideSource, /openReviewCount: decidingUserModerationData\.openReviewCount/);
  assert.doesNotMatch(decideSource, /openReviewCount: 0/);
});

test('queueFreshEvaluation cannot retarget a different upload or uploader while closing capacity', () => {
  const start = source.indexOf('export const moderatorQueueFreshEvaluation');
  const end = source.indexOf('export const userModerationAction', start);
  const queueSource = source.slice(start, end);
  assert.match(queueSource, /reviewCaseUploadIds = resolveReviewCaseUploadIds/);
  assert.match(queueSource, /review_case_upload_mismatch/);
  assert.match(queueSource, /freshReviewCaseUploadIds = resolveReviewCaseUploadIds/);
  assert.match(queueSource, /review_case_upload_changed/);
  assert.match(queueSource, /review_case_owner_changed/);
  assert.match(queueSource, /review_case_upload_owner_mismatch/);
});

test('persisted moderation publication requires and persists consent proof', () => {
  const start = source.indexOf('export const userModerationAction');
  const actionSource = source.slice(start);
  assert.match(actionSource, /buildPersistedPublicationConsentProof\(\{ postDraft, userId \}\)/);
  assert.match(actionSource, /uploadConsent: publicationPlan\.uploadConsent/);
  assert.match(actionSource, /consentAudit: publicationPlan\.consentAudit/);
  assert.match(actionSource, /consentException: publicationPlan\.consentException/);
});

test('persisted moderation publication writes canonical allowed moderation proof', () => {
  const start = source.indexOf('if (publicationPlan)');
  const publicationSource = source.slice(start, source.indexOf("if (action === 'saveDraft')", start));
  assert.match(publicationSource, /outcome: 'allowed'/);
  assert.match(publicationSource, /shouldReview: false/);
  assert.match(publicationSource, /forbiddenReasons: \[\]/);
  assert.match(publicationSource, /sensitive: publicationPlan\.appliedTriggers\.length > 0/);
});


test('fresh-evaluation routing boundary is committed atomically', () => {
  const start = source.indexOf('export const moderatorQueueFreshEvaluation');
  const end = source.indexOf('export const userModerationAction', start);
  const queueSource = source.slice(start, end);
  assert.match(queueSource, /transaction\.set\(queueModerationExampleRef, queueExamplePayload/);
  assert.doesNotMatch(queueSource, /await db\.collection\('moderationExamples'\).*queueFreshEvaluation/s);
  assert.doesNotMatch(queueSource, /moderationExample write skipped/);
});
