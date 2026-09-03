const clean = (value) => String(value || '').trim();

const validateVector = (vector, expectedDimension = null) => {
  if (!Array.isArray(vector) || vector.length === 0) return false;
  if (expectedDimension !== null && vector.length !== expectedDimension) return false;
  return vector.every((value) => typeof value === 'number' && Number.isFinite(value));
};

export const cosineDistance = (left, right) => {
  if (!validateVector(left) || !validateVector(right, left.length)) {
    throw new Error('invalid_cosine_vectors');
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) throw new Error('zero_norm_cosine_vector');
  const similarity = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  return 1 - Math.max(-1, Math.min(1, similarity));
};

export const rankModerationSemanticNeighbors = ({
  queryVector,
  candidates = [],
  embeddingModel,
  labelVersion,
  maxResults = 8,
  maxDistance = 0.35,
} = {}) => {
  if (!validateVector(queryVector)) throw new Error('invalid_query_embedding');
  const model = clean(embeddingModel);
  const label = clean(labelVersion);
  if (!model) throw new Error('embedding_model_required');
  if (!label) throw new Error('label_version_required');

  const limit = Math.max(1, Math.min(Number(maxResults) || 8, 50));
  const distanceLimit = Number.isFinite(Number(maxDistance))
    ? Math.max(0, Math.min(Number(maxDistance), 2))
    : 0.35;

  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => clean(candidate?.exampleId))
    .filter((candidate) => clean(candidate?.embeddingModel) === model)
    .filter((candidate) => clean(candidate?.labelVersion) === label)
    .filter((candidate) => validateVector(candidate?.embedding, queryVector.length))
    .map((candidate) => ({
      exampleId: clean(candidate.exampleId),
      distance: cosineDistance(queryVector, candidate.embedding),
      labelVersion: label,
      detectorLabel: candidate?.detectorLabel || null,
      semanticClusterId: clean(candidate?.semanticClusterId) || null,
    }))
    .filter((candidate) => candidate.distance <= distanceLimit)
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      return left.exampleId.localeCompare(right.exampleId);
    })
    .slice(0, limit);
};

export const summarizeNeighborEvidence = (neighbors = []) => {
  const items = Array.isArray(neighbors) ? neighbors : [];
  if (items.length === 0) {
    return {
      count: 0,
      nearestDistance: null,
      detectorLabelsPresent: 0,
      semanticClusters: 0,
    };
  }
  return {
    count: items.length,
    nearestDistance: Math.min(...items.map((item) => Number(item.distance)).filter(Number.isFinite)),
    detectorLabelsPresent: items.filter((item) => item?.detectorLabel).length,
    semanticClusters: new Set(items.map((item) => clean(item?.semanticClusterId)).filter(Boolean)).size,
  };
};
