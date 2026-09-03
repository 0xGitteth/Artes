import { execFileSync } from 'node:child_process';

const STAGING_PROJECT_ID = 'artes-staging';

const getAdcAccessToken = () => String(execFileSync(
  'gcloud',
  ['auth', 'application-default', 'print-access-token'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
)).trim();

const safeMessage = (payload, fallback = 'request_failed') => String(
  payload?.error?.message || payload?.message || fallback,
).slice(0, 240);

const apiGet = async (token, url) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Goog-User-Project': STAGING_PROJECT_ID,
      },
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload,
      error: response.ok ? null : safeMessage(payload, `http_${response.status}`),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: {},
      error: String(error?.message || error || 'network_error').slice(0, 240),
    };
  }
};

const getFirebaseProject = async (token) => {
  const result = await apiGet(
    token,
    `https://firebase.googleapis.com/v1beta1/projects/${STAGING_PROJECT_ID}`,
  );
  return {
    configured: result.ok,
    status: result.status,
    state: result.ok ? result.payload?.state || null : null,
    projectId: result.ok ? result.payload?.projectId || null : null,
    projectNumber: result.ok ? result.payload?.projectNumber || null : null,
    error: result.error,
  };
};

const listWebApps = async (token) => {
  const result = await apiGet(
    token,
    `https://firebase.googleapis.com/v1beta1/projects/${STAGING_PROJECT_ID}/webApps?pageSize=100`,
  );
  if (!result.ok) {
    return {
      reachable: false,
      status: result.status,
      appCount: 0,
      apps: [],
      error: result.error,
    };
  }

  const rawApps = Array.isArray(result.payload?.apps) ? result.payload.apps : [];
  const apps = await Promise.all(rawApps.map(async (app) => {
    const name = String(app?.name || '').trim();
    const configResult = name
      ? await apiGet(token, `https://firebase.googleapis.com/v1beta1/${name}/config`)
      : { ok: false, status: null, payload: {}, error: 'missing_web_app_name' };
    const config = configResult.ok ? configResult.payload || {} : {};
    return {
      name: name || null,
      appId: app?.appId || config?.appId || null,
      displayName: app?.displayName || null,
      state: app?.state || null,
      configAvailable: configResult.ok,
      authDomain: configResult.ok ? config?.authDomain || null : null,
      projectId: configResult.ok ? config?.projectId || null : null,
      storageBucket: configResult.ok ? config?.storageBucket || null : null,
      messagingSenderId: configResult.ok ? config?.messagingSenderId || null : null,
      hasApiKey: Boolean(configResult.ok && config?.apiKey),
      error: configResult.error,
    };
  }));

  return {
    reachable: true,
    status: result.status,
    appCount: apps.length,
    apps,
    error: null,
  };
};

const getAuthConfig = async (token) => {
  const result = await apiGet(
    token,
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${STAGING_PROJECT_ID}/config`,
  );
  if (!result.ok) {
    return {
      reachable: false,
      status: result.status,
      error: result.error,
    };
  }

  const config = result.payload || {};
  return {
    reachable: true,
    status: result.status,
    emailPasswordEnabled: Boolean(config?.signIn?.email?.enabled),
    passwordRequired: Boolean(config?.signIn?.email?.passwordRequired),
    anonymousEnabled: Boolean(config?.signIn?.anonymous?.enabled),
    authorizedDomains: Array.isArray(config?.authorizedDomains)
      ? [...config.authorizedDomains].sort()
      : [],
    error: null,
  };
};

const listDefaultIdps = async (token) => {
  const result = await apiGet(
    token,
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${STAGING_PROJECT_ID}/defaultSupportedIdpConfigs?pageSize=100`,
  );
  if (!result.ok) {
    return {
      reachable: false,
      status: result.status,
      providers: [],
      error: result.error,
    };
  }

  const configs = Array.isArray(result.payload?.defaultSupportedIdpConfigs)
    ? result.payload.defaultSupportedIdpConfigs
    : [];
  return {
    reachable: true,
    status: result.status,
    providers: configs
      .map((item) => ({
        idpId: item?.idpId || null,
        enabled: Boolean(item?.enabled),
      }))
      .filter((item) => item.idpId)
      .sort((a, b) => a.idpId.localeCompare(b.idpId)),
    error: null,
  };
};

const main = async () => {
  const token = getAdcAccessToken();
  if (!token) throw new Error('ADC access token ontbreekt.');

  const [firebaseProject, webApps, auth, defaultIdps] = await Promise.all([
    getFirebaseProject(token),
    listWebApps(token),
    getAuthConfig(token),
    listDefaultIdps(token),
  ]);

  process.stdout.write(`${JSON.stringify({
    auditMode: 'staging_firebase_app_config_read_only',
    projectId: STAGING_PROJECT_ID,
    quotaProjectId: STAGING_PROJECT_ID,
    readOnly: true,
    writes: false,
    secretsPrinted: false,
    firebaseProject,
    webApps,
    auth,
    defaultIdps,
  }, null, 2)}\n`);
};

main().catch((error) => {
  console.error(`Staging Firebase app config audit failed: ${error?.message || error}`);
  process.exitCode = 1;
});
