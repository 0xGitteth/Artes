import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODERATION_PRODUCTION_PROJECT_ID,
  assertModerationProductionAuditProject,
  assertProductionAuditReadOnlyOptions,
  assertProductionCoverageAuditReadOnlyOptions,
} from '../moderationProductionAuditGuard.js';

test('production audit guard only allows the Artes production project', () => {
  assert.equal(
    assertModerationProductionAuditProject(MODERATION_PRODUCTION_PROJECT_ID),
    MODERATION_PRODUCTION_PROJECT_ID,
  );
  assert.throws(
    () => assertModerationProductionAuditProject('artes-staging'),
    /production_audit_project_forbidden/,
  );
  assert.throws(
    () => assertModerationProductionAuditProject(''),
    /production_audit_project_missing/,
  );
});

test('production audit options are limited to moderationExamples and bounded reads', () => {
  assert.deepEqual(
    assertProductionAuditReadOnlyOptions({ limit: 500 }),
    { limit: 500, collection: 'moderationExamples' },
  );
  assert.throws(
    () => assertProductionAuditReadOnlyOptions({ limit: 500, collection: 'users' }),
    /production_audit_collection_forbidden/,
  );
  assert.throws(
    () => assertProductionAuditReadOnlyOptions({ limit: 5001 }),
    /production_audit_invalid_limit/,
  );
});

test('historical coverage audit is bounded and restricted to reviewCases plus moderationExamples', () => {
  assert.deepEqual(
    assertProductionCoverageAuditReadOnlyOptions({ limit: 500 }),
    { limit: 500, collections: ['reviewCases', 'moderationExamples'] },
  );
  assert.throws(
    () => assertProductionCoverageAuditReadOnlyOptions({ limit: 0 }),
    /production_coverage_audit_invalid_limit/,
  );
  assert.throws(
    () => assertProductionCoverageAuditReadOnlyOptions({ limit: 5001 }),
    /production_coverage_audit_invalid_limit/,
  );
});
