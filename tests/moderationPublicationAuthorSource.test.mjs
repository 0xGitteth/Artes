import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');

test('managed publication author is revalidated from a transaction snapshot before post creation', () => {
  const start = source.indexOf('export const userModerationAction');
  const end = source.indexOf('export const moderatorDecide', start);
  const action = source.slice(start, end);
  const refIndex = action.indexOf('const publicationAuthorProfileRef');
  const readIndex = action.indexOf('transaction.get(publicationAuthorProfileRef)');
  const validationIndex = action.indexOf('validateModerationPublicationAuthorProfile({', readIndex);
  const createIndex = action.indexOf('transaction.create(postRef');
  assert.ok(refIndex >= 0 && refIndex < readIndex);
  assert.ok(readIndex < validationIndex && validationIndex < createIndex);
  assert.ok(action.includes('profileExists: Boolean(latestAuthorProfileSnap?.exists)'));
});
