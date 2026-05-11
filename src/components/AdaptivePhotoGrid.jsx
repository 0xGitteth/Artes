import { useEffect, useRef, useState } from 'react';
import { getAdaptivePhotoFrameStyle, getAdaptivePhotoGridItemStyle, getAdaptivePhotoTileSpan } from '../utils/adaptivePhotoGrid';
import { shouldIgnoreTileActivation } from '../utils/domInteraction';
import useAdaptivePhotoGridMetrics from '../utils/useAdaptivePhotoGridMetrics';
import useRecoveredImageMeta from '../utils/useRecoveredImageMeta';

export default function AdaptivePhotoGrid({
  posts = [],
  onPostClick,
  getShouldCover,
  renderOverlay,
  renderBadge,
  renderFooter,
  className = '',
  itemClassName = '',
}) {
  const { getOverride, onImageLoad, version: imageMetaVersion } = useRecoveredImageMeta();
  const { gridRef, gridMetrics } = useAdaptivePhotoGridMetrics(imageMetaVersion);

  return (
    <div ref={gridRef} className={`grid gap-x-2 gap-y-1 [grid-auto-flow:dense] [grid-auto-rows:4px] [grid-template-columns:repeat(12,minmax(0,1fr))] sm:[grid-template-columns:repeat(16,minmax(0,1fr))] lg:[grid-template-columns:repeat(20,minmax(0,1fr))] xl:[grid-template-columns:repeat(24,minmax(0,1fr))] ${className}`.trim()}>
      {posts.map((post) => {
        const key = post.id;
        const override = getOverride(key);
        const span = getAdaptivePhotoTileSpan(post, override?.aspectRatio);
        const shouldCover = getShouldCover?.(post) === true;
        const frameStyle = getAdaptivePhotoFrameStyle(post, override?.aspectRatio);
        const itemStyle = getAdaptivePhotoGridItemStyle(post, { ...gridMetrics, footerHeight: renderFooter ? 88 : 0, aspectRatio: override?.aspectRatio });
        const clickable = typeof onPostClick === 'function';
        return (
          <article
            key={post.id}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? (event) => {
              if (shouldIgnoreTileActivation(event.target, event.currentTarget)) return;
              onPostClick(post);
            } : undefined}
            onKeyDown={clickable ? (event) => {
              if (shouldIgnoreTileActivation(event.target, event.currentTarget)) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onPostClick(post);
              }
            } : undefined}
            className={`group relative w-full overflow-hidden rounded-lg bg-slate-100 text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 md:rounded-xl ${span.className} ${clickable ? 'cursor-pointer' : ''} ${post.isChallenge ? 'ring-2 ring-amber-400' : ''} ${itemClassName}`.trim()}
            style={itemStyle}
            data-tile-type={span.tileType}
          >
            {renderBadge?.(post)}
            <span className="relative block w-full overflow-hidden" style={frameStyle}>
              {shouldCover ? renderOverlay?.(post) : null}
              <img
                src={post.imageUrl}
                alt={post.title || ''}
                loading="lazy"
                onLoad={onImageLoad(key)}
                className={`relative z-0 block w-full object-contain ${frameStyle ? 'h-full' : 'h-auto'}`}
              />
            </span>
            {renderFooter?.(post)}
          </article>
        );
      })}
    </div>
  );
}
