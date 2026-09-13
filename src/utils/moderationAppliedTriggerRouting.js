export const resolvePolicyAppliedTriggersForPublication = ({
  moderationData = null,
  policyAppliedTriggers = [],
} = {}) => {
  if (moderationData) {
    return Array.isArray(moderationData.policyAppliedTriggers)
      ? moderationData.policyAppliedTriggers
      : [];
  }
  return Array.isArray(policyAppliedTriggers) ? policyAppliedTriggers : [];
};
