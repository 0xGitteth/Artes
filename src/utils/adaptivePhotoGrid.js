export const ADAPTIVE_PHOTO_GRID_THRESHOLDS = {
  veryNarrowPortraitMax: 0.45,
  portraitMax: 0.9,
  squareMax: 1.15,
  wideLandscapeMin: 1.75,
  panoramaMin: 2.8,
  fullPanoramaMin: 3.5,
};

const FALLBACK_GRID_METRICS = {
  columnWidth: 32,
  columnGap: 8,
  rowHeight: 4,
  rowGap: 4,
  columnCount: 12,
  containerWidth: 0,
};

export const ADAPTIVE_PHOTO_GRID_MOBILE_MAX_WIDTH = 640;
export const ADAPTIVE_PHOTO_GRID_MAX_MEDIA_HEIGHT_RATIO = 1.25;
export const ADAPTIVE_PHOTO_GRID_MAX_MEDIA_HEIGHT = 560;

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
export const getAdaptivePhotoFrameStyle = (post, aspectRatioOverride = null) => {
  const aspectRatio = aspectRatioOverride || getPostImageAspectRatio(post);
  if (!aspectRatio) return undefined;
  return { aspectRatio: `${aspectRatio} / 1` };
};

export const classifyAdaptivePhotoTile = (post, aspectRatioOverride = null) => {
  const aspectRatio = aspectRatioOverride || getPostImageAspectRatio(post);
  const orientation = post?.imageMeta?.orientation;

  if (orientation === 'panorama') return 'panorama';
  if (!aspectRatio) return orientation || 'fallback';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.veryNarrowPortraitMax) return 'veryNarrowPortrait';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.portraitMax) return 'portrait';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.squareMax) return 'square';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.wideLandscapeMin) return 'landscape';
  return aspectRatio >= ADAPTIVE_PHOTO_GRID_THRESHOLDS.panoramaMin ? 'panorama' : 'wideLandscape';
};

const getColumnSpanClassName = (columnSpan) => {
  if (columnSpan >= 3) return 'col-span-3';
  if (columnSpan === 2) return 'col-span-2';
  return 'col-span-1';
};

export const getAdaptivePhotoTileSpan = (post, aspectOrOptions = null) => {
  // Support two calling conventions for compatibility:
  // - getAdaptivePhotoTileSpan(post, aspectRatioNumber)
  // - getAdaptivePhotoTileSpan(post, { availableColumns, aspectRatio })
  let availableColumns = FALLBACK_GRID_METRICS.columnCount;
  let aspectRatioOverride = null;
  if (typeof aspectOrOptions === 'number') {
    aspectRatioOverride = aspectOrOptions;
  } else if (aspectOrOptions && typeof aspectOrOptions === 'object') {
    availableColumns = aspectOrOptions.availableColumns ?? availableColumns;
    aspectRatioOverride = aspectOrOptions.aspectRatio ?? null;
  }

  const aspectRatio = getPositiveNumber(aspectRatioOverride, getPostImageAspectRatio(post) || 1);
  const safeAvailableColumns = getPositiveInteger(availableColumns, FALLBACK_GRID_METRICS.columnCount);
  const desiredColumnSpan = getDesiredColumnSpanForAspectRatio(aspectRatio, safeAvailableColumns);
  const columnSpan = Math.min(desiredColumnSpan, safeAvailableColumns);
  const tileType = classifyAdaptivePhotoTile(post, aspectRatioOverride);

  return {
    tileType,
    className: getColumnSpanClassName(columnSpan),
    desiredColumnSpan,
    columnSpan,
    columns: { mobile: columnSpan, tablet: columnSpan, desktop: columnSpan },
  };
};
const getPositiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const getPositiveInteger = (value, fallback) => Math.max(1, Math.floor(getPositiveNumber(value, fallback)));

const getSpanFromFraction = (availableColumns, fraction) => Math.max(1, Math.round(availableColumns * fraction));

const getDesiredColumnSpanForAspectRatio = (aspectRatio, availableColumns) => {
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.veryNarrowPortraitMax) {
    return getSpanFromFraction(availableColumns, 0.25);
  }
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.squareMax) {
    return getSpanFromFraction(availableColumns, 1 / 3);
  }
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.wideLandscapeMin) {
    return getSpanFromFraction(availableColumns, 0.5);
  }
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.panoramaMin) {
    return getSpanFromFraction(availableColumns, 2 / 3);
  }
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.fullPanoramaMin) {
    return getSpanFromFraction(availableColumns, 0.75);
  }
  return availableColumns;
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

const getViewportSafeMediaHeight = (metrics, maxMediaHeightRatio, maxMediaHeight) => {
  const containerBasedLimit = metrics.containerWidth > 0 ? metrics.containerWidth * maxMediaHeightRatio : Number.POSITIVE_INFINITY;
  return Math.min(containerBasedLimit, maxMediaHeight);
};

export const getAdaptivePhotoGridItemLayout = (post, {
  columnWidth,
  columnGap,
  rowHeight,
  rowGap,
  columnCount,
  containerWidth,
  footerHeight = 0,
  minMediaHeight = 0,
  maxMediaHeightRatio = ADAPTIVE_PHOTO_GRID_MAX_MEDIA_HEIGHT_RATIO,
  maxMediaHeight = ADAPTIVE_PHOTO_GRID_MAX_MEDIA_HEIGHT,
  aspectRatio: aspectRatioOverride = null,
  columnSpan: columnSpanOverride = null,
} = {}) => {
  const metrics = getMeasuredMetrics({ columnWidth, columnGap, rowHeight, rowGap, columnCount, containerWidth });
  const aspectRatio = getPositiveNumber(aspectRatioOverride, getPostImageAspectRatio(post) || 1);
  const span = post
    ? getAdaptivePhotoTileSpan(post, { availableColumns: metrics.columnCount, aspectRatio: aspectRatioOverride })
    : {
      columnSpan: getDesiredColumnSpanForAspectRatio(aspectRatio, metrics.columnCount),
      tileType: aspectRatio === 1 ? 'square' : 'fallback',
    };
  const columnSpan = Math.min(getPositiveInteger(columnSpanOverride, span.columnSpan), metrics.columnCount);
  const measuredFooterHeight = Number.isFinite(Number(footerHeight)) && Number(footerHeight) > 0 ? Number(footerHeight) : 0;
  const measuredMinMediaHeight = Number.isFinite(Number(minMediaHeight)) && Number(minMediaHeight) > 0 ? Number(minMediaHeight) : 0;
  const safeMediaHeight = getViewportSafeMediaHeight(metrics, getPositiveNumber(maxMediaHeightRatio, ADAPTIVE_PHOTO_GRID_MAX_MEDIA_HEIGHT_RATIO), getPositiveNumber(maxMediaHeight, ADAPTIVE_PHOTO_GRID_MAX_MEDIA_HEIGHT));

  const tileWidth = (metrics.columnWidth * columnSpan) + (metrics.columnGap * Math.max(0, columnSpan - 1));
  const naturalMediaHeight = tileWidth / aspectRatio;
  const shouldFitInsideFrame = naturalMediaHeight > safeMediaHeight;
  const mediaHeight = Math.max(shouldFitInsideFrame ? safeMediaHeight : naturalMediaHeight, measuredMinMediaHeight);
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
    naturalMediaHeight,
    uncappedMediaHeight: naturalMediaHeight,
    rowSpan,
    shouldFitInsideFrame,
    frameStyle: { height: `${mediaHeight}px` },
    maxMediaHeight: Number.isFinite(safeMediaHeight) ? safeMediaHeight : null,
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
