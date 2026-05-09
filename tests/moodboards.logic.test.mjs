import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_MOODBOARD_TITLE,
  MOODBOARD_TITLE_MAX_LENGTH,
  buildMoodboardItemPayload,
  canShowMoodboardsTab,
  normalizeMoodboardTitle,
  resolveMoodboardItemPost,
  resolveMoodboardItemPosts,
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

const livePost = { id: 'post-2', imageUrl: 'https://example.test/live.jpg', title: 'Live post', authorId: 'author-2' };
const liveItem = { postId: 'post-2', postSnapshot: { imageUrl: 'https://example.test/snapshot.jpg', title: 'Snapshot post', authorId: 'author-snapshot' } };
assert.equal(resolveMoodboardItemPost(liveItem, [livePost]), livePost, 'moodboard item resolves to live post when loaded posts include postId');

const fallbackItem = { postId: 'missing-post', postSnapshot: { imageUrl: 'https://example.test/fallback.jpg', title: 'Fallback post', authorId: 'author-3' } };
assert.deepEqual(resolveMoodboardItemPost(fallbackItem, [livePost]), {
  id: 'missing-post',
  imageUrl: 'https://example.test/fallback.jpg',
  title: 'Fallback post',
  authorId: 'author-3',
  moodboardUnavailable: true,
}, 'missing live post falls back to safe unavailable snapshot');
assert.deepEqual(resolveMoodboardItemPosts([liveItem, fallbackItem, { postId: 'gone' }], [livePost]), [
  livePost,
  {
    id: 'missing-post',
    imageUrl: 'https://example.test/fallback.jpg',
    title: 'Fallback post',
    authorId: 'author-3',
    moodboardUnavailable: true,
  },
], 'moodboard item list keeps live posts and safe snapshot fallbacks only');

const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
assert.match(appSource, /view === 'profile'[\s\S]*?<ImmersiveProfile[\s\S]*?currentUserId=\{authUser\?\.uid\}/, 'own profile ImmersiveProfile call passes authUser uid as currentUserId');
assert.match(appSource, /canShowMoodboardsTab\(\{ profileUid: profileUserId, currentUserId \}\)/, 'Moodboards tab gate still depends on profileUid and currentUserId');
assert.match(appSource, /<MoodboardsSection[\s\S]*?posts=\{allPostsForMoodboards\}/, 'MoodboardsSection receives broader loaded posts rather than profile-filtered visiblePosts');
assert.doesNotMatch(appSource, /<MoodboardsSection[\s\S]*?posts=\{visiblePosts\}/, 'MoodboardsSection no longer receives profile-filtered visiblePosts');

const firebaseSource = readFileSync(new URL('../src/firebase.js', import.meta.url), 'utf8');
const batchLimitMatch = firebaseSource.match(/const MOODBOARD_DELETE_BATCH_LIMIT = (\d+);/);
assert.ok(batchLimitMatch, 'deleteMoodboard declares a moodboard delete batch limit');
assert.ok(Number(batchLimitMatch[1]) < 500, 'deleteMoodboard chunk size stays below Firestore 500 write batch limit');
assert.match(firebaseSource, /for \(let index = 0; index < itemDocs\.length; index \+= MOODBOARD_DELETE_BATCH_LIMIT\)[\s\S]*?await batch\.commit\(\);[\s\S]*?const moodboardBatch = writeBatch/, 'deleteMoodboard commits item delete batches before deleting parent moodboard');
assert.match(firebaseSource, /moodboardBatch\.delete\(getUserMoodboardRef\(uid, moodboardId\)\);[\s\S]*?await moodboardBatch\.commit\(\);/, 'deleteMoodboard deletes parent moodboard in a separate final batch');

console.log('moodboards logic tests passed');
