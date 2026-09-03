import { execFileSync } from 'node:child_process';

const STAGING_PROJECT_ID = 'artes-staging';
const WEB_APP_DISPLAY_NAME = 'Artes Staging';
const APPLY_FLAG = '--apply';

const getAdcAccessToken = () => String(execFileSync(
  'gcloud',
  ['auth', 'application-default', 'print-access-token'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)).trim();

const safeMessage = (payload, fallback = 'request_failed') => String(
  payload?.error?.message || payload?.message || fallback,
).slice(0, 240);

const apiRequest = async (token, url, { method = 'GET', body } = {}) => {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Goog-User-Project': STAGING_PROJECT_ID,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
    error: response.ok ? null : safeMessage(payload, `http_${response.status}`),
  };
};

const listWebApps = async (token) => apiRequest(
  token,
  `https://firebase.googleapis.com/v1beta1/projects/${STAGING_PROJECT_ID}/webApps?pageSize=100`,
);

const getAuthConfig = async (token) => apiRequest(
  token,
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${STAGING_PROJECT_ID}/config`,
);

const createWebApp = async (token) => apiRequest(
  token,
  `https://firebase.googleapis.com/v1beta1/projects/${STAGING_PROJECT_ID}/webApps`,
  { method: 'POST', body: { displayName: WEB_APP_DISPLAY_NAME } },
);

const initializeAuth = async (token) => apiRequest(
  token,
  `https://identitytoolkit.googleapis.com/v2/projects/${STAGING_PROJECT_ID}/identityPlatform:initializeAuth`,
  { method: 'POST', body: {} },
);

const pollOperation = async (token, operationName) => {
  if (!operationName) throw new Error('Firebase Web App create operation name ontbreekt.');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await apiRequest(
      token,
      `https://firebase.googleapis.com/v1beta1/${operationName}`,
    );
    if (!result.ok) throw new Error(`Web App operation check failed: ${result.error}`);
    if (result.payload?.done) {
      if (result.payload?.error) {
        throw new Error(`Web App operation failed: ${safeMessage(result.payload, 'operation_failed')}`);
      }
      return result.payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Firebase Web App create operation timed out.');
};

const summarizeState = ({ webAppsResult, authResult }) => {
  const apps = webAppsResult.ok && Array.isArray(webAppsResult.payload?.apps)
    ? webAppsResult.payload.apps
    : [];
  return {
    projectId: STAGING_PROJECT_ID,
    webAppCount: apps.length,
    webApps: apps.map((app) => ({
      appId: app?.appId || null,
      displayName: app?.displayName || null,
      state: app?.state || null,
    })),
    authConfigured: authResult.ok,
    authStatus: authResult.status,
    authConfigurationMissing: authResult.status === 404
      && String(authResult.error || '').includes('CONFIGURATION_NOT_FOUND'),
  };
};

const main = async () => {
  const apply = process.argv.slice(2).includes(APPLY_FLAG);
  const token = getAdcAccessToken();
  if (!token) throw new Error('ADC access token ontbreekt.');

  const [webAppsBefore, authBefore] = await Promise.all([
    listWebApps(token),
    getAuthConfig(token),
  ]);
  if (!webAppsBefore.ok) throw new Error(`Web App preflight failed: ${webAppsBefore.error}`);
  if (!authBefore.ok && authBefore.status !== 404) {
    throw new Error(`Auth preflight failed: ${authBefore.error}`);
  }

  const before = summarizeState({ webAppsResult: webAppsBefore, authResult: authBefore });
  const plan = {
    createWebApp: before.webAppCount === 0,
    initializeAuth: before.authConfigurationMissing,
  };

  if (before.webAppCount > 1) {
    throw new Error('Meer dan één staging Web App gevonden; provisioning stopt om duplicaten te voorkomen.');
  }

  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      mode: 'dry_run',
      projectId: STAGING_PROJECT_ID,
      writes: false,
      before,
      plan,
      applyWith: `node functions/scripts/provisionModerationStagingAppConfig.js ${APPLY_FLAG}`,
    }, null, 2)}\n`);
    return;
  }

  const actions = [];
  if (plan.initializeAuth) {
    const result = await initializeAuth(token);
    if (!result.ok && result.status !== 409) {
      throw new Error(`Auth initialization failed: ${result.error}`);
    }
    actions.push('initialized_firebase_auth');
  }

  if (plan.createWebApp) {
    const result = await createWebApp(token);
    if (!result.ok) throw new Error(`Web App create failed: ${result.error}`);
    await pollOperation(token, result.payload?.name);
    actions.push('created_firebase_web_app');
  }

  const [webAppsAfter, authAfter] = await Promise.all([
    listWebApps(token),
    getAuthConfig(token),
  ]);
  if (!webAppsAfter.ok || !authAfter.ok) {
    throw new Error('Post-provision verification failed.');
  }
  const after = summarizeState({ webAppsResult: webAppsAfter, authResult: authAfter });
  if (after.webAppCount !== 1 || !after.authConfigured) {
    throw new Error('Post-provision state is niet exact één Web App + geconfigureerde Auth.');
  }

  process.stdout.write(`${JSON.stringify({
    mode: 'apply',
    projectId: STAGING_PROJECT_ID,
    writes: true,
    actions,
    after,
    providersEnabledByThisScript: [],
    usersCreatedByThisScript: 0,
    deploysPerformedByThisScript: 0,
    secretsPrinted: false,
  }, null, 2)}\n`);
};

main().catch((error) => {
  console.error(`Staging app provisioning failed: ${error?.message || error}`);
  process.exitCode = 1;
});
