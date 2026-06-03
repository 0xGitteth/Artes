import test from 'node:test';
import assert from 'node:assert/strict';
import { canPublishUpload, requiresMessageIdForAction } from '../userModerationActionPolicy.js';

test('publishNow is denied when requiresUploaderAcceptance is true', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', requiresUploaderAcceptance: true }), false);
});

test('publishNow is denied when publicationStatus is needs_user_correction', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'needs_user_correction' }), false);
});

test('publishNow is denied when publicationStatus is user_disagreed', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'user_disagreed' }), false);
});

test('publishNow is denied when correction response is not accepted', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', correctedTaxonomy: { themes: ['A'], triggers: [] }, uploaderCorrectionResponse: { status: 'rejected' } }), false);
});

test('publishNow allowed after accepted correction in safe state', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', correctedTaxonomy: { themes: ['A'], triggers: [] }, uploaderCorrectionResponse: { status: 'accepted' }, requiresUploaderAcceptance: false, publicationStatus: 'correction_accepted' }), true);
});

test('messageId required only for publishNow/saveDraft/dismiss', () => {
  assert.equal(requiresMessageIdForAction('publishNow'), true);
  assert.equal(requiresMessageIdForAction('saveDraft'), true);
  assert.equal(requiresMessageIdForAction('dismiss'), true);
  assert.equal(requiresMessageIdForAction('acceptCorrection'), false);
  assert.equal(requiresMessageIdForAction('rejectCorrection'), false);
  assert.equal(requiresMessageIdForAction('repairPublished'), false);
  assert.equal(requiresMessageIdForAction('markPublicationPromptOpened'), false);
  assert.equal(requiresMessageIdForAction('discardApprovedUpload'), false);
});

test('publishNow is denied after an approved upload is discarded', () => {
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publicationStatus: 'discarded' }), false);
  assert.equal(canPublishUpload({ reviewStatus: 'approved', publishStatus: 'discarded' }), false);
});
