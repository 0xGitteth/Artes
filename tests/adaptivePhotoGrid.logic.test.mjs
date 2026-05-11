import assert from 'node:assert/strict';
import {
  classifyAdaptivePhotoTile,
  getAdaptivePhotoGridItemLayout,
  getAdaptivePhotoGridItemStyle,
  getAdaptivePhotoMasonryLayout,
  getAdaptivePhotoTileSpan,
} from '../src/utils/adaptivePhotoGrid.js';

const post = (imageMeta) => ({ id: 'post', imageMeta });
const spanNumber = (style) => Number(String(style.gridRowEnd).replace('span ', ''));
const metrics = { columnWidth: 24, columnGap: 8, rowHeight: 4, rowGap: 4, columnCount: 12, containerWidth: 376 };

assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 0.35 })), 'veryNarrowPortrait');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 0.75 })), 'portrait');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1 })), 'square');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.4 })), 'landscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.8 })), 'wideLandscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 3.2 })), 'panorama');
assert.equal(classifyAdaptivePhotoTile(post(null)), 'fallback');

assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 0.75 }), { availableColumns: 12 }).columnSpan, 4);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1 }), { availableColumns: 12 }).columnSpan, 4);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 0.35 }), { availableColumns: 12 }).columnSpan, 3);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 12 }).columnSpan, 6);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.8 }), { availableColumns: 12 }).columnSpan, 8);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 }), { availableColumns: 12 }).columnSpan, 9);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 4 }), { availableColumns: 12 }).columnSpan, 12);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 4 }), { availableColumns: 24 }).columnSpan, 24);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 0.35 }), { availableColumns: 16 }).columnSpan, 4);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 20 }).columnSpan, 10);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 }), { availableColumns: 24 }).columnSpan, 18);

const normalPortrait = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 0.75 }), metrics);
const narrowPortrait = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 0.35 }), metrics);
const landscape = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 1.4 }), metrics);
const panorama = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 4 }), metrics);
assert.ok(normalPortrait.tileWidth > narrowPortrait.tileWidth);
assert.ok(landscape.tileWidth > normalPortrait.tileWidth);
assert.ok(panorama.tileWidth <= metrics.containerWidth);
assert.equal(panorama.columnSpan, metrics.columnCount);

const veryTall = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 0.08 }), metrics);
assert.equal(veryTall.shouldFitInsideFrame, true);
assert.ok(veryTall.mediaHeight < veryTall.naturalMediaHeight);
assert.ok(veryTall.mediaHeight <= metrics.containerWidth * 1.25);
assert.equal(veryTall.frameStyle.height, `${veryTall.mediaHeight}px`);

const rowSpanStyle = getAdaptivePhotoGridItemStyle(post({ aspectRatio: 0.75 }), metrics);
const expectedNormalRowSpan = Math.ceil((normalPortrait.mediaHeight + metrics.rowGap) / (metrics.rowHeight + metrics.rowGap));
assert.equal(spanNumber(rowSpanStyle), expectedNormalRowSpan);

const compactSensitiveStyle = getAdaptivePhotoGridItemStyle(post({ aspectRatio: 0.75 }), {
  ...metrics,
  minMediaHeight: normalPortrait.mediaHeight + 80,
});
assert.ok(spanNumber(compactSensitiveStyle) > spanNumber(rowSpanStyle));

const mixedItems = [
  { id: 'landscape', post: post({ aspectRatio: 1.4 }) },
  { id: 'user', aspectRatio: 1, columnSpan: 3 },
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

assert.equal(masonry[0].columnSpan, 6);
assert.equal(masonry[1].columnSpan, 3);
assert.equal(masonry[1].gridRowStart, 1);
assert.ok(masonry[2].gridRowStart < masonry[0].gridRowStart + masonry[0].rowSpan);
assert.ok(new Set(masonry.map((item) => item.rowSpan)).size > 2);

const desktopMasonry = getAdaptivePhotoMasonryLayout([
  { id: 'panorama', post: post({ aspectRatio: 3.2 }) },
  { id: 'landscape', post: post({ aspectRatio: 1.4 }) },
  { id: 'user', aspectRatio: 1, columnSpan: 4 },
  { id: 'square', post: post({ aspectRatio: 1 }) },
], {
  ...metrics,
  columnCount: 20,
  containerWidth: 632,
  getPost: (item) => item.post || null,
  getAspectRatio: (item) => item.aspectRatio,
  getColumnSpan: (item) => item.columnSpan,
});
assert.equal(desktopMasonry[0].columnSpan, 15);
assert.equal(desktopMasonry[1].columnSpan, 10);
assert.equal(desktopMasonry[2].columnSpan, 4);
assert.ok(desktopMasonry[2].gridRowStart < desktopMasonry[1].gridRowStart + desktopMasonry[1].rowSpan);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 0.75 }), { availableColumns: 12 }).columnSpan, 4);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1 }), { availableColumns: 12 }).columnSpan, 4);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 0.35 }), { availableColumns: 12 }).columnSpan, 3);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 12 }).columnSpan, 6);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.8 }), { availableColumns: 12 }).columnSpan, 8);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 }), { availableColumns: 12 }).columnSpan, 9);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 4 }), { availableColumns: 12 }).columnSpan, 12);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 4 }), { availableColumns: 24 }).columnSpan, 24);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 0.35 }), { availableColumns: 16 }).columnSpan, 4);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 1.4 }), { availableColumns: 20 }).columnSpan, 10);
assert.equal(getAdaptivePhotoTileSpan(post({ aspectRatio: 3.2 }), { availableColumns: 24 }).columnSpan, 18);

