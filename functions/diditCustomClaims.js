import { CODEX_DEV_ACTOR, isCodexDevUid } from './codexDevIdentity.js';

export const buildDiditCustomClaims = ({
  uid,
  existingClaims = {},
  isApprovedAdult,
  isAdult,
  env = process.env,
}) => ({
  ...(existingClaims || {}),
  ...(isCodexDevUid(uid, env) ? { devCodex: true, devActor: CODEX_DEV_ACTOR } : {}),
  idvVerified: isApprovedAdult === true,
  isAdult: isApprovedAdult === true && isAdult === true,
});
