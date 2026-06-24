const toCleanString = (value) => String(value || '').trim();

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
  const appValue = toCleanString(appPublicDisplayName);
  if (appValue) return appValue;

  const publicValue = toCleanString(publicProfile?.displayName);
  if (publicValue) return publicValue;

  const diditSeed = toCleanString(diditDisplayName);
  if (diditSeed) return diditSeed;

  return toCleanString(googleDisplayName);
};
