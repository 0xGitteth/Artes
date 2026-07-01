const toCleanString = (value) => String(value || '').trim();

const PUBLIC_DISPLAY_NAME_PLACEHOLDERS = new Set([
  'onbekende maker',
  'gebruiker',
  'artes gebruiker',
  'nieuwe maker',
]);

export const isPublicDisplayNamePlaceholder = (value) => (
  PUBLIC_DISPLAY_NAME_PLACEHOLDERS.has(toCleanString(value).toLowerCase())
);

export const normalizeSeedDisplayName = (value) => {
  const cleaned = toCleanString(value);
  return cleaned && !isPublicDisplayNamePlaceholder(cleaned) ? cleaned : '';
};

export const resolvePublicDisplayName = (publicProfile = null) => {
  const displayName = toCleanString(publicProfile?.displayName);
  if (displayName) return displayName;

  const username = toCleanString(publicProfile?.username).replace(/^@+/, '');
  if (username) return username;

  return 'Gebruiker';
};

export const resolvePublicDisplayNameSeed = ({
  appPublicDisplayName = '',
  publicProfile = null,
  diditDisplayName = '',
  googleDisplayName = '',
} = {}) => {
  const appValue = normalizeSeedDisplayName(appPublicDisplayName);
  if (appValue) return appValue;

  const publicValue = normalizeSeedDisplayName(publicProfile?.displayName);
  if (publicValue) return publicValue;

  const diditSeed = normalizeSeedDisplayName(diditDisplayName);
  if (diditSeed) return diditSeed;

  return normalizeSeedDisplayName(googleDisplayName);
};

export const resolveOnboardingDisplayNameState = ({
  currentDisplayName = '',
  fieldEdited = false,
  appPublicDisplayName = '',
  publicProfile = null,
  diditDisplayName = '',
  googleDisplayName = '',
} = {}) => {
  if (fieldEdited) return toCleanString(currentDisplayName);
  return resolvePublicDisplayNameSeed({
    appPublicDisplayName,
    publicProfile,
    diditDisplayName,
    googleDisplayName,
  });
};

export const shouldIncludeGoogleDisplayNameSeed = ({
  isGoogleUser = false,
  profileLoading = true,
  profile = null,
  publicProfile = null,
  googleDisplayName = '',
} = {}) => Boolean(
  isGoogleUser
  && !profileLoading
  && profile
  && !normalizeSeedDisplayName(profile?.displayName)
  && !normalizeSeedDisplayName(publicProfile?.displayName)
  && normalizeSeedDisplayName(googleDisplayName),
);
