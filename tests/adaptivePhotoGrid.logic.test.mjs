import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyAdaptivePhotoTile,
  getAdaptivePhotoGridColumnCountForWidth,
  getAdaptivePhotoGridItemLayout,
  getAdaptivePhotoGridItemStyle,
  getAdaptivePhotoGridTemplateColumns,
  getAdaptivePhotoMasonryLayout,
  getAdaptivePhotoTileSpan,
  getDiscoverUserCardColumnSpan,
} from '../src/utils/adaptivePhotoGrid.js';

const post = (imageMeta) => ({ id: 'post', imageMeta });
const spanNumber = (style) => Number(String(style.gridRowEnd).replace('span ', ''));
const metrics = { columnWidth: 24, columnGap: 8, rowHeight: 4, rowGap: 4, columnCount: 12, containerWidth: 376 };

// Classification
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 0.35 })), 'veryNarrowPortrait');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 0.75 })), 'portrait');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1 })), 'square');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.4 })), 'landscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 1.8 })), 'wideLandscape');
assert.equal(classifyAdaptivePhotoTile(post({ aspectRatio: 3.2 })), 'panorama');
assert.equal(classifyAdaptivePhotoTile(post(null)), 'fallback');

// Tile span behaviour
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

// Layout metrics and row span
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

// Masonry layout behaviour
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
assert.ok(masonry[2].gridRowStart <= masonry[0].gridRowStart + masonry[0].rowSpan);
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

const placementSignature = (layout) => layout.map((item) => ({
  id: item.item.id,
  gridColumnStart: item.gridColumnStart,
  gridRowStart: item.gridRowStart,
  columnSpan: item.columnSpan,
  rowSpan: item.rowSpan,
}));

const deterministicItems = [
  { id: 'square-a', aspectRatio: 1, columnSpan: 4 },
  { id: 'landscape-a', aspectRatio: 1.4, columnSpan: 6 },
  { id: 'square-b', aspectRatio: 1, columnSpan: 4 },
  { id: 'portrait-a', aspectRatio: 0.75, columnSpan: 4 },
];
const deterministicOptions = {
  ...metrics,
  getAspectRatio: (item) => item.aspectRatio,
  getColumnSpan: (item) => item.columnSpan,
};
const deterministicLayoutA = getAdaptivePhotoMasonryLayout(deterministicItems, deterministicOptions);
const deterministicLayoutB = getAdaptivePhotoMasonryLayout(deterministicItems, deterministicOptions);
assert.deepEqual(placementSignature(deterministicLayoutA), placementSignature(deterministicLayoutB), 'Masonry placement should be deterministic for the same inputs');

const centeredSquareMobile = getAdaptivePhotoMasonryLayout([
  { id: 'mobile-square', aspectRatio: 1, columnSpan: 4 },
], deterministicOptions)[0];
assert.equal(centeredSquareMobile.gridColumnStart, 5, 'Equal-height mobile square candidates should choose the centered balanced placement instead of defaulting left');

const realisticMobileSpans = getAdaptivePhotoMasonryLayout([
  { id: 'mobile-square', aspectRatio: 1, columnSpan: 4 },
  { id: 'mobile-landscape', aspectRatio: 1.4, columnSpan: 6 },
], deterministicOptions);
assert.equal(realisticMobileSpans[0].gridColumnStart, 5, 'Mobile square span 4 should be included in tie breaking');
assert.equal(realisticMobileSpans[1].gridColumnStart, 4, 'Mobile landscape span 6 should be included in tie breaking');

const desktop24Metrics = { columnWidth: 24, columnGap: 8, rowHeight: 4, rowGap: 4, columnCount: 24, containerWidth: 760 };
const realisticDesktopSpans = getAdaptivePhotoMasonryLayout([
  { id: 'desktop-square', aspectRatio: 1, columnSpan: 8 },
  { id: 'desktop-landscape', aspectRatio: 1.4, columnSpan: 12 },
  { id: 'desktop-panorama', aspectRatio: 3.2, columnSpan: 18 },
], {
  ...desktop24Metrics,
  getAspectRatio: (item) => item.aspectRatio,
  getColumnSpan: (item) => item.columnSpan,
});
assert.equal(realisticDesktopSpans[0].gridColumnStart, 9, 'Desktop square span 8 should be included in tie breaking');
assert.equal(realisticDesktopSpans[1].gridColumnStart, 7, 'Desktop landscape span 12 should be included in tie breaking');
assert.equal(realisticDesktopSpans[2].gridColumnStart, 1, 'Very wide desktop panorama spans should keep conservative left-most placement');

