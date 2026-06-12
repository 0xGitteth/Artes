const normalizeId = (value) => String(value || '').trim();

const EXTERNAL_PROFILE_TYPES = new Set(['company', 'agency', 'collective']);
const ACTIVE_PROFILE_STATUS = 'active';
const LEGACY_ORGANIZATION_SETUP_SOURCE = 'legacyOrganization';


export const MANAGED_EXTERNAL_PROFILE_TYPES = ['company', 'agency', 'collective'];
export const LEGACY_ORGANIZATION_PROFILE_TYPES = ['company', 'agency', 'collective'];
export const LEGACY_ORGANIZATION_SETUP_PROFILE_SOURCE = LEGACY_ORGANIZATION_SETUP_SOURCE;
export const MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH = 120;
export const MAX_MANAGED_PROFILE_BIO_LENGTH = 500;
export const ACTIVE_PROFILE_STORAGE_KEY = 'artes.activeProfileId';
export const EXTERNAL_PROFILE_VIEW_PREFIX = 'externalProfile_';


export const getExternalProfileIdFromView = (view = '') => {
  const normalizedView = String(view || '');
  return normalizedView.startsWith(EXTERNAL_PROFILE_VIEW_PREFIX)
    ? normalizedView.slice(EXTERNAL_PROFILE_VIEW_PREFIX.length)
    : '';
};

export const validateManagedExternalProfileDraft = ({ type, displayName, bio = '' } = {}) => {
  const normalizedType = normalizeId(type);
  const normalizedDisplayName = String(displayName || '').trim();
  const normalizedBio = String(bio || '').trim();

  if (!EXTERNAL_PROFILE_TYPES.has(normalizedType)) {
    return { ok: false, error: 'Kies een profieltype.', type: normalizedType, displayName: normalizedDisplayName, bio: normalizedBio };
  }
  if (!normalizedDisplayName) {
    return { ok: false, error: 'Vul een naam in voor dit profiel.', type: normalizedType, displayName: normalizedDisplayName, bio: normalizedBio };
  }
  if (normalizedDisplayName.length > MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: `Gebruik maximaal ${MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH} tekens.`, type: normalizedType, displayName: normalizedDisplayName, bio: normalizedBio };
  }
  if (normalizedBio.length > MAX_MANAGED_PROFILE_BIO_LENGTH) {
    return { ok: false, error: `Gebruik maximaal ${MAX_MANAGED_PROFILE_BIO_LENGTH} tekens voor de omschrijving.`, type: normalizedType, displayName: normalizedDisplayName, bio: normalizedBio };
  }

  return { ok: true, type: normalizedType, displayName: normalizedDisplayName, bio: normalizedBio, error: null };
};

export const validateManagedExternalProfileEditDraft = ({ profile = {}, displayName, bio = '' } = {}) => {
  const normalizedProfile = profile && typeof profile === 'object' ? profile : {};
  const type = normalizeId(normalizedProfile.type || normalizedProfile.kind);
  return validateManagedExternalProfileDraft({ type, displayName, bio });
};

