export const parseDebugHosts = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
};

export function debugAllowed() {
  if (typeof window === 'undefined') return false;

  const hostname = window.location.hostname;

  // Always allow Codespaces
  if (hostname.endsWith('.app.github.dev')) return true;

  // Always allow localhost
  if (hostname === 'localhost') return true;

  const configuredHosts = parseDebugHosts(import.meta.env.VITE_DEBUG_HOSTS);
  if (configuredHosts.length > 0) {
    return configuredHosts.includes(hostname);
  }

  // Otherwise fall back to Vite dev flag
  return import.meta.env.DEV === true;
}
