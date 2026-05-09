import assert from 'node:assert/strict';
import {
  DEFAULT_MOODBOARD_TITLE,
  MOODBOARD_TITLE_MAX_LENGTH,
  buildMoodboardItemPayload,
  canShowMoodboardsTab,
  normalizeMoodboardTitle,
} from '../src/utils/moodboards.js';

assert.equal(normalizeMoodboardTitle(''), DEFAULT_MOODBOARD_TITLE, 'empty title falls back to default title');
assert.equal(normalizeMoodboardTitle('  Styling   ideeën  '), 'Styling ideeën', 'title trims and collapses whitespace');
assert.equal(normalizeMoodboardTitle('x'.repeat(120)).length, MOODBOARD_TITLE_MAX_LENGTH, 'title length is limited');

const payload = buildMoodboardItemPayload({ id: 'post-1', imageUrl: 'https://example.test/image.jpg', title: 'Shoot', authorId: 'author-1', privateField: 'nope' }, 'owner-1');
assert.deepEqual(payload, {
  postId: 'post-1',
  ownerUid: 'owner-1',
  moodboardId: '',
  postSnapshot: {
    imageUrl: 'https://example.test/image.jpg',
    title: 'Shoot',
    authorId: 'author-1',
  },
}, 'item payload uses post id and only safe snapshot fields');

assert.equal(canShowMoodboardsTab({ profileUid: 'user-1', currentUserId: 'user-1' }), true, 'own profile can show Moodboards tab');
assert.equal(canShowMoodboardsTab({ profileUid: 'user-1', currentUserId: 'user-2' }), false, 'other profiles cannot show Moodboards tab');
assert.equal(canShowMoodboardsTab({ profileUid: 'user-1', currentUserId: null }), false, 'public viewer cannot show Moodboards tab');

console.log('moodboards logic tests passed');
