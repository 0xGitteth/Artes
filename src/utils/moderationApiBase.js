const trimTrailingSlashes = (value) => String(value || '').trim().replace(/\/+$/, '');

export function resolveModerationApiBase(env = {}) {
  const explicitBase = trimTrailingSlashes(env?.VITE_MODERATION_API_BASE);
  if (explicitBase) return explicitBase;

  const moderationUrl = trimTrailingSlashes(env?.VITE_MODERATION_FUNCTION_URL);
  if (moderationUrl && moderationUrl.includes('/moderateImage')) {
    return trimTrailingSlashes(moderationUrl.replace('/moderateImage', ''));
  }

  const sharedFunctionsBase = trimTrailingSlashes(
    env?.VITE_FUNCTIONS_BASE_URL || env?.VITE_FUNCTIONS_BASE,
  );
  return sharedFunctionsBase;
}
