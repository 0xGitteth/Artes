import { useEffect, useRef, useState } from 'react';
import { getAdaptivePhotoFrameStyle, getAdaptivePhotoGridItemStyle, getAdaptivePhotoTileSpan } from '../utils/adaptivePhotoGrid';
import { shouldIgnoreTileActivation } from '../utils/domInteraction';

const parsePixelValue = (value, fallback = 0) => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};

const getGridMetrics = (element) => {
  if (!element || typeof window === 'undefined') return null;

  const styles = window.getComputedStyle(element);
  const columns = styles.gridTemplateColumns
    .split(' ')
    .map((column) => Number.parseFloat(column))
    .filter((columnWidth) => Number.isFinite(columnWidth) && columnWidth > 0);
  const columnGap = parsePixelValue(styles.columnGap, 0);
  const rowGap = parsePixelValue(styles.rowGap, 0);
  const rowHeight = parsePixelValue(styles.gridAutoRows, 4);
  const measuredWidth = element.getBoundingClientRect().width;
  const columnCount = columns.length || 1;
  const fallbackColumnWidth = Math.max(1, (measuredWidth - (columnGap * Math.max(0, columnCount - 1))) / columnCount);
  const columnWidth = columns[0] || fallbackColumnWidth;

  return { columnWidth, columnGap, rowHeight, rowGap };
};

const areGridMetricsEqual = (a, b) => Boolean(a && b
  && Math.abs(a.columnWidth - b.columnWidth) < 0.5
  && Math.abs(a.columnGap - b.columnGap) < 0.5
  && Math.abs(a.rowHeight - b.rowHeight) < 0.5
  && Math.abs(a.rowGap - b.rowGap) < 0.5);

const useAdaptivePhotoGridMetrics = () => {
  const gridRef = useRef(null);
  const [gridMetrics, setGridMetrics] = useState(null);

  useEffect(() => {
    const element = gridRef.current;
    if (!element || typeof window === 'undefined') return undefined;

    const updateGridMetrics = () => {
      const nextMetrics = getGridMetrics(element);
      if (!nextMetrics) return;
      setGridMetrics((previousMetrics) => (areGridMetricsEqual(previousMetrics, nextMetrics) ? previousMetrics : nextMetrics));
    };

    updateGridMetrics();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateGridMetrics);
      return () => window.removeEventListener('resize', updateGridMetrics);
    }

    const resizeObserver = new ResizeObserver(updateGridMetrics);
    resizeObserver.observe(element);
    window.addEventListener('resize', updateGridMetrics);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateGridMetrics);
    };
  }, []);

  return { gridRef, gridMetrics };
};

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
  const { gridRef, gridMetrics } = useAdaptivePhotoGridMetrics();

  return (
    <div ref={gridRef} className={`grid grid-cols-3 gap-x-2 gap-y-1 [grid-auto-flow:dense] [grid-auto-rows:4px] sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 ${className}`.trim()}>
      {posts.map((post) => {
        const span = getAdaptivePhotoTileSpan(post);
        const shouldCover = getShouldCover?.(post) === true;
        const frameStyle = getAdaptivePhotoFrameStyle(post);
        const itemStyle = getAdaptivePhotoGridItemStyle(post, { ...gridMetrics, footerHeight: renderFooter ? 88 : 0 });
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
