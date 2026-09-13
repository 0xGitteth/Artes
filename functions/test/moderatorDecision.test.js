import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isModeratorDecisionActionCompatible, normalizeModeratorDecisionAction, validateCorrectedTaxonomyForAction } from '../moderatorDecision.js';

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


test('moderatorDecide persists canonical moderatorDecision on the upload', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const moderatorDecide');
  const transactionStart = source.indexOf('await db.runTransaction(async (transaction) => {', start);
  const body = source.slice(transactionStart, source.indexOf("if (caseType === 'report' && normalizedDecision === 'approved' && reportPostId", transactionStart));
  const uploadWriteStart = body.indexOf('transaction.update(uploadRef, {');
  assert.notEqual(uploadWriteStart, -1);
  const uploadWrite = body.slice(uploadWriteStart, body.indexOf('});', uploadWriteStart) + 3);
  assert.match(uploadWrite, /moderatorDecision:\s*\{/);
  assert.match(uploadWrite, /action:\s*normalizedModeratorAction/);
  assert.match(uploadWrite, /correctedTaxonomy:\s*\{ themes: correctedThemes, triggers: correctedTriggers \}/);
  assert.match(uploadWrite, /requiresUploaderAcceptance:\s*normalizedModeratorAction === 'requestUserCorrection'/);
});


test('moderator action must match the stored decision', () => {
  assert.equal(isModeratorDecisionActionCompatible('approveAsIs', 'approved'), true);
  assert.equal(isModeratorDecisionActionCompatible('approveWithTaxonomyCorrection', 'approved'), true);
  assert.equal(isModeratorDecisionActionCompatible('requestUserCorrection', 'approved'), true);
  assert.equal(isModeratorDecisionActionCompatible('rejectForbidden', 'rejected'), true);
  assert.equal(isModeratorDecisionActionCompatible('approveWithTaxonomyCorrection', 'rejected'), false);
  assert.equal(isModeratorDecisionActionCompatible('rejectForbidden', 'approved'), false);
});

test('moderatorDecide rejects contradictory decision/action pairs', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(source, /isModeratorDecisionActionCompatible\(normalizedModeratorAction, normalizedDecision\)/);
  assert.match(source, /Moderator action contradicts decision/);
});


test("moderatorDecide releases exactly one open review slot", () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export const moderatorDecide');
  const end = source.indexOf('export const moderatorQueueFreshEvaluation', start);
  const body = source.slice(start, end);
  assert.match(body, /caseType === 'upload' && userId/);
  assert.match(body, /decidingUserModerationSnap = await transaction\.get/);
  assert.match(body, /getOpenReviewCountAfterCaseExit\(\{/);
  assert.match(body, /openReviewCount: decidingUserModerationData\.openReviewCount/);
  assert.doesNotMatch(body, /openReviewCount:\s*0/);
});
