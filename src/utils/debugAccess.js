// Functie om de hostnamen uit VITE_DEBUG_HOSTS te parsen
export const parseDebugHosts = (value) => {
  if (!value) return [];
  return value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
};

// Debugfunctie: bepaalt of debug/login zichtbaar mag zijn
export function debugAllowed() {
  // Geen debug tijdens server-side rendering
  if (typeof window === 'undefined') return false;

  // Toestaan in lokale dev, of expliciet in build/staging via VITE_ENABLE_DEBUG_PAGE=1
  const debugByMode = import.meta.env.DEV === true || import.meta.env.VITE_ENABLE_DEBUG_PAGE === '1';
  if (!debugByMode) return false;

  // Host moet lokaal of expliciet in VITE_DEBUG_HOSTS staan
  const hostname = window.location.hostname;
  const configuredHosts = parseDebugHosts(import.meta.env.VITE_DEBUG_HOSTS);
  const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  return isLoopbackHost || configuredHosts.includes(hostname);
}