const fallbackUserSpan = getDiscoverUserCardColumnSpan({});
assert.equal(getDiscoverUserCardColumnSpan(null), fallbackUserSpan, 'Discover user card sizing should tolerate null metrics during first render');
assert.equal(getDiscoverUserCardColumnSpan(undefined), fallbackUserSpan, 'Discover user card sizing should tolerate undefined metrics during first render');

const desktopUserSpan = getDiscoverUserCardColumnSpan(desktop24Metrics);
const desktopSquareSpan = getAdaptivePhotoTileSpan(post({ aspectRatio: 1 }), { availableColumns: desktop24Metrics.columnCount }).columnSpan;
const legacyDesktopUserSpan = Math.ceil((120 + desktop24Metrics.columnGap) / (desktop24Metrics.columnWidth + desktop24Metrics.columnGap));
assert.equal(desktopUserSpan, desktopSquareSpan, 'Discover user cards should match a square photo tile span on desktop grids');
assert.ok(desktopUserSpan > legacyDesktopUserSpan, 'Discover user cards should be larger than the previous compact desktop implementation');
assert.equal(getDiscoverUserCardColumnSpan(metrics), 4, 'Discover user cards should keep the existing mobile-sized grid span');
assert.equal(
  getDiscoverUserCardColumnSpan({ ...desktop24Metrics, containerWidth: undefined, measuredWidth: 760 }),
  desktopUserSpan,
  'Discover user card sizing should use measuredWidth when containerWidth is missing',
);
assert.equal(
  getDiscoverUserCardColumnSpan({ ...desktop24Metrics, containerWidth: undefined, measuredWidth: 900 }),
  desktopSquareSpan,
  'Desktop measuredWidth should use the active grid ratio instead of a compact fixed target',
);
assert.equal(
  getDiscoverUserCardColumnSpan({ ...desktop24Metrics, containerWidth: undefined, measuredWidth: 1200 }),
  desktopSquareSpan,
  'Wide desktop measuredWidth should keep user cards aligned to square photo tile spans',
);
assert.equal(
  getDiscoverUserCardColumnSpan({ ...desktop24Metrics, containerWidth: 900 }),
  desktopSquareSpan,
  'Existing containerWidth-based desktop sizing should use the active grid ratio',
);
assert.equal(getAdaptivePhotoGridColumnCountForWidth(639, 24), 12, 'Mobile widths should resolve to the mobile CSS grid column count');
assert.equal(getAdaptivePhotoGridColumnCountForWidth(640, 12), 16, 'Breakpoint widths should resolve to the tablet CSS grid column count');
assert.equal(getAdaptivePhotoGridColumnCountForWidth(1024, 16), 20, 'Desktop breakpoint widths should resolve to the desktop CSS grid column count');
assert.equal(getAdaptivePhotoGridColumnCountForWidth(1280, 20), 24, 'Wide desktop breakpoint widths should resolve to the wide CSS grid column count');
assert.equal(getAdaptivePhotoGridColumnCountForWidth(0, 20), 20, 'Existing valid metrics should be kept when no measured width is available');
assert.equal(getAdaptivePhotoGridTemplateColumns(20), 'repeat(20, minmax(0, 1fr))', 'Synced grid CSS should be rendered from the same column count used by masonry');
const discoverUserLayout = getAdaptivePhotoGridItemLayout(null, { ...desktop24Metrics, aspectRatio: 1, columnSpan: desktopUserSpan });
assert.equal(discoverUserLayout.aspectRatio, 1, 'Discover user cards should keep square media');
assert.equal(discoverUserLayout.mediaHeight, discoverUserLayout.tileWidth, 'Discover user card media should render square before footer height is added');
const artesAppSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const discoverUserSpanUsageCount = (artesAppSource.match(/getDiscoverUserCardColumnSpan/g) || []).length;
assert.equal(discoverUserSpanUsageCount, 2, 'Discover user card sizing helper should only be imported and used by the Discover mixed grid');
assert.match(artesAppSource, /getAdaptivePhotoGridTemplateColumns\(mixedGridMetrics\?\.columnCount\)/, 'Discover mixed grid CSS columns should be rendered from measured masonry metrics');

console.log('adaptivePhotoGrid logic tests passed');

// Row span computation with aspectRatio override
const testPost = post(null);
const style = getAdaptivePhotoGridItemStyle(testPost, { columnWidth: 100, columnGap: 8, rowHeight: 4, rowGap: 4, aspectRatio: 2, columnSpan: 2, footerHeight: 0 });
// tileWidth = (100*2) + (8*1) = 208, mediaHeight = 208/2 = 104, totalHeight = 104
// effectiveRowUnit = 4 + 4 = 8 -> rowSpan = ceil((104 + 4) / 8) = ceil(108/8) = 14
assert.equal(style.gridRowEnd, 'span 14');

console.log('adaptivePhotoGrid derived-style tests passed');
