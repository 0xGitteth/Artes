import React from 'react';

const PANORAMA_RATIO_THRESHOLD = 2.8;

export const isPanoramaImage = (imageMeta) => {
  if (!imageMeta || typeof imageMeta !== 'object') return false;
  if (imageMeta.orientation === 'panorama') return true;
  const ratio = Number(imageMeta.aspectRatio);
  return Number.isFinite(ratio) && ratio >= PANORAMA_RATIO_THRESHOLD;
};

export default function PostImageDisplay({
  src,
  alt,
  imageMeta,
  className = '',
  onClick,
  onPointerDown,
  onPointerUp,
  shouldCover = false,
  overlay = null,
  badgeClassName = '',
  panoramaFrameClassName = '',
  panoramaHint = 'Veeg horizontaal om de hele foto te bekijken.',
}) {
  const isPanorama = isPanoramaImage(imageMeta);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {shouldCover ? overlay : null}
      {isPanorama ? (
        <>
          <div className={`relative z-0 h-56 w-full overflow-x-auto overflow-y-hidden touch-pan-x ${panoramaFrameClassName}`}>
            <img
              src={src}
              alt={alt}
              onClick={onClick}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              className="block h-full w-auto max-w-none object-contain cursor-pointer"
              loading="lazy"
              draggable={false}
            />
          </div>
          <div className={`absolute left-3 top-3 z-10 rounded-full bg-black/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white ${badgeClassName}`}>
            Panorama
          </div>
          <div className="absolute bottom-3 left-3 right-3 z-10 rounded-full bg-black/55 px-3 py-1 text-center text-[11px] text-white/95">
            {panoramaHint}
          </div>
        </>
      ) : (
        <img
          src={src}
          alt={alt}
          onClick={onClick}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          className="relative z-0 block h-auto w-full object-cover"
          loading="lazy"
        />
      )}
    </div>
  );
}
