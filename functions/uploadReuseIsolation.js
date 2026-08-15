export const isUploadReusableForActor = (upload = {}, isCodexActor = false) => (
  isCodexActor ? upload.testActor === 'codex' : !upload.testActor
);

export const shouldCreateProductionReviewCase = ({ isCodexActor = false, forbiddenReasons = [] } = {}) => (
  !isCodexActor && forbiddenReasons.length > 0
);

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

export const findReusableAcrossPages = async ({ fetchPage, isCodexActor, select }) => {
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const docs = await fetchPage(cursor);
    hasMore = docs.length > 0;
    if (!hasMore) break;
    const sameScope = docs.filter((doc) => isUploadReusableForActor(doc.data(), isCodexActor));
    const selected = select(sameScope);
    if (selected) return selected;
    cursor = docs.at(-1);
  }
  return null;
};

export const findBestReusableAcrossPages = async ({ fetchPage, isCodexActor, selectBest }) => {
  let cursor = null;
  let best = null;
  do {
    const docs = await fetchPage(cursor);
    if (!docs.length) break;
    const pageBest = selectBest(docs.filter((doc) => isUploadReusableForActor(doc.data(), isCodexActor)));
    if (pageBest && (!best || pageBest.distance < best.distance)) best = pageBest;
    if (best?.distance === 0) break;
    cursor = docs.at(-1);
  } while (cursor);
  return best;
};