export const buildManagedExternalProfileUpdatePayload = ({ profile = {}, displayName, bio = '', avatar, timestamp } = {}) => {
  if (!isExternalManagedProfile(profile)) throw new Error('Dit profiel kan niet worden bewerkt.');
  const validation = validateManagedExternalProfileEditDraft({ profile, displayName, bio });
  if (!validation.ok) throw new Error(validation.error);

  const payload = {
    displayName: validation.displayName,
    bio: validation.bio,
    updatedAt: timestamp,
  };

  if (avatar !== undefined) {
    payload.avatar = String(avatar || '').trim();
  }

  return payload;
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
    : normalizedType === 'collective'
      ? ['collectiveName', 'collectiefName', 'businessName']
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


export const isManagedExternalProfileType = (type) => EXTERNAL_PROFILE_TYPES.has(normalizeId(type));

export const isExternalManagedProfile = (profile = {}) => isManagedExternalProfileType(profile?.type || profile?.kind);

export const isPublicManagedExternalProfileVisible = ({ profile = {} } = {}) => {
  if (!profile || typeof profile !== 'object') return false;
  if (!isExternalManagedProfile(profile)) return false;
  return normalizeId(profile.status || ACTIVE_PROFILE_STATUS) === ACTIVE_PROFILE_STATUS;
};


export const resolvePublicExternalProfileLoadState = ({ profileId = '', profile = null, error = '' } = {}) => {
  const normalizedProfileId = normalizeId(profileId);
  if (!normalizedProfileId) return { loading: false, profile: null, error: error || 'missing-id' };
  if (!profile || typeof profile !== 'object') return { loading: false, profile: null, error: error || 'missing' };
  const nextProfile = { id: normalizedProfileId, profileId: normalizedProfileId, ...profile };
  if (!isPublicManagedExternalProfileVisible({ profile: nextProfile })) {
    return { loading: false, profile: null, error: error || 'inactive' };
  }
  return { loading: false, profile: nextProfile, error: '' };
};

export const getPostOwnerUid = (post = {}) => normalizeId(post?.authorOwnerUid || post?.authorUid || post?.authorId);

export const isExternalAuthorProfilePost = (post = {}) => {
  const authorProfileId = normalizeId(post?.authorProfileId);
  const ownerUid = getPostOwnerUid(post);
  return Boolean(authorProfileId && ownerUid && authorProfileId !== ownerUid);
};

export const resolveAuthorQuickProfileTarget = ({ post = {}, profilesById = {}, viewerUid = '' } = {}) => {
  const ownerUid = getPostOwnerUid(post);
  const authorProfileId = normalizeId(post?.authorProfileId);
  if (!isExternalAuthorProfilePost(post)) {
    return { kind: 'personal', userId: ownerUid || normalizeId(post?.authorId), profileId: null, ownerUid: ownerUid || null };
  }

  const externalProfile = profilesById?.[authorProfileId] || null;
  if (externalProfile && isPublicManagedExternalProfileVisible({ profile: externalProfile, viewerUid })) {
    return { kind: 'external', profileId: authorProfileId, ownerUid: ownerUid || normalizeId(externalProfile.ownerUid), profile: externalProfile };
  }

  return {
    kind: 'externalUnavailable',
    profileId: authorProfileId,
    ownerUid: ownerUid || normalizeId(externalProfile?.ownerUid) || null,
    profile: null,
    reason: externalProfile ? 'inactive-external-profile' : 'missing-external-profile',
  };
};
export const getManagedProfileTypeLabel = (profile = {}) => {
  const kind = normalizeId(profile?.kind || profile?.type || (profile?.isPersonal ? 'personal' : ''));
  return PROFILE_TYPE_LABELS[kind] || PROFILE_TYPE_LABELS.personal;
};

export const getManagedProfileBio = (profile = {}) => String(profile?.bio || '').trim();

export const getManagedProfileAvatar = (profile = {}) => String(profile?.avatar || '').trim();

export const getManagedProfileInitials = (profile = {}) => {
  const displayName = getManagedProfileDisplayName(profile);
  const words = displayName.split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('');
  return initials || 'P';
};

export const getManagedProfileDisplayName = (profile = {}) => {
  const displayName = String(
    profile?.displayName
    || profile?.name
    || profile?.username
    || '',
  ).trim();
  const fallbackLabel = String(profile?.fallbackLabel || '').trim();

  return displayName || fallbackLabel || 'Naamloos profiel';
};

const ORGANIZATION_ROLE_HINTS = new Set(['agency', 'company', 'bedrijf', 'collective', 'collectief']);
const ORGANIZATION_TYPE_ROLE_HINTS = {
  company: ['company', 'bedrijf'],
  agency: ['agency'],
  collective: ['collective', 'collectief'],
};
const ORGANIZATION_NAME_HINT_FIELDS = [
  'linkedCompanyName',
  'linkedAgencyName',
  'companyName',
  'agencyName',
  'businessName',
  'collectiveName',
  'collectiefName',
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
const ORGANIZATION_TYPE_NAME_HINT_FIELDS = {
  company: ['linkedCompanyName', 'companyName'],
  agency: ['linkedAgencyName', 'agencyName'],
  collective: ['collectiveName', 'collectiefName'],
};
const ORGANIZATION_TYPE_ID_HINT_FIELDS = {
  company: ['linkedCompanyId', 'companyId'],
  agency: ['linkedAgencyId', 'agencyId'],
  collective: [],
};
const ORGANIZATION_TYPE_STATUS_HINT_FIELDS = {
  company: ['linkedCompanyStatus'],
  agency: ['linkedAgencyStatus'],
  collective: [],
};
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


const roleHintMatches = (roleHint, expectedHint) => {
  const role = String(roleHint || '').trim().toLowerCase();
  const expected = String(expectedHint || '').trim().toLowerCase();
  if (!role || !expected) return false;
  if (role === expected) return true;
  const tokens = role.split(/[^a-z0-9]+/i).filter(Boolean);
  return tokens.includes(expected);
};

const roleHintsContain = (roleHints, expectedHints = []) => (
  roleHints.some((roleHint) => expectedHints.some((expectedHint) => roleHintMatches(roleHint, expectedHint)))
);

const collectProfileRoleHints = (profile = {}) => (
  [profile?.role, profile?.roles, profile?.primaryRole, profile?.profileRole]
    .flatMap((entry) => collectRoleHints(entry))
);

const hasFilledField = (profile = {}, fields = []) => fields.some((field) => normalizeId(profile?.[field]));

const hasPositiveIdField = (profile = {}, fields = []) => fields.some((field) => {
  const value = normalizeId(profile?.[field]).toLowerCase();
  return Boolean(value) && !NEUTRAL_ORGANIZATION_HINT_VALUES.has(value);
});

const hasPositiveStatusField = (profile = {}, fields = []) => fields.some((field) => (
  POSITIVE_ORGANIZATION_STATUSES.has(normalizeId(profile?.[field]).toLowerCase())
));

const legacyOrganizationTypeHasHint = ({ profile = {}, roleHints = [], type = '' } = {}) => {
  const normalizedType = normalizeId(type);
  if (!EXTERNAL_PROFILE_TYPES.has(normalizedType)) return false;
  if (roleHintsContain(roleHints, ORGANIZATION_TYPE_ROLE_HINTS[normalizedType])) return true;
  if (hasFilledField(profile, ORGANIZATION_TYPE_NAME_HINT_FIELDS[normalizedType])) return true;
  if (hasPositiveIdField(profile, ORGANIZATION_TYPE_ID_HINT_FIELDS[normalizedType])) return true;
  if (hasPositiveStatusField(profile, ORGANIZATION_TYPE_STATUS_HINT_FIELDS[normalizedType])) return true;
  return false;
};

export const collectLegacyOrganizationProfileHints = (profile = {}) => {
  if (!profile || typeof profile !== 'object') return [];
  const roleHints = collectProfileRoleHints(profile);
  return LEGACY_ORGANIZATION_PROFILE_TYPES.filter((type) => (
    legacyOrganizationTypeHasHint({ profile, roleHints, type })
  ));
};

export const getLegacyOrganizationPrefillDisplayName = (profile = {}, type = 'company') => (
  getManagedProfilePrefillDisplayName(profile, type)
);

export const findManagedExternalProfileByType = (managedProfiles = [], type = '') => {
  const normalizedType = normalizeId(type);
  if (!EXTERNAL_PROFILE_TYPES.has(normalizedType)) return null;
  const profiles = Array.isArray(managedProfiles) ? managedProfiles : [];
  return profiles.find((profile) => {
    if (!profile || typeof profile !== 'object') return false;
    if (profile.isSetupProfile || profile.setupRequired || profile.source === LEGACY_ORGANIZATION_SETUP_SOURCE) return false;
    return isExternalManagedProfile(profile) && normalizeId(profile.type || profile.kind) === normalizedType;
  }) || null;
};

export const hasManagedExternalProfileOfType = (managedProfiles = [], type = '') => Boolean(
  findManagedExternalProfileByType(managedProfiles, type),
);

export const buildManagedProfileSetupCreateDraft = (setupProfile = {}) => {
  const setupType = normalizeId(setupProfile?.type || setupProfile?.kind || 'company');
  const type = EXTERNAL_PROFILE_TYPES.has(setupType) ? setupType : 'company';
  return {
    type,
    displayName: String(setupProfile?.displayName || '').trim().slice(0, MAX_MANAGED_PROFILE_DISPLAY_NAME_LENGTH),
    fallbackLabel: String(setupProfile?.fallbackLabel || PROFILE_TYPE_LABELS[type] || '').trim(),
    setupProfile,
  };
};

export const isManagedProfileSetupRequired = (profile = {}) => Boolean(
  profile?.isSetupProfile === true
  && profile?.setupRequired === true
  && profile?.source === LEGACY_ORGANIZATION_SETUP_SOURCE,
);

export const buildLegacyOrganizationSetupProfiles = ({ personalProfile = null, managedProfiles = [] } = {}) => {
  if (!personalProfile || typeof personalProfile !== 'object') return [];
  const ownerUid = normalizeId(personalProfile.uid || personalProfile.ownerUid || personalProfile.profileId || personalProfile.id);
  if (!ownerUid) return [];

  return collectLegacyOrganizationProfileHints(personalProfile).reduce((setupProfiles, type) => {
    if (hasManagedExternalProfileOfType(managedProfiles, type)) return setupProfiles;
    setupProfiles.push({
      isSetupProfile: true,
      setupRequired: true,
      source: LEGACY_ORGANIZATION_SETUP_SOURCE,
      type,
      kind: type,
      profileId: `legacy_${type}_${ownerUid}`,
      id: `legacy_${type}_${ownerUid}`,
      ownerUid,
      status: 'setup',
      displayName: getLegacyOrganizationPrefillDisplayName(personalProfile, type),
      fallbackLabel: PROFILE_TYPE_LABELS[type],
      isPersonal: false,
    });
    return setupProfiles;
  }, []);
};

export const personalProfileHasOrganizationHints = (profile = {}) => {
  if (!profile || typeof profile !== 'object') return false;

  const roleHints = collectProfileRoleHints(profile);
  if (roleHintsContain(roleHints, Array.from(ORGANIZATION_ROLE_HINTS))) return true;

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




export const MANAGED_PROFILE_SETUP_STATUS_LABEL = 'Nog niet openbaar';

const MANAGED_PROFILE_SETUP_ROLE_ONLY_COPY = {
  company: 'Je hebt eerder Bedrijf/Studio als rol gekozen. Stel dit profiel in om het apart te beheren en ermee te publiceren.',
  agency: 'Je hebt eerder Agency als rol gekozen. Stel dit profiel in om het apart te beheren en ermee te publiceren.',
  collective: 'Je hebt eerder Collectief als rol gekozen. Stel dit profiel in om het apart te beheren en ermee te publiceren.',
};

const MANAGED_PROFILE_SETUP_ACTION_LABELS = {
  company: 'Bedrijfsprofiel instellen',
  agency: 'Agency instellen',
  collective: 'Collectief instellen',
};

export const getManagedProfileSetupStatusLabel = () => MANAGED_PROFILE_SETUP_STATUS_LABEL;

export const getManagedProfileSetupDescription = (profile = {}) => {
  const type = normalizeId(profile?.type || profile?.kind);
  const hasDisplayName = Boolean(String(profile?.displayName || '').trim());
  if (hasDisplayName) {
    return 'Dit profiel is klaargezet op basis van je bestaande gegevens. Stel het in om het apart te beheren en ermee te publiceren.';
  }
  return MANAGED_PROFILE_SETUP_ROLE_ONLY_COPY[type]
    || 'Stel dit profiel in om het apart te beheren en ermee te publiceren.';
};

export const getManagedProfileSetupActionLabel = (profile = {}) => {
  const type = normalizeId(profile?.type || profile?.kind);
  return MANAGED_PROFILE_SETUP_ACTION_LABELS[type] || 'Profiel instellen';
};

export const shouldShowManagedProfileSetupProfile = ({ profile = {}, currentUserId = '', ownerUid = '' } = {}) => {
  if (!isManagedProfileSetupRequired(profile)) return false;
  const viewerUid = normalizeId(currentUserId);
  const setupOwnerUid = normalizeId(profile?.ownerUid || ownerUid);
  return Boolean(viewerUid && setupOwnerUid && viewerUid === setupOwnerUid);
};

export const getOwnerVisibleManagedProfileSetupProfiles = ({ setupProfiles = [], currentUserId = '', ownerUid = '' } = {}) => {
  const profiles = Array.isArray(setupProfiles) ? setupProfiles.filter(Boolean) : [];
  return profiles.filter((profile) => shouldShowManagedProfileSetupProfile({ profile, currentUserId, ownerUid }));
};

export const getManagedProfileSwitcherProfiles = (managedProfiles = []) => (
  Array.isArray(managedProfiles) ? managedProfiles.filter((profile) => getManagedProfileId(profile)) : []
);

export const getManagedProfileSwitcherActiveIndex = ({ managedProfiles = [], activeProfile = null } = {}) => {
  const profiles = getManagedProfileSwitcherProfiles(managedProfiles);
  if (!profiles.length) return -1;

  const activeProfileId = getManagedProfileId(activeProfile);
  if (activeProfileId) {
    const activeIndex = profiles.findIndex((profile) => getManagedProfileId(profile) === activeProfileId);
    if (activeIndex >= 0) return activeIndex;
  }

  const personalIndex = profiles.findIndex((profile) => profile?.isPersonal);
  return personalIndex >= 0 ? personalIndex : 0;
};

export const shouldShowManagedProfileHeaderSwitcher = ({ isOwn = false, managedProfiles = [] } = {}) => (
  Boolean(isOwn) && getManagedProfileSwitcherProfiles(managedProfiles).length > 1
);

export const getManagedProfileAtSwitcherOffset = ({ managedProfiles = [], activeProfile = null, offset = 0 } = {}) => {
  const profiles = getManagedProfileSwitcherProfiles(managedProfiles);
  if (!profiles.length) return null;

  const activeIndex = getManagedProfileSwitcherActiveIndex({ managedProfiles: profiles, activeProfile });
  if (activeIndex < 0) return null;

  const normalizedOffset = Number.isFinite(offset) ? offset : 0;
  const nextIndex = (activeIndex + normalizedOffset + profiles.length) % profiles.length;
  return profiles[nextIndex] || null;
};

export const getNextManagedProfileForSwipe = ({ managedProfiles = [], activeProfile = null } = {}) => (
  getManagedProfileAtSwitcherOffset({ managedProfiles, activeProfile, offset: 1 })
);

export const getPreviousManagedProfileForSwipe = ({ managedProfiles = [], activeProfile = null } = {}) => (
  getManagedProfileAtSwitcherOffset({ managedProfiles, activeProfile, offset: -1 })
);

export const getManagedProfileHeaderSwipeDirection = ({ deltaX = 0, deltaY = 0, threshold = 48, dominanceRatio = 1.25 } = {}) => {
  const horizontalDelta = Number(deltaX) || 0;
  const verticalDelta = Number(deltaY) || 0;
  const minimumDistance = Math.max(0, Number(threshold) || 0);
  const requiredDominance = Math.max(1, Number(dominanceRatio) || 1);
  const absX = Math.abs(horizontalDelta);
  const absY = Math.abs(verticalDelta);

  if (absX < minimumDistance) return null;
  if (absX < absY * requiredDominance) return null;

  return horizontalDelta < 0 ? 'next' : 'previous';
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
  const externalProfiles = profiles.filter((candidate) => !candidate?.isPersonal && !isManagedProfileSetupRequired(candidate));
  const setupProfiles = buildLegacyOrganizationSetupProfiles({ personalProfile, managedProfiles: externalProfiles });

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
    setupProfiles: setupProfiles.map(decorateProfile),
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
    bio: getManagedProfileBio(candidate),
    avatar: getManagedProfileAvatar(candidate),
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


export const buildManagedExternalProfileUpdateRequest = ({ profile, displayName, bio, avatar, avatarBlob } = {}) => {
  const request = { profile, displayName, bio };
  if (avatar !== undefined) request.avatar = avatar;
  if (avatarBlob !== undefined) request.avatarBlob = avatarBlob;
  return request;
};

export const mergeManagedExternalProfileUpdate = (managedProfiles = [], updatedProfile = {}) => {
  const updatedProfileId = getManagedProfileId(updatedProfile);
  if (!updatedProfileId || !Array.isArray(managedProfiles)) return Array.isArray(managedProfiles) ? managedProfiles : [];
  return managedProfiles.map((profile) => (
    getManagedProfileId(profile) === updatedProfileId ? { ...profile, ...updatedProfile } : profile
  ));
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
