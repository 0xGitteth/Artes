import {
  isAvailablePersonalPublicProfile,
  isPersonalOnboardingComplete,
} from './publicProfileAvailability.js';

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

export const isDiditSafetyDeactivatedPrivateProfile = (profile = {}) => {
  const diditStatus = normalizeStatus(profile?.didit?.status);
  const idvStatus = normalizeStatus(profile?.idv?.status);
  return profile?.ageVerified === false
    && profile?.isAdult === false
    && (diditStatus === 'underage' || idvStatus === 'underage');
};

export const unpublishIncompletePersonalProfileFromCurrentState = async ({ db, uid }) => {
  if (!db || !uid) return { status: 'invalid-request' };

  const privateRef = db.collection('users').doc(uid);
  const publicRef = db.collection('publicUsers').doc(uid);

  return db.runTransaction(async (transaction) => {
    const privateSnap = await transaction.get(privateRef);
    if (!privateSnap.exists) return { status: 'missing-private-profile' };

    const privateProfile = privateSnap.data() || {};
    if (isPersonalOnboardingComplete(privateProfile)) {
      return { status: 'still-complete' };
    }

    const publicSnap = await transaction.get(publicRef);
    if (!publicSnap.exists) return { status: 'already-unpublished' };

    const publicProfile = publicSnap.data() || {};
    if (!isAvailablePersonalPublicProfile(publicProfile)) {
      return {
        status: isDiditSafetyDeactivatedPrivateProfile(privateProfile)
          ? 'preserved-didit-safety-profile'
          : 'already-unavailable',
      };
    }

    transaction.delete(publicRef);
    return { status: 'unpublished' };
  });
};
