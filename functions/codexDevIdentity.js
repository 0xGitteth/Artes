export const CODEX_DEV_ACTOR = 'codex';
export const CODEX_DEV_UID_DEFAULT = 'codex-dev-user';

export const resolveCodexDevUid = (env = process.env) => (
  String(env.CODEX_DEV_UID || '').trim() || CODEX_DEV_UID_DEFAULT
);

export const hasCodexDevClaim = (claims = {}) => (
  claims.devCodex === true && claims.devActor === CODEX_DEV_ACTOR
);

export const isCodexDevUid = (uid, env = process.env) => (
  Boolean(uid) && uid === resolveCodexDevUid(env)
);

export const isCodexDevToken = (decoded = {}, env = process.env) => (
  hasCodexDevClaim(decoded) && isCodexDevUid(decoded.uid, env)
);

export const buildCodexDevPrivateProfile = ({ uid, now, exists = false }) => ({
  uid,
  displayName: 'Codex',
  authProvider: 'custom',
  roles: ['assistent'],
  onboardingStep: 5,
  onboardingComplete: true,
  ageVerified: true,
  isAdult: true,
  isDevTestUser: true,
  devActor: CODEX_DEV_ACTOR,
  ...(!exists ? { createdAt: now } : {}),
  updatedAt: now,
});
