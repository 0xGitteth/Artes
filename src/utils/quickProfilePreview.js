export const getQuickProfilePreviewPosts = ({
  posts = [],
  previewMode = 'latest',
  manualIds = [],
  getContentPreference = () => 'show',
  limit = 3,
} = {}) => {
  const visiblePosts = posts.filter((post) => getContentPreference(post) !== 'hideFeed');

  if (previewMode === 'manual' && manualIds.length) {
    const postsById = new Map(posts.map((post) => [post.id, post]));
    const manualPosts = manualIds
      .map((id) => postsById.get(id))
      .filter(Boolean);

    if (manualPosts.length) {
      return manualPosts
        .filter((post) => getContentPreference(post) !== 'hideFeed')
        .slice(0, limit);
    }
  }

  if (previewMode === 'best') {
    return [...visiblePosts]
      .sort((a, b) => (b.likes || 0) - (a.likes || 0))
      .slice(0, limit);
  }

  return visiblePosts.slice(0, limit);
};
