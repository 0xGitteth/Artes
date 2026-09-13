import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModerationPublicationAuthorProfile } from '../moderationPublicationAuthor.js';

test('personal publication author validates without a managed profile document', () => {
  const result = validateModerationPublicationAuthorProfile({ userId: 'user-1', requestedProfileId: 'user-1' });
  assert.equal(result.ok, true);
  assert.equal(result.author.isPersonal, true);
  assert.equal(result.author.profileId, 'user-1');
});

test('managed publication author requires a live owned active supported profile', () => {
  const valid = validateModerationPublicationAuthorProfile({
    userId: 'user-1',
    requestedProfileId: 'profile-1',
    profileExists: true,
    profileData: { ownerUid: 'user-1', status: 'active', type: 'agency', displayName: 'Agency' },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.author.displayName, 'Agency');

  for (const input of [
    { profileExists: false, profileData: null, code: 'publication_author_profile_missing' },
    { profileExists: true, profileData: { ownerUid: 'user-2', status: 'active', type: 'agency' }, code: 'publication_author_owner_mismatch' },
    { profileExists: true, profileData: { ownerUid: 'user-1', status: 'inactive', type: 'agency' }, code: 'publication_author_profile_inactive' },
    { profileExists: true, profileData: { ownerUid: 'user-1', status: 'active', type: 'person' }, code: 'publication_author_profile_inactive' },
  ]) {
    const result = validateModerationPublicationAuthorProfile({
      userId: 'user-1',
      requestedProfileId: 'profile-1',
      profileExists: input.profileExists,
      profileData: input.profileData,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, input.code);
  }
});
