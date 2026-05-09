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

export const canShowMoodboardsTab = ({ profileUid, currentUserId } = {}) => Boolean(
  profileUid && currentUserId && profileUid === currentUserId,
);
