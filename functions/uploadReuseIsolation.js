export const isUploadReusableForActor = (upload = {}, isCodexActor = false) => (
  isCodexActor ? upload.testActor === 'codex' : !upload.testActor
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
