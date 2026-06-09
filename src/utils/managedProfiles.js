const firstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
  }
  return '';
};

const pickSourceProfile = ({ profile, publicProfile }) => {
  if (profile && typeof profile === 'object') return profile;
  if (publicProfile && typeof publicProfile === 'object') return publicProfile;
  return null;
};

export const deriveManagedProfiles = ({ authUser = null, profile = null, publicProfile = null } = {}) => {
  const sourceProfile = pickSourceProfile({ profile, publicProfile });
  const personalUid = firstNonEmpty(profile?.uid, publicProfile?.uid, authUser?.uid);

  if (!personalUid || !sourceProfile) return [];

  const profileId = personalUid;
  const ownerUid = firstNonEmpty(authUser?.uid, personalUid);

  return [
    {
      ...sourceProfile,
      id: profileId,
      uid: personalUid,
      profileId,
      ownerUid,
      kind: 'personal',
      isPersonal: true,
    },
  ];
};

export const resolveActiveProfile = ({ managedProfiles = [], activeProfileId = null, personalProfileId = null } = {}) => {
  const profiles = Array.isArray(managedProfiles) ? managedProfiles.filter(Boolean) : [];
  if (!profiles.length) return null;

  const requestedId = String(activeProfileId || '').trim();
  if (requestedId) {
    const requestedProfile = profiles.find((candidate) => candidate?.profileId === requestedId || candidate?.id === requestedId);
    if (requestedProfile) return requestedProfile;
  }

  const fallbackId = String(personalProfileId || '').trim();
  if (fallbackId) {
    const personalProfile = profiles.find((candidate) => (
      candidate?.profileId === fallbackId
      || candidate?.uid === fallbackId
      || candidate?.id === fallbackId
    ));
    if (personalProfile) return personalProfile;
  }

  return profiles.find((candidate) => candidate?.isPersonal) || profiles[0];
};
