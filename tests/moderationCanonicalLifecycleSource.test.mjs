import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const policySource = fs.readFileSync(new URL('../functions/userModerationActionPolicy.js', import.meta.url), 'utf8');
const correctionSource = fs.readFileSync(new URL('../functions/uploaderCorrection.js', import.meta.url), 'utf8');
const retentionSource = fs.readFileSync(new URL('../functions/moderationPreviewStorage.js', import.meta.url), 'utf8');

test('server publication and correction decisions use the canonical lifecycle resolver', () => {
  assert.match(policySource, /isUploadLifecyclePublishable/);
  assert.match(policySource, /isUploadLifecycleDraftable/);
  assert.match(policySource, /isUploadLifecyclePromptManageable/);
  assert.doesNotMatch(policySource, /const reviewStatus =/);
  assert.doesNotMatch(policySource, /APPROVED_PUBLICATION_STATUSES/);
  assert.match(correctionSource, /isUploadLifecycleCorrectionPending/);
  assert.doesNotMatch(correctionSource, /BLOCKED_OUTCOMES/);
  assert.doesNotMatch(correctionSource, /BLOCKED_CLASSIFICATIONS/);
});

test('authoritative upload transitions persist canonical moderation and publication states', () => {
  assert.match(indexSource, /moderationState: resolveModerationStateForResult\(/);
  assert.match(indexSource, /moderationState: MODERATION_STATES\.reviewPending/);
  assert.match(indexSource, /moderationState: MODERATION_STATES\.superseded/);
  assert.match(indexSource, /MODERATION_STATES\.correctionPending/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.pending/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.draft/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.published/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.discarded/);
  assert.match(indexSource, /publicationState: PUBLICATION_STATES\.expired/);
});

test('user actions use canonical lifecycle helpers in preflight and authoritative transaction', () => {
  const start = indexSource.indexOf('export const userModerationAction');
  const end = indexSource.indexOf('export const getContributorByAliasCallable', start);
  const actionSource = indexSource.slice(start, end);
  assert.match(actionSource, /canPublishUpload\(upload\)/);
  assert.match(actionSource, /canSaveDraftUpload\(upload\)/);
  assert.match(actionSource, /canManageApprovedUploadPrompt\(upload\)/);
  assert.match(actionSource, /canPublishUpload\(latestUpload\)/);
  assert.match(actionSource, /canSaveDraftUpload\(latestUpload\)/);
  assert.match(actionSource, /canManageApprovedUploadPrompt\(latestUpload\)/);
  assert.match(actionSource, /latestPublicationLifecycle = resolveUploadPublicationState\(latestUpload\)/);
  assert.match(actionSource, /latestPublicationLifecycle\.state === PUBLICATION_STATES\.published/);
  assert.doesNotMatch(actionSource, /upload\?\.reviewStatus !== 'approved'/);
  assert.doesNotMatch(actionSource, /latestUpload\?\.reviewStatus !== 'approved'/);
  assert.doesNotMatch(actionSource, /initialPublicationStatus/);
  assert.doesNotMatch(actionSource, /latestPublicationStatus/);
});

test('correction rejection mirrors its newly active operational review case', () => {
  const start = indexSource.indexOf('if (correctionPlan)');
  const end = indexSource.indexOf('if (publicationPlan)', start);
  const correctionMutation = indexSource.slice(start, end);
  assert.match(correctionMutation, /MODERATION_STATES\.reviewPending/);
  assert.match(correctionMutation, /reviewStatus: action === 'acceptCorrection' \? 'approved' : 'inReview'/);
  assert.match(correctionMutation, /status: 'inReview'/);
});

test('media retention consumes canonical lifecycle while active-review retention stays case-owned', () => {
  assert.match(retentionSource, /resolveUploadPublicationState\(uploadData\)/);
  assert.match(retentionSource, /resolveUploadModerationState\(uploadData\)/);
  assert.match(retentionSource, /publication\.state === PUBLICATION_STATES\.published/);
  assert.match(retentionSource, /normalizedReviewCaseStatuses\.includes\('inReview'\)/);
  assert.match(retentionSource, /moderationMustResolve/);
});


test('discard cleanup trigger follows canonical publication state without bypassing media cleanup authority', () => {
  const start = indexSource.indexOf('export const onModerationUploadDiscarded');
  const end = indexSource.indexOf('export const onProductionPostDeleted', start);
  const triggerSource = indexSource.slice(start, end);
  assert.match(triggerSource, /resolveUploadPublicationState\(before\)/);
  assert.match(triggerSource, /resolveUploadPublicationState\(after\)/);
  assert.match(triggerSource, /afterPublication\.state !== PUBLICATION_STATES\.discarded/);
  assert.match(triggerSource, /afterMediaState && afterMediaState !== 'ready'/);
  assert.doesNotMatch(triggerSource, /beforeStatus/);
  assert.doesNotMatch(triggerSource, /afterStatus/);
});
