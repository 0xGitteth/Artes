import { isLegitimatelyPublishedPersonalProfile } from './publicProfileAvailability.js';

const getPersonalProfileRefs = (db, uid) => ({
  privateRef: db.collection('users').doc(uid),
  publicRef: db.collection('publicUsers').doc(uid),
});

const isAvailableProfileSnapshotPair = (privateSnap, publicSnap) => (
  Boolean(privateSnap?.exists && publicSnap?.exists)
  && isLegitimatelyPublishedPersonalProfile({
    privateProfile: privateSnap.data() || {},
    publicProfile: publicSnap.data() || {},
  })
);

export const applyFollowingCreatedCounters = async ({
  db,
  relationRef,
  uid,
  targetUid,
  fieldValue,
}) => db.runTransaction(async (transaction) => {
  const relationSnap = await transaction.get(relationRef);
  if (!relationSnap.exists) return { status: 'missing-relation' };

  const relationData = relationSnap.data() || {};
  const normalizedRelation = {
    targetUid,
    fanUid: uid,
    createdAt: relationData.createdAt || fieldValue.serverTimestamp(),
  };

  if (relationData.countersApplied === true) {
    transaction.set(relationRef, normalizedRelation, { merge: true });
    return { status: 'already-applied' };
  }

  const fanRefs = getPersonalProfileRefs(db, uid);
  const targetRefs = getPersonalProfileRefs(db, targetUid);
  const [fanPrivateSnap, fanPublicSnap, targetPrivateSnap, targetPublicSnap] = await Promise.all([
    transaction.get(fanRefs.privateRef),
    transaction.get(fanRefs.publicRef),
    transaction.get(targetRefs.privateRef),
    transaction.get(targetRefs.publicRef),
  ]);
  const fanAvailable = isAvailableProfileSnapshotPair(fanPrivateSnap, fanPublicSnap);
  const targetAvailable = isAvailableProfileSnapshotPair(targetPrivateSnap, targetPublicSnap);

  if (!fanAvailable || !targetAvailable) {
    transaction.delete(relationRef);
    return { status: 'rejected-unavailable', fanAvailable, targetAvailable };
  }

  transaction.update(targetRefs.publicRef, {
    fansCount: fieldValue.increment(1),
    updatedAt: fieldValue.serverTimestamp(),
  });
  transaction.update(fanRefs.publicRef, {
    fanOfCount: fieldValue.increment(1),
    updatedAt: fieldValue.serverTimestamp(),
  });
  transaction.set(relationRef, {
    ...normalizedRelation,
    countersApplied: true,
  }, { merge: true });
  return { status: 'applied' };
});

export const applyFollowingDeletedCounters = async ({
  db,
  relationData = {},
  uid,
  targetUid,
  fieldValue,
}) => {
  if (relationData.countersApplied !== true) return { status: 'not-applied' };

  return db.runTransaction(async (transaction) => {
    const fanRefs = getPersonalProfileRefs(db, uid);
    const targetRefs = getPersonalProfileRefs(db, targetUid);
    const [fanPublicSnap, targetPublicSnap] = await Promise.all([
      transaction.get(fanRefs.publicRef),
      transaction.get(targetRefs.publicRef),
    ]);
    const decremented = [];

    if (targetPublicSnap.exists) {
      const targetCurrent = Number(targetPublicSnap.data()?.fansCount) || 0;
      transaction.update(targetRefs.publicRef, {
        fansCount: Math.max(0, targetCurrent - 1),
        updatedAt: fieldValue.serverTimestamp(),
      });
      decremented.push('target');
    }
    if (fanPublicSnap.exists) {
      const fanCurrent = Number(fanPublicSnap.data()?.fanOfCount) || 0;
      transaction.update(fanRefs.publicRef, {
        fanOfCount: Math.max(0, fanCurrent - 1),
        updatedAt: fieldValue.serverTimestamp(),
      });
      decremented.push('fan');
    }

    return {
      status: decremented.length ? 'decremented' : 'skipped-missing',
      decremented,
    };
  });
};
