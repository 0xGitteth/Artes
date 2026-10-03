import { normalizeArtesDetectorLabel } from './moderationLearningDataset.js';

// The final, frozen manifest owns the split. Export never reshuffles a benchmark.
export const buildModerationTrainingExport = ({ learningItems = [], manifest, embeddings = [], modelId = 'facebook/dinov2-base', revision } = {}) => {
  if (!manifest?.datasetVersion || manifest.labelVersion !== 'artes_detector_v1' || !Array.isArray(manifest.assignments)) throw new Error('invalid_frozen_dataset_manifest');
  if (modelId !== 'facebook/dinov2-base' || !/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('pinned_embedding_revision_required');
  const mapUnique = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      if (!row?.[key] || map.has(row[key])) throw new Error(`invalid_or_duplicate_${key}`);
      map.set(row[key], row);
    }
    return map;
  };
  const itemsById = mapUnique(learningItems, 'sourceExampleId');
  const featuresById = mapUnique(embeddings, 'sourceExampleId');
  const assignments = mapUnique(manifest.assignments, 'sourceExampleId');
  const relations = new Map();
  const items = [];
  for (const [id, assignment] of assignments) {
    const item = itemsById.get(id);
    const label = normalizeArtesDetectorLabel(item?.detectorLabel);
    const asset = item?.trainingAsset;
    if (item?.trainingReady !== true || item.candidate !== true || item.curationStatus !== 'approved'
      || item.benchmarkOnly === true || item.researchOnly === true || !label || label.uncertaintyFlags.length
      || asset?.approvedForTraining !== true || !asset.uri || asset.revoked || asset.deleted || asset.revokedAt || asset.deletedAt
      || item.labelVersion !== 'artes_detector_v1' || item.semanticEmbedding?.semanticClusterApproved !== true) throw new Error(`training_item_not_approved:${id}`);
    if (assignment.semanticClusterId !== item.semanticEmbedding.semanticClusterId || assignment.sourcePoolId !== item.sourcePoolId
      || !assignment.leakageGroupId || !['train', 'validation', 'test'].includes(assignment.split)) throw new Error(`invalid_frozen_assignment:${id}`);
    const feature = featuresById.get(id);
    if (feature?.modelId !== modelId || feature.revision !== revision || feature.sha256 !== item.sourceFingerprintSha256
      || !/^[a-f0-9]{64}$/.test(feature.sha256 || '')
      || !Array.isArray(feature.vector) || feature.vector.length !== 768 || feature.vector.some(x => !Number.isFinite(x))
      || Math.abs(feature.vector.reduce((sum, x) => sum + x*x, 0) - 1) > 1e-3) throw new Error(`embedding_provenance_mismatch:${id}`);
    for (const [key, value] of Object.entries({ sha256: feature.sha256, sourcePool: item.sourcePoolId, semanticCluster: assignment.semanticClusterId, leakageGroup: assignment.leakageGroupId })) {
      if (!value || (relations.has(`${key}:${value}`) && relations.get(`${key}:${value}`) !== assignment.split)) throw new Error(`dataset_split_leakage:${key}`);
      relations.set(`${key}:${value}`, assignment.split);
    }
    items.push({
      sourceExampleId: id, sourcePoolId: item.sourcePoolId, sourceFingerprintSha256: feature.sha256,
      labelVersion: item.labelVersion, detectorLabel: label, candidate: true, curationStatus: 'approved', trainingReady: true, benchmarkOnly: false,
      trainingAsset: { uri: asset.uri, approvedForTraining: true, retentionClass: asset.retentionClass || null },
      semanticEmbedding: { model: item.semanticEmbedding.model, dimension: item.semanticEmbedding.dimension, semanticClusterId: assignment.semanticClusterId, semanticClusterApproved: true },
      datasetSplit: assignment.split, datasetSplitFinal: true, leakageGroupId: assignment.leakageGroupId,
      embeddingVector: [...feature.vector],
    });
  }
  if (!['train', 'validation', 'test'].every(split => items.some(item => item.datasetSplit === split))) throw new Error('independent_train_validation_test_required');
  return { schemaVersion: 1, labelVersion: 'artes_detector_v1', datasetVersion: manifest.datasetVersion, embedding: { modelId, revision, dimension: 768 }, items };
};
