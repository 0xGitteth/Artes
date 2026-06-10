const normalizeId = (value) => String(value || '').trim();

const EXTERNAL_PROFILE_TYPES = new Set(['company', 'agency', 'collective']);
const ACTIVE_PROFILE_STATUS = 'active';


export const MANAGED_EXTERNAL_PROFILE_TYPES = ['company', 'agency', 'collective'];
export const MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH = 120;
export const ACTIVE_PROFILE_STORAGE_KEY = 'artes.activeProfileId';

export const validateManagedExternalProfileDraft = ({ type, displayName } = {}) => {
  const normalizedType = normalizeId(type);
  const normalizedDisplayName = String(displayName || '').trim();

  if (!EXTERNAL_PROFILE_TYPES.has(normalizedType)) {
    return { ok: false, error: 'Kies een profieltype.', type: normalizedType, displayName: normalizedDisplayName };
  }
  if (!normalizedDisplayName) {
    return { ok: false, error: 'Vul een naam in voor dit profiel.', type: normalizedType, displayName: normalizedDisplayName };
  }
  if (normalizedDisplayName.length > MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: `Gebruik maximaal ${MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH} tekens.`, type: normalizedType, displayName: normalizedDisplayName };
  }

  return { ok: true, type: normalizedType, displayName: normalizedDisplayName, error: null };
};

export const buildManagedExternalProfileCreatePayload = ({ authUid, type, displayName, timestamp } = {}) => {
  const ownerUid = normalizeId(authUid);
  if (!ownerUid) throw new Error('Je moet ingelogd zijn om een profiel aan te maken.');

  const validation = validateManagedExternalProfileDraft({ type, displayName });
  if (!validation.ok) throw new Error(validation.error);

  return {
    type: validation.type,
    displayName: validation.displayName,
    ownerUid,
    status: ACTIVE_PROFILE_STATUS,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createManagedExternalProfileId = ({ authUid, createId, maxAttempts = 5 } = {}) => {
  const ownerUid = normalizeId(authUid);
  if (!ownerUid) throw new Error('Je moet ingelogd zijn om een profiel aan te maken.');
  if (typeof createId !== 'function') throw new Error('Profiel-id aanmaken mislukt.');

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const profileId = normalizeId(createId());
    if (profileId && profileId !== ownerUid) return profileId;
  }

  throw new Error('Profiel-id aanmaken mislukt. Probeer het opnieuw.');
};

export const getManagedProfilePrefillDisplayName = (profile = {}, type = 'company') => {
  if (!profile || typeof profile !== 'object') return '';
  const normalizedType = normalizeId(type);
  const fields = normalizedType === 'agency'
    ? ['linkedAgencyName', 'agencyName', 'businessName']
    : ['linkedCompanyName', 'companyName', 'businessName'];
  const value = fields.map((field) => String(profile[field] || '').trim()).find(Boolean) || '';
  return value.slice(0, MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH);
};

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
    || '',
  ).trim();

  return displayName || 'Naamloos profiel';
};

const ORGANIZATION_ROLE_HINTS = new Set(['agency', 'company', 'bedrijf']);
const ORGANIZATION_NAME_HINT_FIELDS = [
  'linkedCompanyName',
  'linkedAgencyName',
  'companyName',
  'agencyName',
  'businessName',
];
const ORGANIZATION_ID_HINT_FIELDS = [
  'linkedCompanyId',
  'linkedAgencyId',
  'companyId',
  'agencyId',
];
const ORGANIZATION_STATUS_HINT_FIELDS = [
  'linkedCompanyStatus',
  'linkedAgencyStatus',
];
const POSITIVE_ORGANIZATION_STATUSES = new Set(['linked', 'approved', 'active', 'verified']);
const NEUTRAL_ORGANIZATION_HINT_VALUES = new Set(['none', 'unlinked', 'rejected', 'empty', 'unknown', 'null', 'undefined']);

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

  const hasNameHint = ORGANIZATION_NAME_HINT_FIELDS.some((field) => normalizeId(profile[field]));
  if (hasNameHint) return true;

  const hasIdHint = ORGANIZATION_ID_HINT_FIELDS.some((field) => {
    const value = normalizeId(profile[field]).toLowerCase();
    return Boolean(value) && !NEUTRAL_ORGANIZATION_HINT_VALUES.has(value);
  });
  if (hasIdHint) return true;

  return ORGANIZATION_STATUS_HINT_FIELDS.some((field) => (
    POSITIVE_ORGANIZATION_STATUSES.has(normalizeId(profile[field]).toLowerCase())
  ));
};

export const getManagedProfileId = (profile = {}) => normalizeId(profile?.profileId || profile?.id || profile?.uid);

export const isManagedProfileActive = (profile = {}, activeProfile = {}) => {
  const profileId = getManagedProfileId(profile);
  const activeProfileId = getManagedProfileId(activeProfile);
  return Boolean(profileId && activeProfileId && profileId === activeProfileId);
};

export const getManagedProfileSettingsAction = (profile = {}, activeProfile = {}) => {
  const isActive = isManagedProfileActive(profile, activeProfile);
  return {
    isActive,
    statusLabel: isActive ? 'Actief' : '',
    actionLabel: isActive ? '' : 'Beheren als',
  };
};

