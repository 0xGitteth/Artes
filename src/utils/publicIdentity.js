const toCleanString = (value) => String(value || '').trim();

export const resolvePublicDisplayName = (publicProfile = null) => {
  const displayName = toCleanString(publicProfile?.displayName);
  if (displayName) return displayName;

  const username = toCleanString(publicProfile?.username).replace(/^@+/, '');
  if (username) return username;

  return 'Gebruiker';
};
