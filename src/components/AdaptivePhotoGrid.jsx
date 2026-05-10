import { getAdaptivePhotoTileSpan } from '../utils/adaptivePhotoGrid';
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
    <div className={`columns-3 gap-x-2 gap-y-2 sm:columns-4 md:columns-4 lg:columns-5 xl:columns-6 ${className}`.trim()}>
      {posts.map((post) => {
        const span = getAdaptivePhotoTileSpan(post);
        const shouldCover = getShouldCover?.(post) === true;
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
            className={`group relative inline-block w-full mb-2 break-inside-avoid overflow-hidden rounded-lg bg-slate-100 text-left shadow-sm transition hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-800 md:rounded-xl ${clickable ? 'cursor-pointer' : ''} ${post.isChallenge ? 'ring-2 ring-amber-400' : ''} ${itemClassName}`.trim()}
            data-tile-type={span.tileType}
          >
            {renderBadge?.(post)}
            <span className="relative block overflow-hidden">
              {shouldCover ? renderOverlay?.(post) : null}
              <img
                src={post.imageUrl}
                alt={post.title || ''}
                loading="lazy"
                className="relative z-0 block h-auto w-full object-contain"
              />
            </span>
            {renderFooter?.(post)}
          </article>
        );
      })}
    </div>
  );
}
