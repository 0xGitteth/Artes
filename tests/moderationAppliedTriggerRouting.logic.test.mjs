import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePolicyAppliedTriggersForPublication } from '../src/utils/moderationAppliedTriggerRouting.js';

test('moderation response policy labels are authoritative even when empty', () => {
  assert.deepEqual(resolvePolicyAppliedTriggersForPublication({
    moderationData: { policyAppliedTriggers: [] , appliedTriggers: ['uploaderTag'] },
    policyAppliedTriggers: ['oldPolicy'],
  }), []);
});

test('stored policy labels are used without falling back to flattened applied tags', () => {
  assert.deepEqual(resolvePolicyAppliedTriggersForPublication({
    moderationData: null,
    policyAppliedTriggers: [{ trigger: 'selfHarm', source: 'policySensitive' }],
  }), [{ trigger: 'selfHarm', source: 'policySensitive' }]);
});
