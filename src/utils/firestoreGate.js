export const canAccessFirestore = ({ authReady, user }) => (
  authReady === true && Boolean(user?.uid)
);

export const isOnboardingComplete = (profile) => (
  profile?.onboardingComplete === true
  || Number(profile?.onboardingStep || 0) >= 5
);

const toFiniteOnboardingStep = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const isExplicitOnboardingReset = (patch = {}) => (
  patch?.onboardingComplete === false
  && toFiniteOnboardingStep(patch?.onboardingStep) !== null
  && toFiniteOnboardingStep(patch?.onboardingStep) < 5
);

export const normalizeOnboardingWritePatch = (existing = {}, patch = {}) => {
  const nextPatch = { ...patch };
  const hasStep = Object.prototype.hasOwnProperty.call(nextPatch, 'onboardingStep');
  const hasComplete = Object.prototype.hasOwnProperty.call(nextPatch, 'onboardingComplete');
  if (!hasStep && !hasComplete) return nextPatch;

  const previousStep = toFiniteOnboardingStep(existing?.onboardingStep);
  const requestedStep = hasStep ? toFiniteOnboardingStep(nextPatch.onboardingStep) : null;
  // Lower onboarding writes stay monotonic unless the caller explicitly pairs
  // an incomplete step with the false completion marker.
  const explicitReset = isExplicitOnboardingReset(nextPatch);

  if (requestedStep !== null) {
    nextPatch.onboardingStep = explicitReset
      ? requestedStep
      : previousStep === null
        ? requestedStep
        : Math.max(previousStep, requestedStep);
  }

  if (hasComplete) {
    nextPatch.onboardingComplete = explicitReset
      ? false
      : isOnboardingComplete(existing) || nextPatch.onboardingComplete === true;
  }

  return nextPatch;
};

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
