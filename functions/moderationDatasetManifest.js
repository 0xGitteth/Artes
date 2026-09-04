import crypto from 'crypto';
import { ARTES_DETECTOR_LABEL_VERSION } from './moderationLearningDataset.js';

export const MODERATION_DATASET_MANIFEST_SCHEMA_VERSION = 1;
export const GROUP_STRATIFIED_SPLIT_VERSION = 'group_stratified_v2_source_pool';

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

const buildLeakageGroups = (items) => {
  const parents = items.map((_, index) => index);
  const ranks = items.map(() => 0);
  const find = (index) => {
    let cursor = index;
    while (parents[cursor] !== cursor) {
      parents[cursor] = parents[parents[cursor]];
      cursor = parents[cursor];
    }
    return cursor;
  };
  const union = (leftIndex, rightIndex) => {
    let leftRoot = find(leftIndex);
    let rightRoot = find(rightIndex);
    if (leftRoot === rightRoot) return;
    if (ranks[leftRoot] < ranks[rightRoot]) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    parents[rightRoot] = leftRoot;
    if (ranks[leftRoot] === ranks[rightRoot]) ranks[leftRoot] += 1;
  };

  const firstByRelation = new Map();
  items.forEach((item, index) => {
    const clusterId = cleanString(item?.semanticEmbedding?.semanticClusterId);
    const sourcePoolId = cleanString(item?.sourcePoolId);
    const relationKeys = [clusterId ? `cluster:${clusterId}` : null, sourcePoolId ? `source:${sourcePoolId}` : null].filter(Boolean);
    for (const key of relationKeys) {
      if (firstByRelation.has(key)) union(index, firstByRelation.get(key));
      else firstByRelation.set(key, index);
    }
  });

  const components = new Map();
  items.forEach((item, index) => {
    const root = find(index);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(item);
  });

  const groups = new Map();
  for (const groupItems of components.values()) {
    const semanticClusterIds = Array.from(new Set(groupItems.map((item) => cleanString(item?.semanticEmbedding?.semanticClusterId)).filter(Boolean))).sort();
    const sourcePoolIds = Array.from(new Set(groupItems.map((item) => cleanString(item?.sourcePoolId)).filter(Boolean))).sort();
    const relationKeys = [
      ...semanticClusterIds.map((value) => `cluster:${value}`),
      ...sourcePoolIds.map((value) => `source:${value}`),
    ].sort();
    const leakageGroupId = `leakage_${stableHash(relationKeys.join('|')).slice(0, 16)}`;
    groups.set(leakageGroupId, { leakageGroupId, items: groupItems, semanticClusterIds, sourcePoolIds });
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

  const groups = buildLeakageGroups(eligible);
  const globalStrata = countStrata(eligible);
  const targetCounts = Object.fromEntries(SPLITS.map((split) => [split, eligible.length * ratios[split]]));
  const targetStrata = Object.fromEntries(SPLITS.map((split) => [
    split,
    new Map(Array.from(globalStrata.entries()).map(([stratum, count]) => [stratum, count * ratios[split]])),
  ]));
  const splitCounts = Object.fromEntries(SPLITS.map((split) => [split, 0]));
  const splitStrata = Object.fromEntries(SPLITS.map((split) => [split, new Map()]));

  const orderedGroups = Array.from(groups.values()).map((group) => {
    const strata = countStrata(group.items);
    const rarity = Array.from(strata.keys()).reduce((score, stratum) => (
      score + (1 / Math.max(globalStrata.get(stratum) || 1, 1))
    ), 0);
    return { ...group, strata, rarity };
  }).sort((a, b) => (
    b.rarity - a.rarity
    || b.items.length - a.items.length
    || stableHash(`${version}:${a.leakageGroupId}`).localeCompare(stableHash(`${version}:${b.leakageGroupId}`))
  ));

  const leakageGroupAssignments = {};
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
      tie: stableHash(`${version}:${group.leakageGroupId}:${split}`),
    })).sort((a, b) => a.cost - b.cost || a.tie.localeCompare(b.tie));

    const selected = rankedSplits[0].split;
    leakageGroupAssignments[group.leakageGroupId] = selected;
    splitCounts[selected] += group.items.length;
    addCounts(splitStrata[selected], group.strata);
  }

  const leakageGroupByItem = new Map();
  for (const group of groups.values()) {
    for (const item of group.items) leakageGroupByItem.set(item, group.leakageGroupId);
  }

  const clusterAssignments = {};
  const sourcePoolAssignments = {};
  for (const group of groups.values()) {
    const split = leakageGroupAssignments[group.leakageGroupId];
    for (const clusterId of group.semanticClusterIds) clusterAssignments[clusterId] = split;
    for (const sourcePoolId of group.sourcePoolIds) sourcePoolAssignments[sourcePoolId] = split;
  }

  const assignments = eligible
    .map((item) => {
      const leakageGroupId = leakageGroupByItem.get(item);
      return {
        sourceExampleId: item.sourceExampleId,
        semanticClusterId: item.semanticEmbedding.semanticClusterId,
        sourcePoolId: cleanString(item.sourcePoolId) || null,
        leakageGroupId,
        split: leakageGroupAssignments[leakageGroupId],
      };
    })
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
    clusterCount: new Set(eligible.map((item) => cleanString(item?.semanticEmbedding?.semanticClusterId))).size,
    sourcePoolCount: new Set(eligible.map((item) => cleanString(item?.sourcePoolId)).filter(Boolean)).size,
    leakageGroupCount: groups.size,
    splitCounts,
    stratumCounts,
    clusterAssignments,
    sourcePoolAssignments,
    leakageGroupAssignments,
    assignments,
  };
};
