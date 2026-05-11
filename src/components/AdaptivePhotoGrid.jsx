import { getAdaptivePhotoFrameStyle, getAdaptivePhotoMasonryLayout } from '../utils/adaptivePhotoGrid';
import useAdaptivePhotoGridMetrics from '../utils/useAdaptivePhotoGridMetrics';
import { shouldIgnoreTileActivation } from '../utils/domInteraction';

export default function AdaptivePhotoGrid({
  posts = [],
  onPostClick,
  getShouldCover,
  renderOverlay,
  renderBadge,
  renderFooter,
  className = '',
  itemClassName = '',
  sensitiveMinMediaHeight = 176,
}) {
  const { gridRef, gridMetrics } = useAdaptivePhotoGridMetrics();
  const layoutItems = posts.map((post) => ({
    post,
    shouldCover: getShouldCover?.(post) === true,
  }));
  const masonryLayout = getAdaptivePhotoMasonryLayout(layoutItems, {
    ...gridMetrics,
    getPost: (item) => item.post,
    getFooterHeight: () => (renderFooter ? 88 : 0),
    getMinMediaHeight: (item) => (item.shouldCover ? sensitiveMinMediaHeight : 0),
  });

  return (
    <div ref={gridRef} className={`grid min-w-0 max-w-full [grid-template-columns:repeat(12,minmax(0,1fr))] gap-x-2 gap-y-1 [grid-auto-rows:4px] sm:[grid-template-columns:repeat(16,minmax(0,1fr))] lg:[grid-template-columns:repeat(20,minmax(0,1fr))] xl:[grid-template-columns:repeat(24,minmax(0,1fr))] ${className}`.trim()}>
      {masonryLayout.map((layout) => {
        const { item, style, className: spanClassName, tileType } = layout;
        const { post, shouldCover } = item;
        const frameStyle = getAdaptivePhotoFrameStyle(post, layout);
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
            className={`group relative min-w-0 w-full overflow-hidden rounded-lg bg-slate-100 text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 md:rounded-xl ${spanClassName} ${clickable ? 'cursor-pointer' : ''} ${post.isChallenge ? 'ring-2 ring-amber-400' : ''} ${itemClassName}`.trim()}
            style={style}
            data-tile-type={tileType}
          >
            {renderBadge?.(post)}
            <span className="relative block w-full overflow-hidden" style={frameStyle}>
              {shouldCover ? renderOverlay?.(post) : null}
              <img
                src={post.imageUrl}
                alt={post.title || ''}
                loading="lazy"
                className={`relative z-0 block w-full object-contain ${layout.shouldFitInsideFrame ? 'h-full' : frameStyle ? 'h-full' : 'h-auto'}`}
              />
            </span>
            {renderFooter?.(post)}
          </article>
        );
      })}
    </div>
  );
}
