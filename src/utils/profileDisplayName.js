export const pickPreferredDisplayName = (...candidates) => {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value) return value;
  }
  return '';
};

export const resolvePostAuthorDisplayName = ({ post, users = [] }) => {
  const authorId = post?.authorId;
  const publicName = Array.isArray(users)
    ? users.find((entry) => entry?.uid === authorId)?.displayName
    : '';
  return pickPreferredDisplayName(publicName, post?.authorName, 'Onbekend');
};

