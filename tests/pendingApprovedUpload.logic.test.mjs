import assert from 'node:assert/strict';
import {
  isPendingApprovedUploadCandidate,
  selectPendingApprovedUploadReminder,
} from '../src/utils/pendingApprovedUpload.js';

const legacyBaseUpload = {
  id: 'upload_approved_pending',
  reviewStatus: 'approved',
  publicationStatus: 'pending',
  reviewDecisionAt: { seconds: 20 },
};

assert.equal(isPendingApprovedUploadCandidate(legacyBaseUpload), true);
assert.deepEqual(
  selectPendingApprovedUploadReminder([legacyBaseUpload]),
  { uploadId: 'upload_approved_pending', count: 1 },
);

const approvedWithoutPublicationStatus = { ...legacyBaseUpload };
delete approvedWithoutPublicationStatus.publicationStatus;
assert.equal(isPendingApprovedUploadCandidate(approvedWithoutPublicationStatus), true);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: '' }), true);
assert.equal(isPendingApprovedUploadCandidate({ ...approvedWithoutPublicationStatus, publishStatus: 'discarded' }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: 'draft' }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationPromptOpenedAt: { seconds: 30 } }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: 'discarded', discardedAt: { seconds: 31 } }), false);
assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus: 'published', publishedAt: { seconds: 32 } }), false);

assert.equal(isPendingApprovedUploadCandidate({
  ...legacyBaseUpload,
  moderationState: 'allowed',
  publicationState: 'pending',
  reviewStatus: 'rejected',
  publicationStatus: 'blocked',
}), true, 'canonical allowed/pending state is reminder authority');
assert.equal(isPendingApprovedUploadCandidate({
  ...legacyBaseUpload,
  moderationState: 'superseded',
  publicationState: 'pending',
  reviewStatus: 'approved',
  publicationStatus: 'pending',
}), false, 'canonical superseded state blocks stale approved mirrors');
assert.equal(isPendingApprovedUploadCandidate({
  ...legacyBaseUpload,
  moderationState: 'allowed',
  publicationState: 'discarded',
  reviewStatus: 'approved',
  publicationStatus: 'pending',
}), false, 'canonical discarded state blocks stale pending mirrors');

assert.equal(
  selectPendingApprovedUploadReminder([
    { ...legacyBaseUpload, id: 'older', reviewDecisionAt: { seconds: 10 } },
    { ...legacyBaseUpload, id: 'newer', reviewDecisionAt: { seconds: 20 } },
  ])?.uploadId,
  'newer',
);

for (const publicationStatus of ['expired', 'deleted', 'deleted_pending_cleanup']) {
  assert.equal(isPendingApprovedUploadCandidate({ ...legacyBaseUpload, publicationStatus }), false);
}
