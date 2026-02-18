export const canAccessFirestore = ({ authReady, user }) => (
  authReady === true && Boolean(user?.uid)
);

export const isOnboardingComplete = (profile) => (
  profile?.onboardingComplete === true
  || Number(profile?.onboardingStep || 0) >= 5
);

export const canStartModeration = ({ authReady, user, profile, config }) => {
  if (!canAccessFirestore({ authReady, user })) return false;
  if (user?.emailVerified !== true) return false;
  if (profile?.ageVerified !== true) return false;
  if (profile?.isAdult !== true) return false;

  const claimModerator = user?.isModerator === true || user?.claims?.moderator === true;
  const allowlist = Array.isArray(config?.moderatorEmails) ? config.moderatorEmails : [];
  const allowlisted = Boolean(user?.email && allowlist.includes(user.email));

  return claimModerator || allowlisted;
};

export const devLog = (label, payload) => {
  if (!import.meta.env.DEV) return;
  console.log(label, payload);
};
