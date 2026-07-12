import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getQuickProfilePreviewPosts } from '../src/utils/quickProfilePreview.js';

const post = (id, likes = 0, extra = {}) => ({ id, likes, imageUrl: `${id}.jpg`, ...extra });
const posts = [post('latest-1', 3), post('manual-1', 1), post('best-1', 30), post('manual-2', 20), post('latest-5', 10)];

assert.deepEqual(
  getQuickProfilePreviewPosts({ posts, previewMode: 'latest' }).map((item) => item.id),
  ['latest-1', 'manual-1', 'best-1'],
  'Latest quick profile preview should keep source order and cap at three posts',
);

assert.deepEqual(
  getQuickProfilePreviewPosts({ posts, previewMode: 'best' }).map((item) => item.id),
  ['best-1', 'manual-2', 'latest-5'],
  'Best quick profile preview should select the three highest-liked visible posts',
);

assert.deepEqual(
  getQuickProfilePreviewPosts({ posts, previewMode: 'manual', manualIds: ['manual-2', 'manual-1', 'best-1', 'latest-1'] }).map((item) => item.id),
  ['manual-2', 'manual-1', 'best-1'],
  'Manual quick profile preview should respect saved quickProfilePostIds order and cap at three posts',
);

assert.deepEqual(
  getQuickProfilePreviewPosts({ posts, previewMode: 'manual', manualIds: ['missing-a', 'missing-b'] }).map((item) => item.id),
  ['latest-1', 'manual-1', 'best-1'],
  'Manual quick profile preview should fall back to latest when selected posts are missing',
);

assert.deepEqual(
  getQuickProfilePreviewPosts({
    posts,
    previewMode: 'manual',
    manualIds: ['manual-2', 'best-1', 'latest-1'],
    getContentPreference: (item) => (item.id === 'best-1' ? 'hideFeed' : 'show'),
  }).map((item) => item.id),
  ['manual-2', 'latest-1'],
  'Manual quick profile preview should skip hidden selected posts without reordering available selections',
);

const source = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const userPreviewModalSource = source.slice(source.indexOf('function UserPreviewModal'), source.indexOf('function ShadowProfileModal'));
assert.ok(userPreviewModalSource.includes('data-quick-profile-preview-grid'), 'UserPreviewModal should render the fixed quick profile preview grid');
assert.ok(!userPreviewModalSource.includes('<AdaptivePhotoGrid'), 'UserPreviewModal should not render preview posts through AdaptivePhotoGrid');
assert.ok(!userPreviewModalSource.includes('useAdaptivePhotoGridMetrics'), 'UserPreviewModal should not use adaptive grid metrics');
assert.match(source, /<AdaptivePhotoGrid[\s\S]*posts=\{portfolioPosts\}/, 'Portfolio grids may still use AdaptivePhotoGrid');
assert.match(source, /<AdaptivePhotoGrid[\s\S]*posts=\{externalProfilePosts\}/, 'Full public profile grids may still use AdaptivePhotoGrid');

console.log('quickProfilePreview tests passed');
