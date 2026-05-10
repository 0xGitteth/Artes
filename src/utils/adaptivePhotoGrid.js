export const ADAPTIVE_PHOTO_GRID_THRESHOLDS = {
  portraitMax: 0.9,
  largePortraitMax: 0.72,
  squareMax: 1.35,
  wideLandscapeMin: 1.8,
  panoramaMin: 2.8,
};

const FALLBACK_GRID_METRICS = {
  columnWidth: 220,
  columnGap: 8,
  rowHeight: 4,
  rowGap: 4,
};

export const getPostImageAspectRatio = (post) => {
  const imageMeta = post?.imageMeta;
  if (!imageMeta || typeof imageMeta !== 'object') return null;

  const directRatio = Number(imageMeta.aspectRatio);
  if (Number.isFinite(directRatio) && directRatio > 0) return directRatio;

  const width = Number(imageMeta.width);
  const height = Number(imageMeta.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return width / height;
  }

  return null;
};

export const getAdaptivePhotoFrameStyle = (post) => {
  const aspectRatio = getPostImageAspectRatio(post);
  if (!aspectRatio) return undefined;

  return { aspectRatio: `${aspectRatio} / 1` };
};

export const classifyAdaptivePhotoTile = (post) => {
  const aspectRatio = getPostImageAspectRatio(post);
  const orientation = post?.imageMeta?.orientation;

  if (orientation === 'panorama') return 'panorama';
  if (orientation === 'landscape') return aspectRatio >= ADAPTIVE_PHOTO_GRID_THRESHOLDS.wideLandscapeMin ? 'wideLandscape' : 'landscape';
  if (orientation === 'portrait') return aspectRatio && aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.largePortraitMax ? 'largePortrait' : 'portrait';
  if (orientation === 'square') return 'square';

  if (!aspectRatio) return 'fallback';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.largePortraitMax) return 'largePortrait';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.portraitMax) return 'portrait';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.squareMax) return 'square';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.panoramaMin) return aspectRatio >= ADAPTIVE_PHOTO_GRID_THRESHOLDS.wideLandscapeMin ? 'wideLandscape' : 'landscape';
  return 'panorama';
};

const getColumnSpanForTileType = (tileType) => {
  if (tileType === 'panorama') return 3;
  if (tileType === 'wideLandscape' || tileType === 'largePortrait') return 2;
  return 1;
};

const getColumnSpanClassName = (columnSpan) => {
  if (columnSpan >= 3) return 'col-span-3';
  if (columnSpan === 2) return 'col-span-2';
  return 'col-span-1';
};

export const getAdaptivePhotoTileSpan = (post) => {
  const tileType = classifyAdaptivePhotoTile(post);
  const columnSpan = getColumnSpanForTileType(tileType);

  return {
    tileType,
    className: getColumnSpanClassName(columnSpan),
    columnSpan,
    columns: { mobile: columnSpan, tablet: columnSpan, desktop: columnSpan },
  };
};

const getPositiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

export const getAdaptivePhotoGridItemStyle = (post, {
  columnWidth,
  columnGap,
  rowHeight,
  rowGap,
  footerHeight = 0,
  aspectRatio: aspectRatioOverride = null,
  columnSpan: columnSpanOverride = null,
} = {}) => {
  const span = post ? getAdaptivePhotoTileSpan(post) : { columnSpan: 1 };
  const columnSpan = getPositiveNumber(columnSpanOverride, span.columnSpan);
  const aspectRatio = getPositiveNumber(aspectRatioOverride, getPostImageAspectRatio(post) || 1);
  const measuredColumnWidth = getPositiveNumber(columnWidth, FALLBACK_GRID_METRICS.columnWidth);
  const measuredColumnGap = getPositiveNumber(columnGap, FALLBACK_GRID_METRICS.columnGap);
  const measuredRowHeight = getPositiveNumber(rowHeight, FALLBACK_GRID_METRICS.rowHeight);
  const measuredRowGap = Number.isFinite(Number(rowGap)) && Number(rowGap) >= 0 ? Number(rowGap) : FALLBACK_GRID_METRICS.rowGap;
  const measuredFooterHeight = Number.isFinite(Number(footerHeight)) && Number(footerHeight) > 0 ? Number(footerHeight) : 0;

  const tileWidth = (measuredColumnWidth * columnSpan) + (measuredColumnGap * Math.max(0, columnSpan - 1));
  const mediaHeight = tileWidth / aspectRatio;
  const totalHeight = mediaHeight + measuredFooterHeight;
  const effectiveRowUnit = measuredRowHeight + measuredRowGap;
  const rowSpan = Math.max(1, Math.ceil((totalHeight + measuredRowGap) / effectiveRowUnit));

  return { gridRowEnd: `span ${rowSpan}` };
};
