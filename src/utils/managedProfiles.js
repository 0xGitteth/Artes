const normalizeId = (value) => String(value || '').trim();

const profileMatchesAuthUser = (candidate, authUid) => {
  if (!candidate || typeof candidate !== 'object') return false;
  const candidateUid = normalizeId(candidate.uid);
  return Boolean(candidateUid) && candidateUid === authUid;
};

const pickSourceProfile = ({ authUid, profile, publicProfile }) => {
  if (profileMatchesAuthUser(profile, authUid)) return profile;
  if (profileMatchesAuthUser(publicProfile, authUid)) return publicProfile;
  return null;
};

export const deriveManagedProfiles = ({ authUser = null, profile = null, publicProfile = null } = {}) => {
  const personalUid = normalizeId(authUser?.uid);
  if (!personalUid) return [];

  const sourceProfile = pickSourceProfile({ authUid: personalUid, profile, publicProfile });
  if (!sourceProfile) return [];

  return [
    {
      ...sourceProfile,
      id: personalUid,
      uid: personalUid,
      profileId: personalUid,
      ownerUid: personalUid,
      kind: 'personal',
      isPersonal: true,
    },
  ];
};

export const resolveActiveProfile = ({ managedProfiles = [], activeProfileId = null, personalProfileId = null } = {}) => {
  const profiles = Array.isArray(managedProfiles) ? managedProfiles.filter(Boolean) : [];
  if (!profiles.length) return null;

  const requestedId = normalizeId(activeProfileId);
  if (requestedId) {
    const requestedProfile = profiles.find((candidate) => candidate?.profileId === requestedId || candidate?.id === requestedId);
    if (requestedProfile) return requestedProfile;
  }

  const fallbackId = normalizeId(personalProfileId);
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
