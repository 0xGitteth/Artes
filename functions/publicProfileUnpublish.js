import {
  isAvailablePersonalPublicProfile,
} from './publicProfileAvailability.js';
import { isKnownCodexDevActorUid } from './codexDevActorRegistry.js';

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

export const isDiditSafetyDeactivatedPrivateProfile = (profile = {}) => {
  const diditStatus = normalizeStatus(profile?.didit?.status);
  const idvStatus = normalizeStatus(profile?.idv?.status);
  return profile?.ageVerified === false
    && profile?.isAdult === false
    && (diditStatus === 'underage' || idvStatus === 'underage');
};

export const resetPersonalOnboardingAtomically = async ({ db, uid, onboardingStep = 2 }) => {
  if (!db || !uid) return { status: 'invalid-request' };
  if (!Number.isInteger(onboardingStep) || onboardingStep < 0 || onboardingStep >= 5) {
    return { status: 'invalid-reset-state' };
  }

  const privateRef = db.collection('users').doc(uid);
  const publicRef = db.collection('publicUsers').doc(uid);

  return db.runTransaction(async (transaction) => {
    if (await isKnownCodexDevActorUid({ db, uid, transaction })) {
      const error = new Error('Codex Dev identity cannot be reset.');
      error.status = 403;
      throw error;
    }
    const privateSnap = await transaction.get(privateRef);
    if (!privateSnap.exists) return { status: 'missing-private-profile' };

    const publicSnap = await transaction.get(publicRef);
    transaction.set(privateRef, {
      onboardingStep,
      onboardingComplete: false,
    }, { merge: true });
    if (!publicSnap.exists) return { status: 'reset-already-unpublished' };

    const publicProfile = publicSnap.data() || {};
    if (!isAvailablePersonalPublicProfile(publicProfile)) {
      return { status: 'reset-preserved-unavailable-profile' };
    }

    transaction.delete(publicRef);
    return { status: 'reset-unpublished' };
  });
};
