import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/prepareContributorAuthorizedModerationIntake.js', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/moderation-contributor-authorized-intake-v1.md', import.meta.url), 'utf8');

test('contributor intake is local-only and requires explicit authorization confirmation', () => {
  assert.match(source, /\.tmp', 'moderation-contributor-images'/);
  assert.match(source, /\.tmp', 'moderation-contributor-intake'/);
  assert.match(source, /--confirm-authorized/);
  assert.match(source, /explicit_authorization_confirmation_required/);
  assert.doesNotMatch(source, /https:\/\//);
  assert.doesNotMatch(source, /fetch\(|child_process|exec\(|spawn\(/);
});

test('contributor intake requires rights, ML-use, adult and model-rights attestations', () => {
  for (const token of [
    'rightsHolderConfirmed',
    'moderationMlUseAuthorized',
    'allRecognizablePeopleAdultsConfirmed',
    'modelPersonalityRightsConfirmed',
    'authorizationScope',
  ]) {
    assert.match(source, new RegExp(token));
    assert.match(docs, new RegExp(token));
  }
});

test('source pool is mandatory before images can enter later leakage-aware curation', () => {
  assert.match(source, /SOURCE_POOL_PATTERN/);
  assert.match(source, /invalid_source_pool_id/);
  assert.match(source, /sourcePoolRequired: true/);
  assert.match(docs, /sourcePoolId/);
});

test('intake never infers labels or promotes training readiness', () => {
  assert.match(source, /detectorLabel: null/);
  assert.match(source, /labelStatus: 'pending_human_review'/);
  assert.match(source, /semanticClusterApproved: false/);
  assert.match(source, /trainingReady: false/);
  assert.match(source, /detectorLabelsInferred: false/);
  assert.doesNotMatch(source, /trainingReady: true/);
});

test('image intake is bounded and top-level only', () => {
  assert.match(source, /MAX_IMAGE_BYTES = 15 \* 1024 \* 1024/);
  assert.match(source, /SUPPORTED_EXTENSIONS/);
  assert.match(source, /readdir\(IMAGE_DIR, \{ withFileTypes: true \}\)/);
  assert.doesNotMatch(source, /recursive:\s*true/);
});
