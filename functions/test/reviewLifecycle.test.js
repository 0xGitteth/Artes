import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOpenReviewCountAfterCaseExit,
  getReviewAccessDecision,
} from '../reviewLifecycle.js';

test('review access allows an ordinary eligible uploader', () => {
  const result = getReviewAccessDecision({
    reviewRightsLevel: 1,
    openReviewCount: 0,
    cooldownUntil: null,
    nowMs: 1000,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.hasReviewRights, true);
  assert.equal(result.reviewCapacityAvailable, true);
  assert.equal(result.inCooldown, false);
  assert.equal(result.code, null);
});

test('review access blocks disabled rights before other gates', () => {
  const result = getReviewAccessDecision({
    reviewRightsLevel: 0,
    openReviewCount: 1,
    cooldownUntil: 5000,
    nowMs: 1000,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'review_rights_disabled');
  assert.equal(result.status, 403);
});

test('review access blocks an active cooldown', () => {
  const result = getReviewAccessDecision({
    reviewRightsLevel: 1,
    openReviewCount: 0,
    cooldownUntil: { seconds: 5, nanoseconds: 0 },
    nowMs: 1000,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'review_cooldown_active');
  assert.equal(result.status, 429);
  assert.equal(result.inCooldown, true);
});

test('review access allows an expired cooldown', () => {
  const result = getReviewAccessDecision({
    reviewRightsLevel: 1,
    openReviewCount: 0,
    cooldownUntil: { toMillis: () => 999 },
    nowMs: 1000,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.inCooldown, false);
});

test('review access blocks when one upload review is already open', () => {
  const result = getReviewAccessDecision({
    reviewRightsLevel: 1,
    openReviewCount: 1,
    nowMs: 1000,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'review_limit_reached');
  assert.equal(result.status, 409);
  assert.equal(result.reviewCapacityAvailable, false);
});

test('review access normalizes malformed counters conservatively to no open case', () => {
  assert.equal(getReviewAccessDecision({ openReviewCount: -4 }).openReviewCount, 0);
  assert.equal(getReviewAccessDecision({ openReviewCount: 'not-a-number' }).openReviewCount, 0);
});

test('closing an open upload case releases exactly one capacity slot', () => {
  assert.equal(getOpenReviewCountAfterCaseExit({ openReviewCount: 1, wasOpenUploadCase: true }), 0);
  assert.equal(getOpenReviewCountAfterCaseExit({ openReviewCount: 0, wasOpenUploadCase: true }), 0);
  assert.equal(getOpenReviewCountAfterCaseExit({ openReviewCount: 2, wasOpenUploadCase: true }), 1);
});

test('non-upload or already-closed transitions do not alter the counter', () => {
  assert.equal(getOpenReviewCountAfterCaseExit({ openReviewCount: 1, wasOpenUploadCase: false }), 1);
});
