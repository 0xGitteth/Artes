import { createHash, timingSafeEqual } from 'crypto';

const truthy = (value) => String(value || '').trim().toLowerCase() === 'true';
const ALLOWED_ARTES_ENVS = new Set(['development', 'staging', 'preview', 'local']);

export const resolveCodexDevProjectId = (env = process.env) => {
  if (env.GCLOUD_PROJECT) return env.GCLOUD_PROJECT;
  if (!env.FIREBASE_CONFIG) return null;
  try {
    const parsed = JSON.parse(env.FIREBASE_CONFIG);
    return parsed?.projectId || null;
  } catch (error) {
    return null;
  }
};

export const getCodexDevLoginDecision = (env = process.env) => {
  const artesEnv = String(env.ARTES_ENV || '').trim().toLowerCase();
  if (truthy(env.CODEX_DEV_LOGIN_FORBIDDEN) || !ALLOWED_ARTES_ENVS.has(artesEnv)) {
    return { allowed: false, code: 'forbidden_environment' };
  }

  if (!truthy(env.CODEX_DEV_LOGIN_ENABLED)) {
    return { allowed: false, code: 'disabled' };
  }

  const allowedProjects = String(env.CODEX_DEV_ALLOWED_PROJECT_IDS || '')
    .split(',')
    .map((projectId) => projectId.trim())
    .filter(Boolean);
  const projectId = resolveCodexDevProjectId(env);
  if (!projectId || !allowedProjects.includes(projectId)) {
    return { allowed: false, code: 'project_not_allowed' };
  }

  return { allowed: true, code: 'allowed' };
};

export const getCodexDevLoginDiagnostics = (env = process.env) => {
  const artesEnv = String(env.ARTES_ENV || '').trim().toLowerCase();
  const loginForbidden = truthy(env.CODEX_DEV_LOGIN_FORBIDDEN);
  const loginEnabled = truthy(env.CODEX_DEV_LOGIN_ENABLED);
  const projectId = resolveCodexDevProjectId(env);
  const allowedProjects = String(env.CODEX_DEV_ALLOWED_PROJECT_IDS || '')
    .split(',')
    .map((allowedProjectId) => allowedProjectId.trim())
    .filter(Boolean);
  const projectAllowed = Boolean(projectId && allowedProjects.includes(projectId));
  const decision = getCodexDevLoginDecision(env);

  return {
    artesEnvState: !artesEnv
      ? 'missing'
      : ALLOWED_ARTES_ENVS.has(artesEnv)
        ? 'allowed'
        : 'not_allowed',
    loginForbidden,
    loginEnabled,
    projectIdState: projectId ? 'present' : 'missing',
    projectAllowed,
    decisionCode: decision.code,
  };
};

export const shouldExposeCodexDevLoginDiagnostics = (req, env = process.env) => (
  truthy(env.CODEX_DEV_LOGIN_DIAGNOSTICS_ENABLED)
  && String(req?.get?.('x-codex-dev-diagnostics') || '').trim() === '1'
);

const hashSecret = (value) => createHash('sha256').update(String(value), 'utf8').digest();

export const isValidCodexDevLoginSecret = (requestSecret, expectedSecret) => {
  const normalizedRequestSecret = typeof requestSecret === 'string' ? requestSecret : '';
  const normalizedExpectedSecret = typeof expectedSecret === 'string' ? expectedSecret : '';
  if (!normalizedRequestSecret || !normalizedExpectedSecret) return false;

  return timingSafeEqual(
    hashSecret(normalizedRequestSecret),
    hashSecret(normalizedExpectedSecret),
  );
};

export const canIssueCodexDevToken = (env = process.env) => getCodexDevLoginDecision(env).allowed;
