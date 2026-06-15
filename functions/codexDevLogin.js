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

export const canIssueCodexDevToken = (env = process.env) => getCodexDevLoginDecision(env).allowed;
