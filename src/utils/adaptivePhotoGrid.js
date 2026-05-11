export const ADAPTIVE_PHOTO_GRID_THRESHOLDS = {
  portraitMax: 0.9,
  squareMax: 1.15,
  wideLandscapeMin: 1.75,
  panoramaMin: 2.8,
};

const FALLBACK_GRID_METRICS = {
  columnWidth: 220,
  columnGap: 8,
  rowHeight: 4,
  rowGap: 4,
  columnCount: 3,
  containerWidth: 0,
};

export const ADAPTIVE_PHOTO_GRID_MOBILE_MAX_WIDTH = 640;
export const ADAPTIVE_PHOTO_GRID_MOBILE_MAX_VISUAL_ROWS = 3;

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
  if (!aspectRatio) return orientation || 'fallback';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.portraitMax) return 'portrait';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.squareMax) return 'square';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.wideLandscapeMin) return 'landscape';
  return aspectRatio >= ADAPTIVE_PHOTO_GRID_THRESHOLDS.panoramaMin ? 'panorama' : 'wideLandscape';
};

const getDesiredColumnSpanForTileType = (tileType) => {
  if (tileType === 'panorama' || tileType === 'wideLandscape') return 3;
  if (tileType === 'landscape') return 2;
  return 1;
};

const getColumnSpanClassName = (columnSpan) => {
  if (columnSpan >= 3) return 'col-span-3';
  if (columnSpan === 2) return 'col-span-2';
  return 'col-span-1';
};

const getPositiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const getPositiveInteger = (value, fallback) => Math.max(1, Math.floor(getPositiveNumber(value, fallback)));

export const getAdaptivePhotoTileSpan = (post, { availableColumns = FALLBACK_GRID_METRICS.columnCount } = {}) => {
  const tileType = classifyAdaptivePhotoTile(post);
  const desiredColumnSpan = getDesiredColumnSpanForTileType(tileType);
  const safeAvailableColumns = getPositiveInteger(availableColumns, FALLBACK_GRID_METRICS.columnCount);
  const columnSpan = Math.min(desiredColumnSpan, safeAvailableColumns);

  return {
    tileType,
    className: getColumnSpanClassName(columnSpan),
    desiredColumnSpan,
    columnSpan,
    columns: { mobile: columnSpan, tablet: columnSpan, desktop: columnSpan },
  };
};

const getMeasuredMetrics = ({
  columnWidth,
  columnGap,
  rowHeight,
  rowGap,
  columnCount,
  containerWidth,
} = {}) => ({
  columnWidth: getPositiveNumber(columnWidth, FALLBACK_GRID_METRICS.columnWidth),
  columnGap: getPositiveNumber(columnGap, FALLBACK_GRID_METRICS.columnGap),
  rowHeight: getPositiveNumber(rowHeight, FALLBACK_GRID_METRICS.rowHeight),
  rowGap: Number.isFinite(Number(rowGap)) && Number(rowGap) >= 0 ? Number(rowGap) : FALLBACK_GRID_METRICS.rowGap,
  columnCount: getPositiveInteger(columnCount, FALLBACK_GRID_METRICS.columnCount),
  containerWidth: Number.isFinite(Number(containerWidth)) && Number(containerWidth) > 0 ? Number(containerWidth) : FALLBACK_GRID_METRICS.containerWidth,
});

