import { isLegitimatelyPublishedPersonalProfile } from './publicProfileAvailability.js';
import { isCodexDevUid } from './codexDevIdentity.js';

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

  if (isCodexDevUid(uid) || isCodexDevUid(targetUid)) {
    transaction.delete(relationRef);
    return { status: 'rejected-test-actor', repairOnDelete: relationSnap.data()?.countersApplied === true };
  }

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
  codexUid = null,
}) => {
  const isTestUid = (candidate) => codexUid ? candidate === codexUid : isCodexDevUid(candidate);
  const repairRef = db.collection('codexDevCounterRepairs').doc(`${uid}__${targetUid}`);
  const existingRepair = await repairRef.get?.();
  if (existingRepair?.exists) return { status: 'already-repaired-codex-relation' };
  if (isTestUid(uid) || isTestUid(targetUid)) {
    if (relationData.countersApplied !== true) return { status: 'skipped-test-actor' };
    return db.runTransaction(async (transaction) => {
      const repairSnap = await transaction.get(repairRef);
      if (repairSnap.exists) return { status: 'already-repaired-test-actor' };
      const ordinaryUid = isTestUid(uid) ? targetUid : uid;
      const ordinaryRef = db.collection('publicUsers').doc(ordinaryUid);
      const ordinarySnap = await transaction.get(ordinaryRef);
      let repaired = null;
      if (ordinarySnap.exists) {
        repaired = isTestUid(uid) ? 'fansCount' : 'fanOfCount';
        const current = Number(ordinarySnap.data()?.[repaired]) || 0;
        transaction.update(ordinaryRef, {
          [repaired]: Math.max(0, current - 1),
          updatedAt: fieldValue.serverTimestamp(),
        });
      }
      transaction.set(repairRef, { uid, targetUid, repaired, repairedAt: fieldValue.serverTimestamp() });
      return { status: 'repaired-test-actor', repaired };
    });
  }
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
