export const creditMatchesShadowProfile = (credit = {}, { name = '', contributorId = null } = {}) => {
  if (contributorId && credit?.contributorId === contributorId) return true;
  const creditName = String(credit?.name || credit?.displayName || '').trim();
  return Boolean(name && creditName === name);
};

export const getCanClaimShadowProfile = ({ isAnonymousDisplayOnly = false, contributorId = null } = {}) => Boolean(
  !isAnonymousDisplayOnly && contributorId,
);
