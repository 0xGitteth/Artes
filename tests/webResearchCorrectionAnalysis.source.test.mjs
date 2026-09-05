import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/analyzeWebResearchReviewCorrections.js', import.meta.url), 'utf8');

test('correction analysis compares original assistant prefill with authoritative human review', () => {
  assert.match(source, /moderation-web-research-assistant-prefill-v1\.json/);
  assert.match(source, /labels\.reviewed\.json/);
  assert.match(source, /originalCorrections/);
  assert.match(source, /human_review_is_authoritative/);
});

test('correction analysis distinguishes policy changes from confidence metadata', () => {
  assert.match(source, /detectorPolicyChanged/);
  assert.match(source, /detectorMetadataChanged/);
  assert.match(source, /nudityTransitions/);
  assert.match(source, /sexualContextTransitions/);
});

test('correction analysis stays offline research only', () => {
  assert.match(source, /researchOnly: true/);
  assert.match(source, /trainingReady: false/);
  assert.match(source, /productionEligible: false/);
  assert.match(source, /runtimeEligible: false/);
  assert.doesNotMatch(source, /firebase|gcloud|artes-media-app|artes-staging/);
});
