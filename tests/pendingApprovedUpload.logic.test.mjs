import assert from 'node:assert/strict';
import {
  isPendingApprovedUploadCandidate,
  selectPendingApprovedUploadReminder,
} from '../src/utils/pendingApprovedUpload.js';

const baseUpload = {
  id: 'upload_approved_pending',
  reviewStatus: 'approved',
  publicationStatus: 'pending',
  reviewDecisionAt: { seconds: 20 },
};

assert.equal(
  isPendingApprovedUploadCandidate(baseUpload),
  true,
  'approved unpublished upload shows pending publication modal',
);

assert.deepEqual(
  selectPendingApprovedUploadReminder([baseUpload]),
  { uploadId: 'upload_approved_pending', count: 1 },
  'approved unpublished upload is selected for the reminder',
);

const approvedWithoutPublicationStatus = { ...baseUpload };
delete approvedWithoutPublicationStatus.publicationStatus;
assert.equal(
  isPendingApprovedUploadCandidate(approvedWithoutPublicationStatus),
  true,
  'approved upload without publicationStatus shows pending publication modal',
);

assert.equal(
  isPendingApprovedUploadCandidate({ ...baseUpload, publicationStatus: '' }),
  true,
  'approved upload with empty publicationStatus shows pending publication modal',
);

assert.equal(
  isPendingApprovedUploadCandidate({ ...approvedWithoutPublicationStatus, publishStatus: 'discarded' }),
  false,
  'approved upload with only publishStatus discarded does not show modal',
);

assert.equal(
  isPendingApprovedUploadCandidate({ ...baseUpload, publicationStatus: 'draft' }),
  false,
  'approved upload with publicationStatus draft does not show modal',
);

assert.equal(
  isPendingApprovedUploadCandidate({ ...baseUpload, publicationPromptOpenedAt: { seconds: 30 } }),
  false,
  'opening editor hides future modal for the same upload',
);

assert.equal(
  isPendingApprovedUploadCandidate({ ...baseUpload, publicationStatus: 'discarded', discardedAt: { seconds: 31 } }),
  false,
  'discarded approved upload does not show modal',
);

assert.equal(
  isPendingApprovedUploadCandidate({ ...baseUpload, publicationStatus: 'published', publishedAt: { seconds: 32 } }),
  false,
  'published upload does not show modal',
);

assert.equal(
  selectPendingApprovedUploadReminder([
    { ...baseUpload, id: 'older', reviewDecisionAt: { seconds: 10 } },
    { ...baseUpload, id: 'newer', reviewDecisionAt: { seconds: 20 } },
  ])?.uploadId,
  'newer',
  'newest unresolved approved upload is selected first',
);
