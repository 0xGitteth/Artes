import assert from 'node:assert/strict';
import { pickPreferredDisplayName, resolvePostAuthorDisplayName } from '../src/utils/profileDisplayName.js';

const firestoreName = pickPreferredDisplayName('Stored Name', 'Google Name');
assert.equal(firestoreName, 'Stored Name', 'Existing app displayName should beat Google displayName');

const fallbackGoogleName = pickPreferredDisplayName('', null, 'Google Name');
assert.equal(fallbackGoogleName, 'Google Name', 'Google displayName should only be used as fallback');

const resolvedFromPublicUsers = resolvePostAuthorDisplayName({
  post: { authorId: 'u1', authorName: 'Old Cached Name' },
  users: [{ uid: 'u1', displayName: 'Current Public Name' }],
});
assert.equal(resolvedFromPublicUsers, 'Current Public Name', 'Post render should prefer live public user displayName');

const resolvedFallbackFromPost = resolvePostAuthorDisplayName({
  post: { authorId: 'u2', authorName: 'Stored Post Name' },
  users: [{ uid: 'u1', displayName: 'Another User' }],
});
assert.equal(resolvedFallbackFromPost, 'Stored Post Name', 'Post render should fallback to stored post authorName');

console.log('PASS profileDisplayName.logic.test');
