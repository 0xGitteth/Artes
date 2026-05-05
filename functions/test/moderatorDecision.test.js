import test from 'node:test';
import assert from 'node:assert/strict';
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
