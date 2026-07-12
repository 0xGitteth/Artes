export const getQuickProfilePreviewPosts = ({
  posts = [],
  previewMode = 'latest',
  manualIds = [],
  getContentPreference = () => 'show',
  limit = 3,
} = {}) => {
  const visiblePosts = posts.filter((post) => getContentPreference(post) !== 'hideFeed');
  let rankedPosts = [];

  if (previewMode === 'manual' && manualIds.length) {
    const postsById = new Map(visiblePosts.map((post) => [post.id, post]));
    rankedPosts = manualIds
      .map((id) => postsById.get(id))
      .filter(Boolean);
  }

  if (!rankedPosts.length && previewMode === 'best') {
    rankedPosts = [...visiblePosts].sort((a, b) => (b.likes || 0) - (a.likes || 0));
  }

  if (!rankedPosts.length) {
    rankedPosts = visiblePosts;
  }

  return rankedPosts.slice(0, limit);
};
