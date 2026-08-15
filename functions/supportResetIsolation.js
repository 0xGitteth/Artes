import {
  queueCodexDevLifecycleFenceRenewal,
  readAndValidateCodexDevLifecycleFence,
} from './codexDevActorRegistry.js';

export const deleteSupportResetMessagesPageAtomically = async ({
  db,
  actorUid,
  fenceToken,
  threadRef,
  expectedUserUid,
  isModeratorRequest,
  messageDocs,
  keptIntroRef = null,
  introTexts,
  nowMs = Date.now(),
}) => db.runTransaction(async (transaction) => {
  const lifecycleValidation = await readAndValidateCodexDevLifecycleFence({
    db,
    uid: actorUid,
    token: fenceToken,
    transaction,
    operation: 'resetSupportThread',
    nowMs,
  });

  const [freshThreadSnap, ...freshMessageSnaps] = await Promise.all([
    transaction.get(threadRef),
    ...messageDocs.map((docSnap) => transaction.get(docSnap.ref)),
  ]);

  if (!freshThreadSnap.exists) {
    const error = new Error('Thread not found');
    error.status = 404;
    throw error;
  }
  const freshThreadData = freshThreadSnap.data() || {};
  if (freshThreadData?.type !== 'support' || freshThreadData?.userUid !== expectedUserUid) {
    const error = new Error('Support thread changed during reset');
    error.status = 409;
    throw error;
  }
  if (freshThreadData.userUid !== actorUid && !isModeratorRequest) {
    const error = new Error('Not authorized to reset this support thread');
    error.status = 403;
    throw error;
  }

  let nextKeptIntroRef = keptIntroRef;
  const deleteRefs = [];
  for (const freshSnap of freshMessageSnaps) {
    if (!freshSnap.exists) continue;
    const data = freshSnap.data() || {};
    const isSystemIntro = data?.senderRole === 'system' && introTexts.includes(data?.text || '');
    if (isSystemIntro) {
      if (!nextKeptIntroRef) {
        nextKeptIntroRef = freshSnap.ref;
        continue;
      }
      if (nextKeptIntroRef.path === freshSnap.ref.path) continue;
    }
    deleteRefs.push(freshSnap.ref);
  }

  queueCodexDevLifecycleFenceRenewal({ transaction, validation: lifecycleValidation });
  deleteRefs.forEach((ref) => transaction.delete(ref));
  return { deletesInRound: deleteRefs.length, keptIntroRef: nextKeptIntroRef };
});
