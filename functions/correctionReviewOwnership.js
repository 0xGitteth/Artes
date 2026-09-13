const clean = (value) => String(value || '').trim();

export function resolveCorrectionReviewReopenPlan({ upload = {}, userId, newReviewCaseId } = {}) {
  const ownerUid = clean(userId);
  const directReviewCaseId = clean(upload?.reviewCaseId);
  if (directReviewCaseId) {
    return {
      targetReviewCaseId: directReviewCaseId,
      sourceReviewCaseId: directReviewCaseId,
      sourceOwnerUid: ownerUid,
      createNewReviewCase: false,
    };
  }

  const routedReviewCaseId = clean(upload?.correctionReviewCaseId);
  const routedReviewCaseOwnerUid = clean(upload?.correctionReviewCaseOwnerUid);
  const freshReviewCaseId = clean(newReviewCaseId);
  // Routed exact-match corrections keep the source case only as provenance.
  // They must never reopen/share that case, even for the same uploader, because
  // sibling uploads can accept/reject independently. Rejection gets a fresh case;
  // acceptance remains isolated to the current upload.
  if (routedReviewCaseId) {
    return {
      targetReviewCaseId: freshReviewCaseId || null,
      sourceReviewCaseId: routedReviewCaseId,
      sourceOwnerUid: routedReviewCaseOwnerUid || null,
      createNewReviewCase: true,
    };
  }

  if (!freshReviewCaseId) {
    return {
      targetReviewCaseId: null,
      sourceReviewCaseId: routedReviewCaseId || null,
      sourceOwnerUid: routedReviewCaseOwnerUid || null,
      createNewReviewCase: true,
    };
  }

  return {
    targetReviewCaseId: freshReviewCaseId,
    sourceReviewCaseId: routedReviewCaseId || null,
    sourceOwnerUid: routedReviewCaseOwnerUid || null,
    createNewReviewCase: true,
  };
}


const normalizeTaxonomyValues = (items) => Array.from(new Set(
  (Array.isArray(items) ? items : [])
    .map((value) => clean(typeof value === 'string' ? value : value?.trigger))
    .filter(Boolean)
)).sort();

const correctionRequestSignature = (decision = {}) => {
  const action = clean(decision?.action);
  const rawTaxonomy = decision?.correctedTaxonomy && typeof decision.correctedTaxonomy === 'object'
    ? decision.correctedTaxonomy
    : {};
  return JSON.stringify({
    action,
    themes: normalizeTaxonomyValues(rawTaxonomy?.themes),
    triggers: normalizeTaxonomyValues(rawTaxonomy?.triggers),
  });
};

const persistedDecisionSupersedesUploadCorrection = ({ persistedCase = {}, upload = {} } = {}) => {
  const persistedDecision = persistedCase?.moderatorDecision;
  if (!persistedDecision || typeof persistedDecision !== 'object') return false;
  const uploadDecision = upload?.moderatorDecision;
  if (!uploadDecision || typeof uploadDecision !== 'object') return true;
  return correctionRequestSignature(persistedDecision) !== correctionRequestSignature(uploadDecision);
};

const persistedCaseReferencesUpload = ({ persistedCase = {}, uploadId = '' } = {}) => {
  const normalizedUploadId = clean(uploadId);
  if (!normalizedUploadId) return false;
  if (clean(persistedCase?.uploadId) === normalizedUploadId) return true;
  return Array.isArray(persistedCase?.linkedUploadIds)
    && persistedCase.linkedUploadIds.some((value) => clean(value) === normalizedUploadId);
};

const persistedCaseHasActiveCorrectionDecision = ({ persistedCase = {}, upload = {} } = {}) => {
  const status = clean(persistedCase?.status).toLowerCase();
  const correctionStatus = clean(persistedCase?.userCorrectionStatus).toLowerCase();
  const action = clean(persistedCase?.moderatorDecision?.action);
  return status === 'approved'
    && action === 'requestUserCorrection'
    && correctionStatus !== 'rejected'
    && !persistedDecisionSupersedesUploadCorrection({ persistedCase, upload });
};

