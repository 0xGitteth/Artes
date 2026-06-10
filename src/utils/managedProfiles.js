const normalizeId = (value) => String(value || '').trim();

const EXTERNAL_PROFILE_TYPES = new Set(['company', 'agency', 'collective']);
const ACTIVE_PROFILE_STATUS = 'active';

export const PROFILE_TYPE_LABELS = {
  personal: 'Persoonlijk profiel',
  company: 'Bedrijfsprofiel',
  agency: 'Agency',
  collective: 'Collectief',
};

export const getManagedProfileTypeLabel = (profile = {}) => {
  const kind = normalizeId(profile?.kind || profile?.type || (profile?.isPersonal ? 'personal' : ''));
  return PROFILE_TYPE_LABELS[kind] || PROFILE_TYPE_LABELS.personal;
};

export const getManagedProfileDisplayName = (profile = {}) => {
  const displayName = String(
    profile?.displayName
    || profile?.name
    || profile?.username
    || profile?.email
    || '',
  ).trim();

  return displayName || 'Naamloos profiel';
};

const ORGANIZATION_ROLE_HINTS = new Set(['agency', 'company', 'bedrijf']);
const ORGANIZATION_FIELD_HINTS = [
  'linkedCompanyId',
  'linkedCompanyName',
  'linkedCompanyStatus',
  'linkedAgencyId',
  'linkedAgencyName',
  'linkedAgencyStatus',
  'companyId',
  'companyName',
  'agencyId',
  'agencyName',
  'businessName',
];

const collectRoleHints = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectRoleHints(entry));
  if (typeof value === 'object') {
    return [value.id, value.value, value.name, value.label, value.role]
      .flatMap((entry) => collectRoleHints(entry));
  }
  return [String(value).trim().toLowerCase()].filter(Boolean);
};

export const personalProfileHasOrganizationHints = (profile = {}) => {
  if (!profile || typeof profile !== 'object') return false;

  const roleHints = [profile.role, profile.roles, profile.primaryRole, profile.profileRole]
    .flatMap((entry) => collectRoleHints(entry));
  if (roleHints.some((role) => ORGANIZATION_ROLE_HINTS.has(role))) return true;

  return ORGANIZATION_FIELD_HINTS.some((field) => {
    const value = profile[field];
    return value !== undefined && value !== null && String(value).trim() !== '';
  });
};

export const buildManagedProfilesSettingsModel = (managedProfiles = []) => {
  const profiles = Array.isArray(managedProfiles) ? managedProfiles.filter(Boolean) : [];
  const personalProfile = profiles.find((candidate) => candidate?.isPersonal) || null;
  const externalProfiles = profiles.filter((candidate) => !candidate?.isPersonal);

  return {
    personalProfile,
    externalProfiles,
    hasExternalProfiles: externalProfiles.length > 0,
    hasPersonalOrganizationHints: personalProfileHasOrganizationHints(personalProfile),
  };
};

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

  const normalized = {
    id: profileId,
    profileId,
    type,
    kind: type,
    displayName,
    ownerUid,
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