export const getAdaptivePhotoGridItemLayout = (post, {
  columnWidth,
  columnGap,
  rowHeight,
  rowGap,
  columnCount,
  containerWidth,
  footerHeight = 0,
  minMediaHeight = 0,
  mobileMaxVisualRows = ADAPTIVE_PHOTO_GRID_MOBILE_MAX_VISUAL_ROWS,
  mobileMaxWidth = ADAPTIVE_PHOTO_GRID_MOBILE_MAX_WIDTH,
  aspectRatio: aspectRatioOverride = null,
  columnSpan: columnSpanOverride = null,
} = {}) => {
  const metrics = getMeasuredMetrics({ columnWidth, columnGap, rowHeight, rowGap, columnCount, containerWidth });
  const span = post ? getAdaptivePhotoTileSpan(post, { availableColumns: metrics.columnCount }) : { columnSpan: 1, tileType: 'fallback' };
  const columnSpan = Math.min(getPositiveInteger(columnSpanOverride, span.columnSpan), metrics.columnCount);
  const aspectRatio = getPositiveNumber(aspectRatioOverride, getPostImageAspectRatio(post) || 1);
  const measuredFooterHeight = Number.isFinite(Number(footerHeight)) && Number(footerHeight) > 0 ? Number(footerHeight) : 0;
  const measuredMinMediaHeight = Number.isFinite(Number(minMediaHeight)) && Number(minMediaHeight) > 0 ? Number(minMediaHeight) : 0;
  const measuredMobileMaxVisualRows = getPositiveNumber(mobileMaxVisualRows, ADAPTIVE_PHOTO_GRID_MOBILE_MAX_VISUAL_ROWS);
  const measuredMobileMaxWidth = getPositiveNumber(mobileMaxWidth, ADAPTIVE_PHOTO_GRID_MOBILE_MAX_WIDTH);

  const tileWidth = (metrics.columnWidth * columnSpan) + (metrics.columnGap * Math.max(0, columnSpan - 1));
  const uncappedMediaHeight = tileWidth / aspectRatio;
  const mobileMediaHeightCap = (metrics.columnWidth * measuredMobileMaxVisualRows) + (metrics.rowGap * Math.max(0, measuredMobileMaxVisualRows - 1));
  const shouldApplyMobileCap = metrics.containerWidth > 0 && metrics.containerWidth <= measuredMobileMaxWidth;
  const cappedMediaHeight = shouldApplyMobileCap ? Math.min(uncappedMediaHeight, mobileMediaHeightCap) : uncappedMediaHeight;
  const mediaHeight = Math.max(cappedMediaHeight, measuredMinMediaHeight);
  const totalHeight = mediaHeight + measuredFooterHeight;
  const effectiveRowUnit = metrics.rowHeight + metrics.rowGap;
  const rowSpan = Math.max(1, Math.ceil((totalHeight + metrics.rowGap) / effectiveRowUnit));

  return {
    aspectRatio,
    tileType: span.tileType,
    columnSpan,
    className: getColumnSpanClassName(columnSpan),
    tileWidth,
    mediaHeight,
    uncappedMediaHeight,
    rowSpan,
    mobileMediaHeightCap: shouldApplyMobileCap ? mobileMediaHeightCap : null,
  };
};

export const getAdaptivePhotoGridItemStyle = (post, options = {}) => {
  const layout = getAdaptivePhotoGridItemLayout(post, options);

  return {
    gridColumnEnd: `span ${layout.columnSpan}`,
    gridRowEnd: `span ${layout.rowSpan}`,
  };
};

export const getAdaptivePhotoMasonryLayout = (items = [], {
  getPost = (item) => item,
  getAspectRatio,
  getColumnSpan,
  getFooterHeight,
  getMinMediaHeight,
  ...metrics
} = {}) => {
  const measuredMetrics = getMeasuredMetrics(metrics);
  const columnHeights = Array.from({ length: measuredMetrics.columnCount }, () => 0);

  return items.map((item, index) => {
    const post = getPost(item, index);
    const itemLayout = getAdaptivePhotoGridItemLayout(post, {
      ...metrics,
      columnCount: measuredMetrics.columnCount,
      aspectRatio: getAspectRatio?.(item, index),
      columnSpan: getColumnSpan?.(item, index),
      footerHeight: getFooterHeight?.(item, index),
      minMediaHeight: getMinMediaHeight?.(item, index),
    });
    const columnSpan = Math.min(itemLayout.columnSpan, measuredMetrics.columnCount);
    let bestColumn = 0;
    let bestTop = Number.POSITIVE_INFINITY;

    for (let column = 0; column <= measuredMetrics.columnCount - columnSpan; column += 1) {
      const candidateTop = Math.max(...columnHeights.slice(column, column + columnSpan));
      if (candidateTop < bestTop) {
        bestTop = candidateTop;
        bestColumn = column;
      }
    }

    const gridColumnStart = bestColumn + 1;
    const gridRowStart = bestTop + 1;
    const nextColumnHeight = bestTop + itemLayout.rowSpan;
    for (let column = bestColumn; column < bestColumn + columnSpan; column += 1) {
      columnHeights[column] = nextColumnHeight;
    }

    return {
      item,
      index,
      ...itemLayout,
      gridColumnStart,
      gridRowStart,
      gridColumn: `${gridColumnStart} / span ${columnSpan}`,
      gridRow: `${gridRowStart} / span ${itemLayout.rowSpan}`,
      style: {
        gridColumn: `${gridColumnStart} / span ${columnSpan}`,
        gridRow: `${gridRowStart} / span ${itemLayout.rowSpan}`,
      },
    };
  });
};
