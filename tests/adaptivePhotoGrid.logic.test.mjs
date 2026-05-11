import assert from 'node:assert/strict';
import { classifyAdaptivePhotoTile, getAdaptivePhotoTileSpan, getAdaptivePhotoGridItemStyle } from '../src/utils/adaptivePhotoGrid.js';

const post = (imageMeta) => ({ id: 'post', imageMeta });

assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 0.75 })), 'portrait');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1 })), 'square');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.8 })), 'landscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 3.2 })), 'panorama');
assert.equal(classifyAdaptivePhotoTile(post(null)), 'fallback');

// recovered aspect ratio should override fallback classification
assert.equal(classifyAdaptivePhotoTile(post(null), 1.8), 'landscape');

const portraitSpan = getAdaptivePhotoTileSpan(post({ aspectRatio: 0.75 })).columns.desktop;
const landscapeSpan = getAdaptivePhotoTileSpan(post({ aspectRatio: 1.8 })).columns.desktop;
const panoramaSpan = getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 })).columns.desktop;
assert.ok(landscapeSpan >= portraitSpan);
assert.ok(panoramaSpan > landscapeSpan);

console.log('adaptivePhotoGrid logic tests passed');

// Row span computation with aspectRatio override
const testPost = post(null);
const style = getAdaptivePhotoGridItemStyle(testPost, { columnWidth: 100, columnGap: 8, rowHeight: 4, rowGap: 4, aspectRatio: 2, columnSpan: 2, footerHeight: 0 });
// tileWidth = (100*2) + (8*1) = 208, mediaHeight = 208/2 = 104, totalHeight = 104
// effectiveRowUnit = 4 + 4 = 8 -> rowSpan = ceil((104 + 4) / 8) = ceil(108/8) = 14
assert.equal(style.gridRowEnd, 'span 14');

console.log('adaptivePhotoGrid derived-style tests passed');
