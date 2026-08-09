const CODEX_DEV_UID_DEFAULT = 'codex-dev-user';

export const getExpectedCodexDevUid = () => {
  const configured = String(import.meta.env?.VITE_CODEX_DEV_UID || '').trim();
  return configured || CODEX_DEV_UID_DEFAULT;
};

export const hasCodexDevClaim = (claims) => claims?.devCodex === true;

export const isCodexDevUid = (uid) => Boolean(uid) && uid === getExpectedCodexDevUid();

export const isCodexDevIdentity = ({ claims, uid }) => (
  hasCodexDevClaim(claims) && isCodexDevUid(uid)
);

export const readTokenClaims = async (user, forceRefresh = false) => {
  if (!user?.getIdTokenResult) return null;
  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    return tokenResult?.claims || null;
  } catch (error) {
    return null;
  }
};

export const isCodexDevUser = async (user, { forceRefresh = false } = {}) => {
  if (!user?.uid) return false;
  const claims = await readTokenClaims(user, forceRefresh);
  return isCodexDevIdentity({ claims, uid: user.uid });
};