export function validateCorrectionAcceptancePlanProvenance({ plan = {}, action } = {}) {
  if (clean(action) !== 'acceptCorrection') {
    return { acceptanceBlocked: false, provenanceMissing: false };
  }
  const sourceReviewCaseId = clean(plan?.sourceReviewCaseId);
  return {
    acceptanceBlocked: !sourceReviewCaseId,
    provenanceMissing: !sourceReviewCaseId,
  };
}

export function validateRoutedCorrectionAcceptanceProvenance({
  plan = {},
  action,
  persistedSourceCase = null,
  persistedSourceCaseExists = false,
  upload = {},
} = {}) {
  const normalizedAction = clean(action);
  const sourceReviewCaseId = clean(plan?.sourceReviewCaseId);
  if (normalizedAction !== 'acceptCorrection' || !sourceReviewCaseId) {
    return { acceptanceBlocked: false, correctionSuperseded: false };
  }

  const expectedSourceOwnerUid = clean(plan?.sourceOwnerUid);
  const persistedSourceOwnerUid = clean(persistedSourceCase?.userId);
  // Routed correction provenance is trusted only when both sides carry the
  // same explicit source owner. Legacy or partial provenance fails closed.
  const sourceOwnerMatches = Boolean(expectedSourceOwnerUid)
    && Boolean(persistedSourceOwnerUid)
    && expectedSourceOwnerUid === persistedSourceOwnerUid;
  const correctionSuperseded = persistedSourceCaseExists === true
    && persistedDecisionSupersedesUploadCorrection({ persistedCase: persistedSourceCase || {}, upload });
  const activeSourceCorrection = persistedSourceCaseExists === true
    && sourceOwnerMatches
    && persistedCaseHasActiveCorrectionDecision({ persistedCase: persistedSourceCase || {}, upload });

  return {
    acceptanceBlocked: !activeSourceCorrection,
    correctionSuperseded,
  };
}

export function finalizeCorrectionReviewCasePlan({
  plan = {},
  action,
  userId,
  persistedCase = null,
  persistedCaseExists = false,
  newReviewCaseId = null,
  upload = {},
  uploadId = '',
} = {}) {
  const ownerUid = clean(userId);
  const normalizedAction = clean(action);
  const plannedTarget = clean(plan?.targetReviewCaseId);
  if (!plannedTarget || plan?.createNewReviewCase === true) {
    return { ...plan, targetReviewCaseId: plannedTarget || null, acceptanceBlocked: false };
  }

  const persistedOwnerUid = clean(persistedCase?.userId);
  const ownedPersistedCase = persistedCaseExists === true
    && Boolean(ownerUid)
    && Boolean(persistedOwnerUid)
    && ownerUid === persistedOwnerUid;
  const reusablePersistedCase = ownedPersistedCase
    && persistedCaseReferencesUpload({ persistedCase, uploadId });
  if (!reusablePersistedCase) {
    const freshReviewCaseId = clean(newReviewCaseId);
    if (normalizedAction === 'rejectCorrection' && freshReviewCaseId) {
      return {
        ...plan,
        targetReviewCaseId: freshReviewCaseId,
        createNewReviewCase: true,
        acceptanceBlocked: false,
        rejectionBlocked: false,
        correctionSuperseded: false,
      };
    }
    return {
      ...plan,
      targetReviewCaseId: null,
      createNewReviewCase: true,
      acceptanceBlocked: normalizedAction === 'acceptCorrection',
      rejectionBlocked: false,
      correctionSuperseded: false,
    };
  }

  const status = clean(persistedCase?.status).toLowerCase();
  const correctionStatus = clean(persistedCase?.userCorrectionStatus).toLowerCase();
  const correctionSuperseded = persistedDecisionSupersedesUploadCorrection({ persistedCase, upload });
  const activeCorrectionDecision = persistedCaseHasActiveCorrectionDecision({ persistedCase, upload });
  const acceptanceBlocked = normalizedAction === 'acceptCorrection'
    && (!activeCorrectionDecision || status !== 'approved' || correctionStatus === 'rejected' || correctionSuperseded);
  const rejectionBlocked = normalizedAction === 'rejectCorrection' && correctionSuperseded;
  return {
    ...plan,
    targetReviewCaseId: plannedTarget,
    acceptanceBlocked,
    rejectionBlocked,
    correctionSuperseded,
  };
}
