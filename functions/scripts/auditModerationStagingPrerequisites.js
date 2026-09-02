import { execFileSync } from 'node:child_process';

const STAGING_PROJECT_ID = 'artes-staging';
const PRODUCTION_REFERENCE_PROJECT_ID = 'artes-media-app';

const REQUIRED_STAGING_SERVICES = [
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'storage.googleapis.com',
  'identitytoolkit.googleapis.com',
  'cloudfunctions.googleapis.com',
  'run.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'eventarc.googleapis.com',
  'pubsub.googleapis.com',
];

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
      headers: { Authorization: `Bearer ${token}` },
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

const getProjectMetadata = async (token, projectId) => {
  const result = await apiGet(
    token,
    `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`,
  );
  return {
    ok: result.ok,
    projectId,
    projectNumber: result.ok ? String(result.payload?.projectNumber || '') || null : null,
    lifecycleState: result.ok ? result.payload?.lifecycleState || null : null,
    error: result.error,
  };
};

const getFirebaseState = async (token, projectId) => {
  const result = await apiGet(
    token,
    `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}`,
  );
  return {
    configured: result.ok,
    status: result.status,
    state: result.ok ? result.payload?.state || null : null,
    error: result.ok ? null : result.error,
  };
};

const getFirestoreState = async (token, projectId) => {
  const result = await apiGet(
    token,
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases`,
  );
  const databases = result.ok && Array.isArray(result.payload?.databases)
    ? result.payload.databases
    : [];
  return {
    reachable: result.ok,
    status: result.status,
    databaseCount: databases.length,
    locations: Array.from(new Set(databases.map((item) => item?.locationId).filter(Boolean))).sort(),
    types: Array.from(new Set(databases.map((item) => item?.type).filter(Boolean))).sort(),
    error: result.ok ? null : result.error,
  };
};

const getStorageState = async (token, projectId) => {
  const result = await apiGet(
    token,
    `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}&maxResults=100`,
  );
  const buckets = result.ok && Array.isArray(result.payload?.items) ? result.payload.items : [];
  return {
    reachable: result.ok,
    status: result.status,
    bucketCount: buckets.length,
    locations: Array.from(new Set(buckets.map((item) => item?.location).filter(Boolean))).sort(),
    storageClasses: Array.from(new Set(buckets.map((item) => item?.storageClass).filter(Boolean))).sort(),
    error: result.ok ? null : result.error,
  };
};

const getServiceStates = async (token, projectNumber) => {
  if (!projectNumber) {
    return Object.fromEntries(REQUIRED_STAGING_SERVICES.map((service) => [service, 'unknown']));
  }
  const entries = await Promise.all(REQUIRED_STAGING_SERVICES.map(async (service) => {
    const result = await apiGet(
      token,
      `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectNumber)}/services/${encodeURIComponent(service)}`,
    );
    return [service, result.ok ? (result.payload?.state || 'unknown') : `unavailable:${result.status || 'network'}`];
  }));
  return Object.fromEntries(entries);
};

const inspectProject = async (token, projectId, { includeServiceStates = false } = {}) => {
  const project = await getProjectMetadata(token, projectId);
  const [firebase, firestore, storage] = await Promise.all([
    getFirebaseState(token, projectId),
    getFirestoreState(token, projectId),
    getStorageState(token, projectId),
  ]);
  const services = includeServiceStates
    ? await getServiceStates(token, project.projectNumber)
    : null;
  return { project, firebase, firestore, storage, ...(services ? { services } : {}) };
};

const buildRecommendations = ({ productionReference, staging }) => {
  const recommendations = [];
  if (!staging.firebase.configured) recommendations.push('configure_firebase_on_staging');
  if (!staging.firestore.reachable || staging.firestore.databaseCount === 0) recommendations.push('create_staging_firestore_database');
  if (!staging.storage.reachable || staging.storage.bucketCount === 0) recommendations.push('create_staging_storage_bucket');

  const disabledServices = Object.entries(staging.services || {})
    .filter(([, state]) => state !== 'ENABLED')
    .map(([service]) => service);
  if (disabledServices.length > 0) recommendations.push('enable_required_staging_services');

  const productionFirestoreLocations = productionReference.firestore.locations || [];
  const stagingFirestoreLocations = staging.firestore.locations || [];
  if (productionFirestoreLocations.length > 0 && stagingFirestoreLocations.length > 0
    && productionFirestoreLocations.join(',') !== stagingFirestoreLocations.join(',')) {
    recommendations.push('review_firestore_location_mismatch');
  }
  return { recommendations, disabledServices };
};

const main = async () => {
  const token = getAdcAccessToken();
  if (!token) throw new Error('ADC access token ontbreekt.');

  const [productionReference, staging] = await Promise.all([
    inspectProject(token, PRODUCTION_REFERENCE_PROJECT_ID, { includeServiceStates: false }),
    inspectProject(token, STAGING_PROJECT_ID, { includeServiceStates: true }),
  ]);
  const plan = buildRecommendations({ productionReference, staging });

  process.stdout.write(`${JSON.stringify({
    auditMode: 'staging_prerequisites_metadata_read_only',
    readOnly: true,
    writes: false,
    modelCalls: false,
    mediaRead: false,
    stagingProjectId: STAGING_PROJECT_ID,
    productionReferenceProjectId: PRODUCTION_REFERENCE_PROJECT_ID,
    productionReference,
    staging,
    ...plan,
  }, null, 2)}\n`);
};

main().catch((error) => {
  console.error(`Staging prerequisites audit failed: ${error?.message || error}`);
  process.exitCode = 1;
});
