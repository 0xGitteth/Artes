import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strategy = JSON.parse(readFileSync(new URL('../docs/moderation-dataset-source-strategy-v2.json', import.meta.url), 'utf8'));

test('normal human review batches avoid one-image churn', () => {
  assert.ok(strategy.humanReviewBatching.normalMinimumImagesPerReviewBatch >= 5);
  assert.ok(strategy.humanReviewBatching.normalMinimumIndependentSourcePoolsPerReviewBatch >= 2);
  assert.match(strategy.humanReviewBatching.singleImageException, /never counts as meaningful class coverage/i);
});

test('source strategy still prioritizes independent pools and contributor-authorized data', () => {
  assert.match(strategy.nextAction, /independent source pools/i);
  assert.match(strategy.nextAction, /contributor-authorized/i);
});
