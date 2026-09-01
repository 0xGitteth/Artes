import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const indexSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');

test('persisted correction publication carries normal post metadata parity', () => {
  assert.match(indexSource, /contributorIds: publicationPlan\.contributorIds/);
  assert.match(indexSource, /publicationPlan\.imageMeta \? \{ imageMeta: publicationPlan\.imageMeta \}/);
  assert.match(indexSource, /publicationPlan\.correction \? \{ correction: publicationPlan\.correction \}/);
});

test('accepted correction stores the current user draft before becoming resumable', () => {
  assert.match(indexSource, /\.\.\.\(postDraftFromBody && typeof postDraftFromBody === 'object' \? postDraftFromBody : \{\}\)/);
  assert.match(appSource, /action: 'acceptCorrection',[\s\S]*postDraft: \{[\s\S]*pendingInviteContributors/);
  assert.match(appSource, /setPendingInviteContributors\(Array\.isArray\(draft\.pendingInviteContributors\)/);
});

test('both publication routes use the shared claim-invite finalizer', () => {
  const matches = appSource.match(/handlePendingClaimInvitesAfterPublish\(/g) || [];
  assert.equal(matches.length, 2, `expected both publication routes to call the finalizer, found ${matches.length}`);
  assert.match(appSource, /const persistedPostId = data\?\.postId \|\| persistedModerationPublicationUploadId/);
});
