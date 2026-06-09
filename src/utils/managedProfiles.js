const normalizeId = (value) => String(value || '').trim();

const EXTERNAL_PROFILE_TYPES = new Set(['company', 'agency', 'collective']);
const ACTIVE_PROFILE_STATUS = 'active';

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

export const normalizeManagedExternalProfile = (candidate, authUid) => {
  if (!candidate || typeof candidate !== 'object') return null;

  const ownerUid = normalizeId(candidate.ownerUid);
  if (!ownerUid || ownerUid !== authUid) return null;

  const type = normalizeId(candidate.type);
  if (!EXTERNAL_PROFILE_TYPES.has(type)) return null;

  const status = normalizeId(candidate.status);
  if (status !== ACTIVE_PROFILE_STATUS) return null;

  const profileId = normalizeId(candidate.profileId || candidate.id);
  if (!profileId || profileId === authUid) return null;

  const displayName = String(candidate.displayName || '').trim();
  if (!displayName) return null;

  const managerUids = Array.isArray(candidate.managerUids)
    ? candidate.managerUids.map(normalizeId).filter(Boolean)
    : [];

  const normalized = {
    id: profileId,
    profileId,
    type,
    kind: type,
    displayName,
    ownerUid,
    managerUids,
    status: ACTIVE_PROFILE_STATUS,
    isPersonal: false,
  };

  if (candidate.createdAt) normalized.createdAt = candidate.createdAt;
  if (candidate.updatedAt) normalized.updatedAt = candidate.updatedAt;

  return normalized;
};

export const normalizeManagedExternalProfiles = (managedExternalProfiles = [], authUid = '') => {
  if (!Array.isArray(managedExternalProfiles)) return [];
  const seenProfileIds = new Set();
  return managedExternalProfiles.reduce((profiles, candidate) => {
    const normalized = normalizeManagedExternalProfile(candidate, authUid);
    if (!normalized || seenProfileIds.has(normalized.profileId)) return profiles;
    seenProfileIds.add(normalized.profileId);
    profiles.push(normalized);
    return profiles;
  }, []);
};

export const deriveManagedProfiles = ({
  authUser = null,
  profile = null,
  publicProfile = null,
  managedExternalProfiles = [],
} = {}) => {
  const personalUid = normalizeId(authUser?.uid);
  if (!personalUid) return [];

  const sourceProfile = pickSourceProfile({ authUid: personalUid, profile, publicProfile });
  if (!sourceProfile) return [];

  const personalProfile = {
    ...sourceProfile,
    id: personalUid,
    uid: personalUid,
    profileId: personalUid,
    ownerUid: personalUid,
    kind: 'personal',
    isPersonal: true,
  };

  return [
    personalProfile,
    ...normalizeManagedExternalProfiles(managedExternalProfiles, personalUid),
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
