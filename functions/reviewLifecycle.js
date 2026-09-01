const toFiniteNonNegativeInteger = (value, fallback = 0) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.floor(numeric));
};

const timestampToMillis = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value.getTime === 'function') {
    const millis = Number(value.getTime());
    return Number.isFinite(millis) ? millis : null;
  }
  const seconds = Number(value.seconds ?? value._seconds);
  const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
  if (Number.isFinite(seconds)) {
    return (seconds * 1000) + (Number.isFinite(nanoseconds) ? Math.floor(nanoseconds / 1e6) : 0);
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const getReviewAccessDecision = ({
  reviewRightsLevel = 1,
  openReviewCount = 0,
  cooldownUntil = null,
  nowMs = Date.now(),
} = {}) => {
  const rightsLevel = Number(reviewRightsLevel ?? 1);
  const normalizedRightsLevel = Number.isFinite(rightsLevel) ? rightsLevel : 1;
  const normalizedOpenReviewCount = toFiniteNonNegativeInteger(openReviewCount, 0);
  const cooldownUntilMs = timestampToMillis(cooldownUntil);
  const hasReviewRights = normalizedRightsLevel > 0;
  const inCooldown = Number.isFinite(cooldownUntilMs) && cooldownUntilMs > Number(nowMs);
  const reviewCapacityAvailable = normalizedOpenReviewCount < 1;

  let code = null;
  let status = null;
  let message = null;
  if (!hasReviewRights) {
    code = 'review_rights_disabled';
    status = 403;
    message = 'Review rights are disabled';
  } else if (inCooldown) {
    code = 'review_cooldown_active';
    status = 429;
    message = 'Review request is in cooldown';
  } else if (!reviewCapacityAvailable) {
    code = 'review_limit_reached';
    status = 409;
    message = 'Another upload review case is already open';
  }

  return {
    allowed: hasReviewRights && !inCooldown && reviewCapacityAvailable,
    hasReviewRights,
    inCooldown,
    reviewCapacityAvailable,
    openReviewCount: normalizedOpenReviewCount,
    cooldownUntilMs,
    code,
    status,
    message,
  };
};

export const getOpenReviewCountAfterCaseExit = ({
  openReviewCount = 0,
  wasOpenUploadCase = false,
} = {}) => {
  const normalizedOpenReviewCount = toFiniteNonNegativeInteger(openReviewCount, 0);
  if (!wasOpenUploadCase) return normalizedOpenReviewCount;
  return Math.max(0, normalizedOpenReviewCount - 1);
};
