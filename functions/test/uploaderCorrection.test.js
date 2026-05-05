import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUploaderCorrectionAction } from '../uploaderCorrection.js';

const baseUpload = {
  userId: 'u1',
  requiresUploaderAcceptance: true,
  publicationStatus: 'needs_user_correction',
  moderatorDecision: { action: 'requestUserCorrection' },
  correctedTaxonomy: { themes: ['Portrait'], triggers: ['adultArtNude'] },
  outcome: 'allowed',
  shouldReview: false,
};

test('acceptCorrection fails when corrected taxonomy is empty', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u1', upload: { ...baseUpload, correctedTaxonomy: { themes: [], triggers: [] } } });
  assert.equal(result.ok, false);
});

test('acceptCorrection fails when upload is forbidden', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u1', upload: { ...baseUpload, outcome: 'forbidden' } });
  assert.equal(result.ok, false);
});

test('acceptCorrection fails when owner mismatches', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u2', upload: baseUpload });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('acceptCorrection succeeds for valid owned upload', () => {
  const result = validateUploaderCorrectionAction({ action: 'acceptCorrection', userId: 'u1', upload: baseUpload });
  assert.equal(result.ok, true);
  assert.deepEqual(result.correctedTaxonomy.themes, ['Portrait']);
});

test('rejectCorrection allowed and remains blocked state path', () => {
  const result = validateUploaderCorrectionAction({ action: 'rejectCorrection', userId: 'u1', upload: baseUpload });
  assert.equal(result.ok, true);
});