export const buildManagedProfilesSettingsModel = (managedProfiles = [], activeProfile = null) => {
  const profiles = Array.isArray(managedProfiles) ? managedProfiles.filter(Boolean) : [];
  const personalProfile = profiles.find((candidate) => candidate?.isPersonal) || null;
  const externalProfiles = profiles.filter((candidate) => !candidate?.isPersonal);

  const decorateProfile = (profile) => {
    if (!profile) return null;
    return {
      ...profile,
      settingsAction: getManagedProfileSettingsAction(profile, activeProfile),
    };
  };

  return {
    personalProfile: decorateProfile(personalProfile),
    externalProfiles: externalProfiles.map(decorateProfile),
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


export const getBrowserStorage = (storageGetter) => {
  if (typeof storageGetter !== 'function') return null;
  try {
    const storage = storageGetter();
    if (!storage || typeof storage !== 'object') return null;
    return storage;
  } catch {
    return null;
  }
};


export const resolvePostAuthorProfile = ({ authUid, requestedProfileId, profileDoc } = {}) => {
  const ownerUid = normalizeId(authUid);
  if (!ownerUid) throw new Error('Je moet ingelogd zijn om te publiceren.');

  const requestedId = normalizeId(requestedProfileId);
  if (!requestedId || requestedId === ownerUid) {
    return {
      profileId: ownerUid,
      ownerUid,
      isPersonal: true,
    };
  }

  const externalProfile = profileDoc && typeof profileDoc === 'object' ? profileDoc : null;
  const externalProfileId = normalizeId(externalProfile?.profileId || externalProfile?.id || requestedId);
  const externalOwnerUid = normalizeId(externalProfile?.ownerUid);
  const externalStatus = normalizeId(externalProfile?.status);
  const externalType = normalizeId(externalProfile?.type || externalProfile?.kind);

  if (externalProfileId !== requestedId) {
    throw new Error('Het gekozen actieve profiel is ongeldig. Kies opnieuw via Mijn profielen.');
  }
  if (externalOwnerUid !== ownerUid) {
    throw new Error('Je kunt alleen publiceren namens een profiel dat je beheert.');
  }
  if (externalStatus !== ACTIVE_PROFILE_STATUS) {
    throw new Error('Dit actieve profiel is niet beschikbaar om mee te publiceren.');
  }
  if (!EXTERNAL_PROFILE_TYPES.has(externalType)) {
    throw new Error('Dit profieltype kan niet worden gebruikt om te publiceren.');
  }

  return {
    profileId: requestedId,
    ownerUid,
    isPersonal: false,
    type: externalType,
    displayName: String(externalProfile.displayName || '').trim(),
  };
};

export const buildPostAuthorFields = ({ authUid, resolvedProfileId } = {}) => {
  const ownerUid = normalizeId(authUid);
  const profileId = normalizeId(resolvedProfileId) || ownerUid;
  if (!ownerUid) throw new Error('Je moet ingelogd zijn om te publiceren.');

  return {
    authorId: ownerUid,
    authorUid: ownerUid,
    authorOwnerUid: ownerUid,
    authorProfileId: profileId,
  };
};

export const resolvePostAuthorDisplayNameFromProfiles = ({ post, users = [], profilesById = {} } = {}) => {
  const authorProfileId = normalizeId(post?.authorProfileId);
  const authorId = normalizeId(post?.authorId || post?.authorUid || post?.authorOwnerUid);
  const externalProfile = authorProfileId && authorProfileId !== authorId ? profilesById?.[authorProfileId] : null;
  const externalName = externalProfile?.displayName;
  const publicName = Array.isArray(users)
    ? users.find((entry) => entry?.uid === authorId)?.displayName
    : '';
  return getManagedProfileDisplayName({ displayName: externalName || publicName || post?.authorName || 'Onbekend' });
};

export const readStoredActiveProfileId = (storage) => {
  try {
    if (!storage || typeof storage.getItem !== 'function') return null;
    return normalizeId(storage.getItem(ACTIVE_PROFILE_STORAGE_KEY)) || null;
  } catch {
    return null;
  }
};

export const writeStoredActiveProfileId = (storage, activeProfileId) => {
  try {
    if (!storage || typeof storage.setItem !== 'function') return;
    const normalizedActiveProfileId = normalizeId(activeProfileId);
    if (!normalizedActiveProfileId) {
      if (typeof storage.removeItem === 'function') storage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
      return;
    }
    storage.setItem(ACTIVE_PROFILE_STORAGE_KEY, normalizedActiveProfileId);
  } catch {
    // Active profile persistence is best effort; unavailable storage must not break rendering.
  }
};

export const shouldDelayActiveProfilePersistence = ({
  managedProfiles = [],
  requestedActiveProfileId = null,
  managedExternalProfilesLoaded = true,
} = {}) => {
  const requestedId = normalizeId(requestedActiveProfileId);
  if (!requestedId || managedExternalProfilesLoaded) return false;
  const profiles = Array.isArray(managedProfiles) ? managedProfiles.filter(Boolean) : [];
  return !profiles.some((candidate) => getManagedProfileId(candidate) === requestedId);
};

export const normalizeRequestedActiveProfileId = ({
  managedProfiles = [],
  activeProfile = null,
  requestedActiveProfileId = null,
  managedExternalProfilesLoaded = true,
} = {}) => {
  const requestedId = normalizeId(requestedActiveProfileId);
  const fallbackProfileId = getManagedProfileId(activeProfile) || null;
  const profiles = Array.isArray(managedProfiles) ? managedProfiles.filter(Boolean) : [];
  const requestedProfileStillManaged = profiles.some((candidate) => getManagedProfileId(candidate) === requestedId);
  if (requestedProfileStillManaged) return requestedId;
  if (requestedId && !managedExternalProfilesLoaded) return requestedId;
  if (!fallbackProfileId) return null;
  return fallbackProfileId;
};
