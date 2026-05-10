import { getAdaptivePhotoFrameStyle, getAdaptivePhotoGridItemStyle, getAdaptivePhotoTileSpan } from '../utils/adaptivePhotoGrid';
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
}) {
  return (
    <div className={`grid grid-cols-3 gap-x-2 gap-y-1 [grid-auto-flow:dense] [grid-auto-rows:4px] sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 ${className}`.trim()}>
      {posts.map((post) => {
        const span = getAdaptivePhotoTileSpan(post);
        const shouldCover = getShouldCover?.(post) === true;
        const frameStyle = getAdaptivePhotoFrameStyle(post);
        const itemStyle = getAdaptivePhotoGridItemStyle(post, { footerRows: renderFooter ? 7 : 0 });
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
