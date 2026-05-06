const PANORAMA_RATIO_THRESHOLD = 2.8;

export const isPanoramaImage = (imageMeta) => {
  if (!imageMeta || typeof imageMeta !== 'object') return false;
  if (imageMeta.orientation === 'panorama') return true;
  const ratio = Number(imageMeta.aspectRatio);
  return Number.isFinite(ratio) && ratio >= PANORAMA_RATIO_THRESHOLD;
};
