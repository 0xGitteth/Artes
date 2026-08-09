const pendingResetUids = new Set();

export const markConfirmedOnboardingReset = (uid) => {
  if (uid) pendingResetUids.add(uid);
};

export const hasPendingOnboardingReset = (uid) => Boolean(uid && pendingResetUids.has(uid));

export const reconcileConfirmedOnboardingReset = (uid, profile) => {
  if (!hasPendingOnboardingReset(uid)) return false;
  if (profile?.onboardingComplete === false && Number(profile?.onboardingStep) === 2) {
    pendingResetUids.delete(uid);
  }
  return true;
};

export const clearConfirmedOnboardingResetForTests = () => pendingResetUids.clear();
