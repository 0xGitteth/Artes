import { hasCodexDevClaim, isCodexDevUid } from './codexDevIdentity.js';
import { normalizeDiditStatus } from './diditStatus.js';

export const shouldBlockMainAppForAgeState = ({ profile = null, authClaims = null, uid = null, isDevCodex = false } = {}) => {
  const devByIdentity = isDevCodex === true || profile?.isDevTestUser === true || hasCodexDevClaim(authClaims) || isCodexDevUid(uid || profile?.uid);
  if (devByIdentity) return false;

  const diditStatus = normalizeDiditStatus(profile?.didit?.status || profile?.diditStatus);
  const idvStatus = normalizeDiditStatus(profile?.idv?.status);
  if (diditStatus === 'underage' || idvStatus === 'underage') return true;

  return profile?.ageVerified !== true || profile?.isAdult !== true;
};
