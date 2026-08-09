const normalizeVisibilityValue = (value) => String(value || '').trim().toLowerCase();

export const isPersonalOnboardingComplete = (profile = {}) => (
  profile?.onboardingComplete === true || Number(profile?.onboardingStep || 0) >= 5
);

export const isAvailablePersonalPublicProfile = (profile = {}) => {
  if (!profile || typeof profile !== 'object') return false;
  if (profile.onboardingComplete !== true) return false;
  if (profile.hidden === true) return false;
  if (normalizeVisibilityValue(profile.status) === 'inactive') return false;
  if (normalizeVisibilityValue(profile.visibility) === 'private') return false;
  if (normalizeVisibilityValue(profile.publicVisibility) === 'private') return false;
  if (normalizeVisibilityValue(profile.deactivatedReason)) return false;
  return true;
};

export const isLegitimatelyPublishedPersonalProfile = ({
  privateProfile = {},
  publicProfile = {},
} = {}) => (
  isPersonalOnboardingComplete(privateProfile)
  && isAvailablePersonalPublicProfile(publicProfile)
);

export const isAvailablePersonalDmRecipient = isAvailablePersonalPublicProfile;
