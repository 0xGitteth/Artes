const MANAGED_EXTERNAL_PROFILE_TYPES = new Set(['company', 'agency', 'collective']);

const clean = (value) => String(value || '').trim();

export const validateModerationPublicationAuthorProfile = ({
  userId,
  requestedProfileId,
  profileExists = false,
  profileData = null,
} = {}) => {
  const ownerUid = clean(userId);
  const profileId = clean(requestedProfileId) || ownerUid;
  if (!ownerUid) {
    return { ok: false, status: 403, code: 'publication_author_owner_missing', error: 'Publication owner is missing' };
  }
  if (profileId === ownerUid) {
    return {
      ok: true,
      author: { profileId: ownerUid, ownerUid, isPersonal: true, displayName: '', type: 'personal' },
    };
  }
  if (!profileExists || !profileData || typeof profileData !== 'object') {
    return { ok: false, status: 400, code: 'publication_author_profile_missing', error: 'Het gekozen actieve profiel bestaat niet of is niet beschikbaar.' };
  }
  if (clean(profileData.ownerUid) !== ownerUid) {
    return { ok: false, status: 403, code: 'publication_author_owner_mismatch', error: 'Je kunt alleen publiceren namens een profiel dat je beheert.' };
  }
  if (profileData.status !== 'active' || !MANAGED_EXTERNAL_PROFILE_TYPES.has(profileData.type)) {
    return { ok: false, status: 400, code: 'publication_author_profile_inactive', error: 'Dit actieve profiel is niet beschikbaar om mee te publiceren.' };
  }
  return {
    ok: true,
    author: {
      profileId,
      ownerUid,
      isPersonal: false,
      displayName: clean(profileData.displayName),
      type: profileData.type,
    },
  };
};
