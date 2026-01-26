export const parseDebugHosts = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
};

export function debugAllowed() {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  if (!hostname) return false;

  const configuredHosts = parseDebugHosts(import.meta.env.VITE_DEBUG_HOSTS);
  if (configuredHosts.length > 0) {
    return configuredHosts.includes(hostname);
  }

  if (hostname === 'localhost') return true;
  return hostname.endsWith('.app.github.dev');
}
