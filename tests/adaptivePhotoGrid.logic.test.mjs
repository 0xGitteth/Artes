import assert from 'node:assert/strict';
import {
  ADAPTIVE_PHOTO_GRID_MOBILE_MAX_VISUAL_ROWS,
  classifyAdaptivePhotoTile,
  getAdaptivePhotoGridItemLayout,
  getAdaptivePhotoGridItemStyle,
  getAdaptivePhotoMasonryLayout,
  getAdaptivePhotoTileSpan,
} from '../src/utils/adaptivePhotoGrid.js';

const post = (imageMeta) => ({ id: 'post', imageMeta });
const spanNumber = (style) => Number(String(style.gridRowEnd).replace('span ', ''));
const metrics = { columnWidth: 100, columnGap: 8, rowHeight: 4, rowGap: 4, columnCount: 3, containerWidth: 316 };

assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 0.75 })), 'portrait');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1 })), 'square');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.4 })), 'landscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.8 })), 'wideLandscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 3.2 })), 'panorama');
assert.equal(classifyAdaptivePhotoTile(post(null)), 'fallback');

assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 0.75 }), { availableColumns: 3 }).columnSpan, 1);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1 }), { availableColumns: 3 }).columnSpan, 1);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 3 }).columnSpan, 2);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.8 }), { availableColumns: 3 }).columnSpan, 3);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 }), { availableColumns: 3 }).columnSpan, 3);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.8 }), { availableColumns: 3 }).columns.mobile, 3);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 }), { availableColumns: 5 }).columnSpan, 3);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 }), { availableColumns: 6 }).columnSpan, 3);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 5 }).columnSpan, 2);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 6 }).columnSpan, 2);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.8 }), { availableColumns: 2 }).columnSpan, 2);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 1 }).columnSpan, 1);

const twoColumnLandscape = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 1.4 }), metrics);
const oneColumnLandscape = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 1.4 }), { ...metrics, columnSpan: 1 });
assert.equal(twoColumnLandscape.columnSpan, 2);
assert.ok(twoColumnLandscape.tileWidth > oneColumnLandscape.tileWidth);
assert.ok(twoColumnLandscape.rowSpan > oneColumnLandscape.rowSpan);

const mobileWide = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 0.2 }), metrics);
const mobileVisualCap = (metrics.columnWidth * ADAPTIVE_PHOTO_GRID_MOBILE_MAX_VISUAL_ROWS) + (metrics.rowGap * (ADAPTIVE_PHOTO_GRID_MOBILE_MAX_VISUAL_ROWS - 1));
assert.equal(mobileWide.mediaHeight, mobileVisualCap);
assert.ok(mobileWide.rowSpan <= Math.ceil((mobileVisualCap + metrics.rowGap) / (metrics.rowHeight + metrics.rowGap)));

const compactSensitiveStyle = getAdaptivePhotoGridItemStyle(post({ aspectRatio: 0.2 }), {
  ...metrics,
  minMediaHeight: mobileVisualCap + 80,
});
const compactRegularStyle = getAdaptivePhotoGridItemStyle(post({ aspectRatio: 0.2 }), metrics);
assert.ok(spanNumber(compactSensitiveStyle) > spanNumber(compactRegularStyle));

const mixedItems = [
  { id: 'landscape', post: post({ aspectRatio: 1.4 }) },
  { id: 'user', aspectRatio: 1, columnSpan: 1 },
  { id: 'square', post: post({ aspectRatio: 1 }) },
  { id: 'portrait', post: post({ aspectRatio: 0.55 }) },
  { id: 'panorama', post: post({ aspectRatio: 3.2 }) },
];
const masonry = getAdaptivePhotoMasonryLayout(mixedItems, {
  ...metrics,
  getPost: (item) => item.post || null,
  getAspectRatio: (item) => item.aspectRatio,
  getColumnSpan: (item) => item.columnSpan,
});

assert.equal(masonry[0].columnSpan, 2);
assert.equal(masonry[1].columnSpan, 1);
assert.equal(masonry[1].gridColumnStart, 3);
assert.equal(masonry[1].gridRowStart, 1);
assert.ok(masonry[2].gridRowStart < masonry[0].gridRowStart + masonry[0].rowSpan);
assert.equal(masonry[4].columnSpan, 3);
assert.ok(new Set(masonry.map((item) => item.rowSpan)).size > 2);

const desktopMasonry = getAdaptivePhotoMasonryLayout([
  { id: 'panorama', post: post({ aspectRatio: 3.2 }) },
  { id: 'landscape', post: post({ aspectRatio: 1.4 }) },
  { id: 'user', aspectRatio: 1, columnSpan: 1 },
  { id: 'square', post: post({ aspectRatio: 1 }) },
], {
  ...metrics,
  columnCount: 5,
  containerWidth: 532,
  getPost: (item) => item.post || null,
  getAspectRatio: (item) => item.aspectRatio,
  getColumnSpan: (item) => item.columnSpan,
});
assert.equal(desktopMasonry[0].columnSpan, 3);
assert.equal(desktopMasonry[1].columnSpan, 2);
assert.equal(desktopMasonry[2].columnSpan, 1);
assert.equal(desktopMasonry[0].gridColumnStart, 1);
assert.equal(desktopMasonry[1].gridColumnStart, 4);
assert.ok(desktopMasonry[2].gridRowStart < desktopMasonry[1].gridRowStart + desktopMasonry[1].rowSpan);

console.log('adaptivePhotoGrid logic tests passed');
