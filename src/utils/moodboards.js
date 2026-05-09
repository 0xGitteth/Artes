export const MOODBOARD_TITLE_MAX_LENGTH = 80;
export const DEFAULT_MOODBOARD_TITLE = 'Nieuw moodboard';

export const normalizeMoodboardTitle = (title) => {
  const normalized = String(title || '').replace(/\s+/g, ' ').trim();
  const fallback = normalized || DEFAULT_MOODBOARD_TITLE;
  return fallback.slice(0, MOODBOARD_TITLE_MAX_LENGTH);
};

const pickString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

export const buildMoodboardItemPayload = (post = {}, uid = '') => {
  const postId = pickString(post.id || post.postId);
  if (!postId) {
    throw new Error('Een post id is verplicht om op te slaan in een moodboard.');
  }

  return {
    postId,
    ownerUid: uid,
    moodboardId: '',
    postSnapshot: {
      imageUrl: pickString(post.imageUrl),
      title: pickString(post.title),
      authorId: pickString(post.authorId),
    },
  };
};

export const getMoodboardCoverImages = (items = [], posts = []) => {
  const postById = new Map((Array.isArray(posts) ? posts : []).map((post) => [post?.id, post]));
  return (Array.isArray(items) ? items : [])
    .map((item) => postById.get(item?.postId)?.imageUrl || item?.postSnapshot?.imageUrl || '')
    .filter(Boolean)
    .slice(0, 4);
};


export const resolveMoodboardItemPost = (item = {}, posts = []) => {
  const livePost = (Array.isArray(posts) ? posts : []).find((post) => post?.id === item?.postId);
  if (livePost) return livePost;
  if (!item?.postSnapshot?.imageUrl) return null;
  return {
    id: item.postId,
    imageUrl: item.postSnapshot.imageUrl,
    title: item.postSnapshot.title || 'Verwijderde post',
    authorId: item.postSnapshot.authorId || '',
    moodboardUnavailable: true,
  };
};

export const resolveMoodboardItemPosts = (items = [], posts = []) => (Array.isArray(items) ? items : [])
  .map((item) => resolveMoodboardItemPost(item, posts))
  .filter(Boolean);

export const canShowMoodboardsTab = ({ profileUid, currentUserId } = {}) => Boolean(
  profileUid && currentUserId && profileUid === currentUserId,
);
