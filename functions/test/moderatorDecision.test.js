import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeModeratorDecisionAction, validateCorrectedTaxonomyForAction } from '../moderatorDecision.js';

test('approveAsIs normalizes as valid action', () => {
  assert.equal(normalizeModeratorDecisionAction('approveAsIs', 'approved'), 'approveAsIs');
});

test('unknown action is rejected', () => {
  assert.equal(normalizeModeratorDecisionAction('randomAction', 'approved'), null);
});

test('approveWithTaxonomyCorrection requires corrected taxonomy', () => {
  const invalid = validateCorrectedTaxonomyForAction('approveWithTaxonomyCorrection', { themes: [], triggers: [] });
  assert.equal(invalid.isValid, false);
  const valid = validateCorrectedTaxonomyForAction('approveWithTaxonomyCorrection', { themes: ['Boudoir'], triggers: [] });
  assert.equal(valid.isValid, true);
});

test('requestUserCorrection requires corrected taxonomy', () => {
  const invalid = validateCorrectedTaxonomyForAction('requestUserCorrection', {});
  assert.equal(invalid.isValid, false);
  const valid = validateCorrectedTaxonomyForAction('requestUserCorrection', { triggers: ['adultArtNude'] });
  assert.equal(valid.isValid, true);
});

test('rejectForbidden does not require corrected taxonomy', () => {
  const result = validateCorrectedTaxonomyForAction('rejectForbidden', {});
  assert.equal(result.isValid, true);
});

test('moderatorDecide transaction reads upload before any transaction writes', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const transactionStart = source.indexOf('await db.runTransaction(async (transaction) => {', source.indexOf('export const moderatorDecide'));
  assert.notEqual(transactionStart, -1, 'moderatorDecide transaction should exist');
  const body = source.slice(transactionStart, source.indexOf("if (caseType === 'report' && normalizedDecision === 'approved' && reportPostId", transactionStart));
  const uploadRead = body.indexOf('await transaction.get(uploadRef)');
  const firstReviewWrite = body.indexOf('transaction.update(reviewRef, {');
  const uploadWrite = body.indexOf('transaction.update(uploadRef, {');
  const exampleWrite = body.indexOf("transaction.set(db.collection('moderationExamples')");

  assert.ok(uploadRead > -1, 'upload snapshot must be read for moderation example data');
  assert.ok(firstReviewWrite > uploadRead, 'review lock write must happen after upload read');
  assert.ok(uploadWrite > uploadRead, 'upload decision write must happen after upload read');
  assert.ok(exampleWrite > uploadRead, 'moderation example write must stay after upload read');
});
