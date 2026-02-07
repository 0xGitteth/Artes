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

  // Alleen toestaan als je in dev draait (npm run dev)
  const isDev = import.meta.env.DEV === true;
  if (!isDev) return false;

  // Host moet lokaal, Codespaces of in VITE_DEBUG_HOSTS staan
  const hostname = window.location.hostname;
  const configuredHosts = parseDebugHosts(import.meta.env.VITE_DEBUG_HOSTS);

  return (
    hostname === 'localhost' ||
    hostname.endsWith('.app.github.dev') ||
    configuredHosts.includes(hostname)
  );
}
