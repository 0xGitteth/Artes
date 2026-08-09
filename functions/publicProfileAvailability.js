const normalizeVisibilityValue = (value) => String(value || '').trim().toLowerCase();

export const isAvailablePersonalDmRecipient = (profile = {}) => {
  if (!profile || typeof profile !== 'object') return false;
  if (profile.onboardingComplete !== true) return false;
  if (profile.hidden === true) return false;
  if (normalizeVisibilityValue(profile.status) === 'inactive') return false;
  if (normalizeVisibilityValue(profile.visibility) === 'private') return false;
  if (normalizeVisibilityValue(profile.publicVisibility) === 'private') return false;
  if (normalizeVisibilityValue(profile.deactivatedReason) === 'underage') return false;
  return true;
};
