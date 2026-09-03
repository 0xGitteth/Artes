import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STAGING_PROJECT_ID = 'artes-staging';
const OUTPUT_PATH = resolve(process.cwd(), '.env.staging.local');

const token = String(execFileSync(
  'gcloud',
  ['auth', 'application-default', 'print-access-token'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)).trim();

if (!token) throw new Error('ADC access token ontbreekt.');

const getJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': STAGING_PROJECT_ID,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error?.message || `HTTP ${response.status}`));
  }
  return payload;
};

const appsPayload = await getJson(
  `https://firebase.googleapis.com/v1beta1/projects/${STAGING_PROJECT_ID}/webApps?pageSize=10`,
);
const apps = Array.isArray(appsPayload?.apps) ? appsPayload.apps : [];
if (apps.length !== 1) {
  throw new Error(`Verwacht exact één staging Web App, gevonden: ${apps.length}`);
}

const appName = String(apps[0]?.name || '').trim();
if (!appName.startsWith(`projects/${STAGING_PROJECT_ID}/webApps/`)) {
  throw new Error('Onverwachte staging Web App resource.');
}

const config = await getJson(`https://firebase.googleapis.com/v1beta1/${appName}/config`);
if (config?.projectId !== STAGING_PROJECT_ID) {
  throw new Error(`STOP: Web App config wijst naar ${config?.projectId || 'onbekend'} in plaats van ${STAGING_PROJECT_ID}.`);
}
if (!config?.apiKey || !config?.appId || !config?.messagingSenderId || !config?.authDomain) {
  throw new Error('Staging Web App config is onvolledig.');
}

const values = {
  VITE_FIREBASE_API_KEY: config.apiKey,
  VITE_FIREBASE_AUTH_DOMAIN: config.authDomain,
  VITE_FIREBASE_PROJECT_ID: config.projectId,
  VITE_FIREBASE_STORAGE_BUCKET: config.storageBucket || `${STAGING_PROJECT_ID}.firebasestorage.app`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: config.messagingSenderId,
  VITE_FIREBASE_APP_ID: config.appId,
  VITE_FUNCTIONS_BASE_URL: '',
  VITE_MODERATION_FUNCTION_URL: '',
  VITE_ENABLE_EMAIL_SIGNIN: 'false',
  VITE_ENABLE_GOOGLE_SIGNIN: 'false',
  VITE_ENABLE_APPLE_SIGNIN: 'false',
};

const escaped = (value) => JSON.stringify(String(value ?? ''));
const contents = [
  '# Generated locally for artes-staging. Do not commit.',
  ...Object.entries(values).map(([key, value]) => `${key}=${escaped(value)}`),
  '',
].join('\n');

writeFileSync(OUTPUT_PATH, contents, { encoding: 'utf8', mode: 0o600 });

const ignored = (() => {
  try {
    execFileSync('git', ['check-ignore', '-q', OUTPUT_PATH], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

if (!ignored) {
  throw new Error('.env.staging.local wordt niet door git genegeerd; bestand niet veilig om te gebruiken.');
}

process.stdout.write(`${JSON.stringify({
  projectId: STAGING_PROJECT_ID,
  output: '.env.staging.local',
  written: true,
  gitIgnored: true,
  rawApiKeyPrinted: false,
  functionsConfigured: false,
  signInProvidersEnabledInFrontend: [],
}, null, 2)}\n`);
