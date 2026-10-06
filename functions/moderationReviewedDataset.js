import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { getHumanClassifierExpectation } from './moderationClassifierEvaluation.js';

export const REVIEWED_LABEL_DEFINITION = 'artes_nudity_visible_pubic_region_v2_2026_10_06';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const loadReviewedDataset = async (datasetPath, { split = 'train', clearancePath = null } = {}) => {
  if (!['train', 'test'].includes(split)) throw new Error('split_must_be_train_or_test');
  const root = await realpath(path.dirname(path.resolve(datasetPath)));
  const bytes = await readFile(datasetPath);
  const datasetSha256 = sha256(bytes);
  const dataset = JSON.parse(bytes);
  if (dataset.schemaVersion !== 4 || !Array.isArray(dataset.items)
    || dataset.humanLabelsAuthoritative !== true
    || dataset.labelDefinitionVersion !== REVIEWED_LABEL_DEFINITION) {
    throw new Error('unsupported_reviewed_dataset_or_label_definition');
  }
  let approvals = new Map();
  if (clearancePath) {
    const clearance = JSON.parse(await readFile(clearancePath, 'utf8'));
    if (clearance.datasetSha256 !== datasetSha256 || !Array.isArray(clearance.items)) {
      throw new Error('evaluation_clearance_dataset_mismatch');
    }
    for (const item of clearance.items) {
      if (!item.candidateId || approvals.has(item.candidateId)) throw new Error('invalid_or_duplicate_evaluation_clearance');
      approvals.set(item.candidateId, item);
    }
  }
  const ids = new Set();
  const fingerprints = new Set();
  const poolSplits = new Map();
  const verified = [];
  let excluded = 0;
  for (const item of dataset.items) {
    if (!item.candidateId || ids.has(item.candidateId)) throw new Error('missing_or_duplicate_candidate_id');
    ids.add(item.candidateId);
    if (item.labelStatus === 'human_excluded' && item.includedInReviewedResearchDataset === false) {
      excluded += 1;
      continue;
    }
    if (item.labelStatus !== 'human_confirmed' || item.humanLabelConfirmed !== true
      || item.includedInReviewedResearchDataset !== true || item.needsManualReview !== false
      || !item.humanReviewConfirmedAt || !item.humanReviewExportSha256
      || item.labelDefinitionVersion !== REVIEWED_LABEL_DEFINITION) {
      throw new Error(`unconfirmed_human_label:${item.candidateId}`);
    }
    if (!['train', 'test'].includes(item.proposedSplit) || !item.sourcePoolId) throw new Error(`invalid_source_or_split:${item.candidateId}`);
    if (item.detectorLabel?.nudity !== item.nudity || item.detectorLabel?.sexualContext !== item.sexualContext) {
      throw new Error(`conflicting_human_labels:${item.candidateId}`);
    }
    getHumanClassifierExpectation(item.detectorLabel);
    if (fingerprints.has(item.sha256)) throw new Error(`duplicate_image_sha256:${item.candidateId}`);
    fingerprints.add(item.sha256);
    const earlierSplit = poolSplits.get(item.sourcePoolId);
    if (earlierSplit && earlierSplit !== item.proposedSplit) throw new Error(`source_pool_split_leakage:${item.sourcePoolId}`);
    poolSplits.set(item.sourcePoolId, item.proposedSplit);
    if (typeof item.localPath !== 'string' || path.isAbsolute(item.localPath)) throw new Error(`invalid_image_path:${item.candidateId}`);
    const absolutePath = await realpath(path.resolve(root, item.localPath));
    const relative = path.relative(root, absolutePath);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`image_path_outside_dataset:${item.candidateId}`);
    }
    if (sha256(await readFile(absolutePath)) !== item.sha256) throw new Error(`image_hash_mismatch:${item.candidateId}`);
    const approval = approvals.get(item.candidateId);
    const evaluationApproved = approval?.approvedForClassifierEvaluation === true
      && approval?.sha256 === item.sha256
      && typeof approval?.evidence === 'string' && approval.evidence.trim().length > 0;
    verified.push({ ...item, absolutePath, evaluationApproved });
  }
  const selected = verified.filter((item) => item.proposedSplit === split);
  const byNudity = {};
  const bySexualContext = {};
  for (const item of selected) {
    byNudity[item.nudity] = (byNudity[item.nudity] || 0) + 1;
    bySexualContext[item.sexualContext] = (bySexualContext[item.sexualContext] || 0) + 1;
  }
  return {
    datasetSha256, datasetVersion: dataset.datasetVersion,
    labelDefinitionVersion: dataset.labelDefinitionVersion,
    selected,
    preflight: {
      split, verifiedImages: verified.length, excludedImages: excluded,
      selectedImages: selected.length, byNudity, bySexualContext,
      evaluationApproved: selected.filter((item) => item.evaluationApproved).length,
      evaluationPending: selected.filter((item) => !item.evaluationApproved).length,
      sourcePoolsSeparated: true, humanLabelsChanged: false,
      note: 'Hash and label checks only; no AI call. Evaluation clearance is separate from training readiness. Creator separation does not prove scene-level independence.',
    },
  };
};
