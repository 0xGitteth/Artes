export const ADAPTIVE_PHOTO_GRID_THRESHOLDS = {
  portraitMax: 0.9,
  squareMax: 1.35,
  panoramaMin: 2.8,
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

export const classifyAdaptivePhotoTile = (post) => {
  const aspectRatio = getPostImageAspectRatio(post);
  const orientation = post?.imageMeta?.orientation;

  if (orientation === 'panorama') return 'panorama';
  if (orientation === 'landscape') return 'landscape';
  if (orientation === 'portrait') return 'portrait';
  if (orientation === 'square') return 'square';

  if (!aspectRatio) return 'fallback';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.portraitMax) return 'portrait';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.squareMax) return 'square';
  if (aspectRatio < ADAPTIVE_PHOTO_GRID_THRESHOLDS.panoramaMin) return 'landscape';
  return 'panorama';
};

export const getAdaptivePhotoTileSpan = (post) => {
  const tileType = classifyAdaptivePhotoTile(post);

  if (tileType === 'panorama') {
    return {
      tileType,
      className: 'col-span-2 sm:col-span-3 lg:col-span-3',
      columns: { mobile: 2, tablet: 3, desktop: 3 },
    };
  }

  if (tileType === 'landscape') {
    return {
      tileType,
      className: 'col-span-2',
      columns: { mobile: 2, tablet: 2, desktop: 2 },
    };
  }

  return {
    tileType,
    className: 'col-span-1',
    columns: { mobile: 1, tablet: 1, desktop: 1 },
  };
};
