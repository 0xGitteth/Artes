const clean = (value) => String(value ?? '').trim();

export const resolveModerationDraftAuthor = ({
  persistedDraft = null,
  fallbackProfileId = '',
  fallbackOwnerUid = '',
  fallbackName = '',
} = {}) => {
  const draft = persistedDraft && typeof persistedDraft === 'object' ? persistedDraft : {};
  const ownerUid = clean(fallbackOwnerUid);
  return {
    authorProfileId: clean(draft.authorProfileId) || clean(fallbackProfileId) || ownerUid || null,
    authorOwnerUid: ownerUid || null,
    authorName: clean(draft.authorName) || clean(fallbackName),
  };
};
