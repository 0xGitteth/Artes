import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');

test('accepted exact-match correction publishes through the persisted upload endpoint', () => {
  assert.match(source, /resolvePersistedModerationPublicationUploadId/);
  assert.match(source, /acceptedModeratorCorrection/);
  assert.match(source, /uploadId:\s*persistedModerationPublicationUploadId/);
  assert.match(source, /action:\s*'repairPublished'/);
  assert.match(source, /appliedTriggers:\s*finalAppliedTriggers/);
});

test('rejecting a correction immediately switches the client to terminal review state', () => {
  assert.match(source, /setCorrectionAcceptedAt\(null\)/);
  assert.match(source, /setOutcome\('review'\)/);
  assert.match(source, /setShouldReview\(true\)/);
  assert.match(source, /type:\s*TAXONOMY_CORRECTION_TYPES\.REVIEW_REQUIRED/);
  assert.match(source, /requiresUserAcceptance:\s*false/);
  assert.match(source, /requiresModeratorReview:\s*true/);
});

test('resume correction acceptance refreshes persisted state and still routes by upload id', () => {
  assert.match(source, /setResumeUpload\(\(previous\) => \(previous\?\.id === correctionUploadId/);
  assert.match(source, /moderationState: 'allowed', publicationState: 'pending', requiresUploaderAcceptance: false/);
  assert.doesNotMatch(source, /moderationState: 'allowed', publicationState: 'pending', reviewStatus: 'approved', publicationStatus: 'correction_accepted'/);
  assert.match(source, /currentModerationUploadId = String\(moderationData\?\.uploadId \|\| reviewUploadId \|\| resumeUpload\?\.id/);
});

test('client no longer submits image identity to persisted moderation actions', () => {
  const acceptStart = source.indexOf("action: 'acceptCorrection'");
  const acceptEnd = source.indexOf('const data = await response.json', acceptStart);
  assert.equal(source.slice(acceptStart, acceptEnd).includes('imageUrl: image'), false);
  const repairStart = source.indexOf("action: 'repairPublished'");
  const repairEnd = source.indexOf('const data = await response.json', repairStart);
  assert.equal(source.slice(repairStart, repairEnd).includes('imageUrl: image'), false);
});