const normalPortrait = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 0.75 }), metrics);
const narrowPortrait = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 0.35 }), metrics);
const landscape = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 1.4 }), metrics);
const panorama = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 4 }), metrics);
assert.ok(normalPortrait.tileWidth > narrowPortrait.tileWidth);
assert.ok(landscape.tileWidth > normalPortrait.tileWidth);
assert.ok(panorama.tileWidth <= metrics.containerWidth);
assert.equal(panorama.columnSpan, metrics.columnCount);

const veryTall = getAdaptivePhotoGridItemLayout(post({ aspectRatio: 0.08 }), metrics);
assert.equal(veryTall.shouldFitInsideFrame, true);
assert.ok(veryTall.mediaHeight < veryTall.naturalMediaHeight);
assert.ok(veryTall.mediaHeight <= metrics.containerWidth * 1.25);
assert.equal(veryTall.frameStyle.height, `${veryTall.mediaHeight}px`);

const rowSpanStyle = getAdaptivePhotoGridItemStyle(post({ aspectRatio: 0.75 }), metrics);
const expectedNormalRowSpan = Math.ceil((normalPortrait.mediaHeight + metrics.rowGap) / (metrics.rowHeight + metrics.rowGap));
assert.equal(spanNumber(rowSpanStyle), expectedNormalRowSpan);

const compactSensitiveStyle = getAdaptivePhotoGridItemStyle(post({ aspectRatio: 0.75 }), {
  ...metrics,
  minMediaHeight: normalPortrait.mediaHeight + 80,
});
assert.ok(spanNumber(compactSensitiveStyle) > spanNumber(rowSpanStyle));

const mixedItems = [
  { id: 'landscape', post: post({ aspectRatio: 1.4 }) },
  { id: 'user', aspectRatio: 1, columnSpan: 3 },
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

assert.equal(masonry[0].columnSpan, 6);
assert.equal(masonry[1].columnSpan, 3);
assert.equal(masonry[1].gridRowStart, 1);
assert.ok(masonry[2].gridRowStart < masonry[0].gridRowStart + masonry[0].rowSpan);
assert.ok(new Set(masonry.map((item) => item.rowSpan)).size > 2);

const desktopMasonry = getAdaptivePhotoMasonryLayout([
  { id: 'panorama', post: post({ aspectRatio: 3.2 }) },
  { id: 'landscape', post: post({ aspectRatio: 1.4 }) },
  { id: 'user', aspectRatio: 1, columnSpan: 4 },
  { id: 'square', post: post({ aspectRatio: 1 }) },
], {
  ...metrics,
  columnCount: 20,
  containerWidth: 632,
  getPost: (item) => item.post || null,
  getAspectRatio: (item) => item.aspectRatio,
  getColumnSpan: (item) => item.columnSpan,
});
assert.equal(desktopMasonry[0].columnSpan, 15);
assert.equal(desktopMasonry[1].columnSpan, 10);
assert.equal(desktopMasonry[2].columnSpan, 4);
assert.ok(desktopMasonry[2].gridRowStart < desktopMasonry[1].gridRowStart + desktopMasonry[1].rowSpan);
>>>>>>> origin/main

console.log('adaptivePhotoGrid logic tests passed');

// Row span computation with aspectRatio override
const testPost = post(null);
const style = getAdaptivePhotoGridItemStyle(testPost, { columnWidth: 100, columnGap: 8, rowHeight: 4, rowGap: 4, aspectRatio: 2, columnSpan: 2, footerHeight: 0 });
// tileWidth = (100*2) + (8*1) = 208, mediaHeight = 208/2 = 104, totalHeight = 104
// effectiveRowUnit = 4 + 4 = 8 -> rowSpan = ceil((104 + 4) / 8) = ceil(108/8) = 14
assert.equal(style.gridRowEnd, 'span 14');

console.log('adaptivePhotoGrid derived-style tests passed');
