import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTES_PRODUCTION_PROJECT_ID,
  ARTES_STAGING_PROJECT_ID,
  assertModerationLearningStagingProject,
  getModerationLearningProjectDecision,
} from '../moderationLearningProjectGuard.js';

test('moderation learning allows only the dedicated staging project', () => {
  assert.equal(assertModerationLearningStagingProject(ARTES_STAGING_PROJECT_ID), ARTES_STAGING_PROJECT_ID);
  assert.deepEqual(getModerationLearningProjectDecision(ARTES_STAGING_PROJECT_ID), {
    allowed: true,
    projectId: ARTES_STAGING_PROJECT_ID,
    reason: null,
  });
});

test('moderation learning explicitly rejects the Artes production project', () => {
  const decision = getModerationLearningProjectDecision(ARTES_PRODUCTION_PROJECT_ID);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'production_project_forbidden');
  assert.throws(
    () => assertModerationLearningStagingProject(ARTES_PRODUCTION_PROJECT_ID),
    (error) => error?.code === 'production_project_forbidden',
  );
});

test('moderation learning fails closed for missing or unexpected project ids', () => {
  assert.equal(getModerationLearningProjectDecision('').reason, 'missing_project_id');
  assert.equal(getModerationLearningProjectDecision('some-other-project').reason, 'non_staging_project_forbidden');
  assert.throws(
    () => assertModerationLearningStagingProject('some-other-project'),
    (error) => error?.code === 'non_staging_project_forbidden',
  );
});
