import crypto from 'crypto';
import { ARTES_DETECTOR_LABEL_VERSION } from './moderationLearningDataset.js';

export const MODERATION_DATASET_MANIFEST_SCHEMA_VERSION = 1;
export const GROUP_STRATIFIED_SPLIT_VERSION = 'group_stratified_v1';

const DEFAULT_RATIOS = Object.freeze({ train: 0.8, validation: 0.1, test: 0.1 });
const SPLITS = Object.freeze(['train', 'validation', 'test']);
const cleanString = (value) => String(value || '').trim();

const stableHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const validateRatios = (ratios = DEFAULT_RATIOS) => {
  const values = SPLITS.map((split) => ratios?.[split]);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
    return false;
  }
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) < 1e-9;
};

export const detectorLabelStrata = (label = {}) => {
  const strata = [
    `nudity:${cleanString(label.nudity) || 'missing'}`,
    `sexualContext:${cleanString(label.sexualContext) || 'missing'}`,
    `graphicInjury:${cleanString(label.graphicInjury) || 'missing'}`,
    `possibleMinorConcern:${label.possibleMinorConcern === true ? 'true' : 'false'}`,
  ];

  const sensitiveSignals = Array.isArray(label.sensitiveSignals)
    ? Array.from(new Set(label.sensitiveSignals.map(cleanString).filter(Boolean))).sort()
    : [];
  if (sensitiveSignals.length === 0) strata.push('sensitiveSignal:none');
  else sensitiveSignals.forEach((signal) => strata.push(`sensitiveSignal:${signal}`));

  return strata;
};

const buildGroups = (items) => {
  const groups = new Map();
  for (const item of items) {
    const clusterId = cleanString(item?.semanticEmbedding?.semanticClusterId);
    if (!clusterId) continue;
    if (!groups.has(clusterId)) groups.set(clusterId, []);
    groups.get(clusterId).push(item);
  }
  return groups;
};

const countStrata = (items) => {
  const counts = new Map();
  for (const item of items) {
    for (const stratum of detectorLabelStrata(item.detectorLabel)) {
      counts.set(stratum, (counts.get(stratum) || 0) + 1);
    }
  }
  return counts;
};

const addCounts = (target, source) => {
  for (const [key, value] of source.entries()) target.set(key, (target.get(key) || 0) + value);
};

const assignmentCost = ({
  split,
  groupSize,
  groupStrata,
  splitCounts,
  splitStrata,
  targetCounts,
  targetStrata,
}) => {
  const nextCount = splitCounts[split] + groupSize;
  const countTarget = Math.max(targetCounts[split], 1);
  const countCost = Math.abs(nextCount - targetCounts[split]) / countTarget;

  let strataCost = 0;
  let strataTerms = 0;
  for (const [stratum, groupCount] of groupStrata.entries()) {
    const nextStratumCount = (splitStrata[split].get(stratum) || 0) + groupCount;
    const target = Math.max(targetStrata[split].get(stratum) || 0, 1);
    strataCost += Math.abs(nextStratumCount - (targetStrata[split].get(stratum) || 0)) / target;
    strataTerms += 1;
  }

  return countCost + (strataTerms ? strataCost / strataTerms : 0);
};

export const buildGroupStratifiedDatasetManifest = ({
  items = [],
  datasetVersion,
  ratios = DEFAULT_RATIOS,
} = {}) => {
  const version = cleanString(datasetVersion);
  if (!version) throw new Error('missing_dataset_version');
  if (!validateRatios(ratios)) throw new Error('invalid_split_ratios');

  const eligible = (Array.isArray(items) ? items : []).filter((item) => (
    item?.trainingReady === true
    && item?.benchmarkOnly !== true
    && cleanString(item?.labelVersion) === ARTES_DETECTOR_LABEL_VERSION
    && cleanString(item?.semanticEmbedding?.semanticClusterId)
    && cleanString(item?.sourceExampleId)
  ));

  const groups = buildGroups(eligible);
  const globalStrata = countStrata(eligible);
  const targetCounts = Object.fromEntries(SPLITS.map((split) => [split, eligible.length * ratios[split]]));
  const targetStrata = Object.fromEntries(SPLITS.map((split) => [
    split,
    new Map(Array.from(globalStrata.entries()).map(([stratum, count]) => [stratum, count * ratios[split]])),
  ]));
  const splitCounts = Object.fromEntries(SPLITS.map((split) => [split, 0]));
  const splitStrata = Object.fromEntries(SPLITS.map((split) => [split, new Map()]));

  const orderedGroups = Array.from(groups.entries()).map(([clusterId, groupItems]) => {
    const strata = countStrata(groupItems);
    const rarity = Array.from(strata.keys()).reduce((score, stratum) => (
      score + (1 / Math.max(globalStrata.get(stratum) || 1, 1))
    ), 0);
    return { clusterId, items: groupItems, strata, rarity };
  }).sort((a, b) => (
    b.rarity - a.rarity
    || b.items.length - a.items.length
    || stableHash(`${version}:${a.clusterId}`).localeCompare(stableHash(`${version}:${b.clusterId}`))
  ));

  const clusterAssignments = {};
  for (const group of orderedGroups) {
    const rankedSplits = SPLITS.map((split) => ({
      split,
      cost: assignmentCost({
        split,
        groupSize: group.items.length,
        groupStrata: group.strata,
        splitCounts,
        splitStrata,
        targetCounts,
        targetStrata,
      }),
      tie: stableHash(`${version}:${group.clusterId}:${split}`),
    })).sort((a, b) => a.cost - b.cost || a.tie.localeCompare(b.tie));

    const selected = rankedSplits[0].split;
    clusterAssignments[group.clusterId] = selected;
    splitCounts[selected] += group.items.length;
    addCounts(splitStrata[selected], group.strata);
  }

  const assignments = eligible
    .map((item) => ({
      sourceExampleId: item.sourceExampleId,
      semanticClusterId: item.semanticEmbedding.semanticClusterId,
      split: clusterAssignments[item.semanticEmbedding.semanticClusterId],
    }))
    .sort((a, b) => a.sourceExampleId.localeCompare(b.sourceExampleId));

  const stratumCounts = {};
  for (const split of SPLITS) {
    stratumCounts[split] = Object.fromEntries(Array.from(splitStrata[split].entries()).sort(([a], [b]) => a.localeCompare(b)));
  }

  return {
    schemaVersion: MODERATION_DATASET_MANIFEST_SCHEMA_VERSION,
    splitVersion: GROUP_STRATIFIED_SPLIT_VERSION,
    datasetVersion: version,
    labelVersion: ARTES_DETECTOR_LABEL_VERSION,
    ratios: { ...ratios },
    eligibleItemCount: eligible.length,
    excludedItemCount: Math.max((Array.isArray(items) ? items.length : 0) - eligible.length, 0),
    clusterCount: groups.size,
    splitCounts,
    stratumCounts,
    clusterAssignments,
    assignments,
  };
};
