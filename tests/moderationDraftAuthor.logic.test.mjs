import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModerationDraftAuthor } from '../src/utils/moderationDraftAuthor.js';

test('persisted review author wins over a later active-profile change', () => {
  assert.deepEqual(resolveModerationDraftAuthor({
    persistedDraft: { authorProfileId: 'managed-a', authorName: 'Studio A', authorOwnerUid: 'untrusted-other' },
    fallbackProfileId: 'managed-b',
    fallbackOwnerUid: 'owner-1',
    fallbackName: 'Studio B',
  }), {
    authorProfileId: 'managed-a',
    authorOwnerUid: 'owner-1',
    authorName: 'Studio A',
  });
});

test('new review drafts use the currently selected author identity', () => {
  assert.deepEqual(resolveModerationDraftAuthor({
    fallbackProfileId: 'managed-b',
    fallbackOwnerUid: 'owner-1',
    fallbackName: 'Studio B',
  }), {
    authorProfileId: 'managed-b',
    authorOwnerUid: 'owner-1',
    authorName: 'Studio B',
  });
});
