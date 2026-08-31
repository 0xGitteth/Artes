export const isUploadReusableForActor = (upload = {}, isCodexActor = false) => (
  isCodexActor ? upload.testActor === 'codex' : !upload.testActor
);

export const shouldCreateProductionReviewCase = ({ isCodexActor = false, forbiddenReasons = [], shouldReview = false } = {}) => (
  !isCodexActor && (forbiddenReasons.length > 0 || shouldReview)
);

// A cached upload's reviewCaseId is not ownership proof. Historical or routed
// duplicates may contain a case created for another uploader. Always let the
// live flow re-resolve an open review case by the current userId, or create a
// fresh owned case when none exists.
export const resolveCachedReviewCaseIdForUploader = () => null;

export const reviewCaseMatchesFingerprint = ({ reviewCaseData = {}, fingerprints = {}, distanceBetween = null, threshold = 0 } = {}) => {
  const currentSha = String(fingerprints?.sha256 || '').trim();
  const currentDhash = String(fingerprints?.dhash || '').trim();
  const currentPrefix = String(fingerprints?.dhashPrefix || '').trim();
  const candidates = Array.isArray(reviewCaseData?.fingerprints) ? reviewCaseData.fingerprints : [];
  return candidates.some((candidate) => {
    const candidateSha = String(candidate?.sha256 || '').trim();
    if (currentSha && candidateSha && currentSha === candidateSha) return true;
    const candidateDhash = String(candidate?.dhash || '').trim();
    const candidatePrefix = String(candidate?.dhashPrefix || '').trim();
    if (!currentDhash || !candidateDhash || !currentPrefix || currentPrefix !== candidatePrefix) return false;
    if (typeof distanceBetween !== 'function') return false;
    const distance = Number(distanceBetween(currentDhash, candidateDhash));
    return Number.isFinite(distance) && distance <= threshold;
  });
};


export const reviewCaseMatchesCurrentUploadEvidence = async ({
  reviewCaseData = {},
  fingerprints = {},
  matchedUploadId = null,
  expectedOwnerUid = null,
  distanceBetween = null,
  threshold = 0,
  loadUpload = null,
} = {}) => {
  const expectedOwner = String(expectedOwnerUid || '').trim();
  const reviewCaseOwner = String(reviewCaseData?.userId || '').trim();
  if (expectedOwner && reviewCaseOwner !== expectedOwner) return false;
  if (reviewCaseMatchesFingerprint({ reviewCaseData, fingerprints, distanceBetween, threshold })) return true;
  if (matchedUploadId && reviewCaseReferencesUpload({ reviewCaseData, uploadId: matchedUploadId })) return true;
  if (typeof loadUpload !== 'function') return false;

  const linkedUploadIds = [...new Set([
    reviewCaseData?.uploadId,
    ...(Array.isArray(reviewCaseData?.linkedUploadIds) ? reviewCaseData.linkedUploadIds : []),
  ].map((value) => String(value || '').trim()).filter((value) => value && !value.includes('/')))].slice(0, 10);

  for (const linkedUploadId of linkedUploadIds) {
    const linkedUpload = await loadUpload(linkedUploadId);
    if (!linkedUpload || typeof linkedUpload !== 'object') continue;
    const linkedOwner = String(
      linkedUpload?.uploaderUid
      || linkedUpload?.userId
      || linkedUpload?.ownerUid
      || linkedUpload?.userUid
      || ''
    ).trim();
    if (expectedOwner && linkedOwner !== expectedOwner) continue;
    if (reviewCaseMatchesFingerprint({
      reviewCaseData: { fingerprints: [linkedUpload?.fingerprints] },
      fingerprints,
      distanceBetween,
      threshold,
    })) return true;
  }
  return false;
};

export const selectExactReusableUpload = (uploads = [], isCodexActor = false) => (
  uploads.find((upload) => isUploadReusableForActor(upload, isCodexActor)) || null
);

export const selectNearReusableUpload = ({ uploads = [], isCodexActor = false, distanceFor, threshold }) => {
  let best = null;
  uploads.forEach((upload) => {
    if (!isUploadReusableForActor(upload.data, isCodexActor)) return;
    const distance = distanceFor(upload.data);
    if (distance <= threshold && (!best || distance < best.distance)) best = { ...upload, distance };
  });
  return best;
};

export const findReusableAcrossPages = async ({ fetchPage, isCodexActor, select, isReusable = () => true }) => {
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const docs = await fetchPage(cursor);
    hasMore = docs.length > 0;
    if (!hasMore) break;
    const sameScope = docs.filter((doc) => (
      isUploadReusableForActor(doc.data(), isCodexActor)
      && isReusable(doc.data())
    ));
    const selected = select(sameScope);
    if (selected) return selected;
    cursor = docs.at(-1);
  }
  return null;
};

export const findBestReusableAcrossPages = async ({ fetchPage, isCodexActor, selectBest, isReusable = () => true }) => {
  let cursor = null;
  let best = null;
  do {
    const docs = await fetchPage(cursor);
    if (!docs.length) break;
    const pageBest = selectBest(docs.filter((doc) => (
      isUploadReusableForActor(doc.data(), isCodexActor)
      && isReusable(doc.data())
    )));
    if (pageBest && (!best || pageBest.distance < best.distance)) best = pageBest;
    if (best?.distance === 0) break;
    cursor = docs.at(-1);
  } while (cursor);
  return best;
};


export const isUploadReviewCaseData = (reviewCaseData = {}) => {
  const caseType = String(reviewCaseData?.caseType || '').trim().toLowerCase();
  if (caseType) return caseType === 'upload';
  return Boolean(
    String(reviewCaseData?.uploadId || '').trim()
    || (Array.isArray(reviewCaseData?.linkedUploadIds) && reviewCaseData.linkedUploadIds.length > 0)
    || (Array.isArray(reviewCaseData?.fingerprints) && reviewCaseData.fingerprints.length > 0)
  );
};


export const findFirstUploadReviewCaseAcrossPages = async ({ fetchPage, matches = () => true } = {}) => {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage is required');
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const docs = await fetchPage(cursor);
    hasMore = Array.isArray(docs) && docs.length > 0;
    if (!hasMore) break;
    const selected = docs.find((doc) => {
      const data = typeof doc?.data === 'function' ? (doc.data() || {}) : {};
      return isUploadReviewCaseData(data) && matches(data, doc);
    });
    if (selected) return selected;
    cursor = docs.at(-1);
  }
  return null;
};

export const reviewCaseReferencesUpload = ({ reviewCaseData = {}, uploadId } = {}) => {
  const target = String(uploadId || '').trim();
  if (!target || !isUploadReviewCaseData(reviewCaseData)) return false;
  if (String(reviewCaseData?.uploadId || '').trim() === target) return true;
  return Array.isArray(reviewCaseData?.linkedUploadIds)
    && reviewCaseData.linkedUploadIds.some((value) => String(value || '').trim() === target);
};
