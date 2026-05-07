import assert from 'node:assert/strict';
import { classifyAdaptivePhotoTile, getAdaptivePhotoTileSpan } from '../src/utils/adaptivePhotoGrid.js';

const post = (imageMeta) => ({ id: 'post', imageMeta });

assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 0.75 })), 'portrait');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1 })), 'square');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.8 })), 'landscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 3.2 })), 'panorama');
assert.equal(classifyAdaptivePhotoTile(post(null)), 'fallback');

const portraitSpan = getAdaptivePhotoTileSpan(post({ aspectRatio: 0.75 })).columns.desktop;
const landscapeSpan = getAdaptivePhotoTileSpan(post({ aspectRatio: 1.8 })).columns.desktop;
const panoramaSpan = getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 })).columns.desktop;
assert.ok(landscapeSpan > portraitSpan);
assert.ok(panoramaSpan > landscapeSpan);

console.log('adaptivePhotoGrid logic tests passed');
