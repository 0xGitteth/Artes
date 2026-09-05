import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtesDetectorLabel, normalizeArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASE_SEED_PATH = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'combined-external-v1', 'seed-v1.json');
const MALE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'external-male-topless-v1');
const MALE_INTAKE_PATH = path.join(MALE_DIR, 'intake.json');
const MALE_LABELS_PATH = path.join(MALE_DIR, 'labels.reviewed.json');
const MALE_ANALYSIS_PATH = path.join(MALE_DIR, 'reviewed-analysis.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'combined-external-v2');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'seed-v2.json');
const COVERAGE_PATH = path.join(OUTPUT_DIR, 'coverage-v2.json');

const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;
const NUDITY_VALUES = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];
const SEXUAL_CONTEXT_VALUES = ['none', 'suggestive', 'bdsm_kink', 'explicit_act'];
const GRAPHIC_INJURY_VALUES = ['none', 'mild', 'graphic'];
const SENSITIVE_SIGNALS = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare'];
const countBy = (values) => Object.fromEntries(values.map((value) => [value, 0]));

const [baseSeed, maleIntake, maleLabels, maleAnalysis] = await Promise.all([
  readFile(BASE_SEED_PATH, 'utf8').then(JSON.parse),
  readFile(MALE_INTAKE_PATH, 'utf8').then(JSON.parse),
  readFile(MALE_LABELS_PATH, 'utf8').then(JSON.parse),
  readFile(MALE_ANALYSIS_PATH, 'utf8').then(JSON.parse),
]);

if (baseSeed?.seedVersion !== 'combined_external_seed_v1' || baseSeed?.trainingReady !== false || !Array.isArray(baseSeed?.items) || baseSeed.items.length !== 8) {
  throw new Error('combined_v2_invalid_base_seed');
}
if (maleAnalysis?.analysisType !== 'external_male_topless_v1_human_label_validation' || maleAnalysis?.trainingReady !== false || maleAnalysis?.thresholdSelected !== false) {
  throw new Error('combined_v2_requires_validated_male_topless_batch');
}
if (maleLabels?.labelStatus !== 'complete' || maleLabels?.trainingReady === true) throw new Error('combined_v2_requires_complete_male_labels');
if (!Array.isArray(maleIntake?.items) || maleIntake.items.length !== 1 || !Array.isArray(maleLabels?.items) || maleLabels.items.length !== 1) {
  throw new Error('combined_v2_male_item_count_mismatch');
}

const intakeItem = maleIntake.items[0];
const labelItem = maleLabels.items[0];
if (intakeItem.fileName !== labelItem.fileName || intakeItem.sha256 !== labelItem.sha256 || maleAnalysis?.item?.sha256 !== intakeItem.sha256) {
  throw new Error('combined_v2_male_hash_mismatch');
}
if (labelItem.labelStatus !== 'human_confirmed' || labelItem.labelSource !== 'local_human_review') throw new Error('combined_v2_male_not_human_confirmed');
const validation = validateArtesDetectorLabel(labelItem.detectorLabel);
if (!validation.valid) throw new Error(`combined_v2_invalid_male_label:${validation.errors.join(',')}`);
const embedding = intakeItem.embedding;
if (!embedding || embedding.model !== EXPECTED_MODEL || embedding.dimension !== EXPECTED_DIMENSION || !Array.isArray(embedding.vector) || embedding.vector.length !== EXPECTED_DIMENSION || !embedding.vector.every(Number.isFinite)) {
  throw new Error('combined_v2_invalid_male_embedding');
}
const sourcePoolId = String(maleAnalysis?.item?.sourcePoolId || '').trim();
if (!sourcePoolId) throw new Error('combined_v2_missing_male_source_pool');

const newItem = {
  sourceDataset: 'external-male-topless-v1',
  sourceFileName: intakeItem.fileName,
  sourceSha256: intakeItem.sha256,
  sourcePoolId,
  labelVersion: maleLabels.labelVersion,
  detectorLabel: normalizeArtesDetectorLabel(labelItem.detectorLabel),
  labelSource: 'local_human_review',
  labelStatus: 'human_confirmed',
  embedding: {
    model: embedding.model,
    dimension: embedding.dimension,
    vector: embedding.vector,
  },
  provisionalNeighborGroupId: null,
  metadataSuggestionOverridden: maleAnalysis.item.humanOverrodeMetadataSuggestion === true,
  semanticClusterId: null,
  datasetSplit: null,
  trainingReady: false,
};

const items = [...baseSeed.items.map((item) => ({ ...item, trainingReady: false, semanticClusterId: null, datasetSplit: null })), newItem];
const fingerprints = new Set();
for (const item of items) {
  if (!item.sourceSha256 || fingerprints.has(item.sourceSha256)) throw new Error('combined_v2_duplicate_or_missing_sha256');
  fingerprints.add(item.sourceSha256);
  if (!item.sourcePoolId) throw new Error(`combined_v2_missing_source_pool:${item.sourceFileName || 'unknown'}`);
  const itemValidation = validateArtesDetectorLabel(item.detectorLabel);
  if (!itemValidation.valid) throw new Error(`combined_v2_invalid_label:${item.sourceFileName || 'unknown'}:${itemValidation.errors.join(',')}`);
}

const nudityCounts = countBy(NUDITY_VALUES);
const sexualContextCounts = countBy(SEXUAL_CONTEXT_VALUES);
const graphicInjuryCounts = countBy(GRAPHIC_INJURY_VALUES);
const sensitiveSignalCounts = countBy(SENSITIVE_SIGNALS);
const sourcePoolCounts = {};
const sourcePoolsPerNudity = Object.fromEntries(NUDITY_VALUES.map((value) => [value, new Set()]));
let possibleMinorConcernTrue = 0;
let possibleMinorConcernFalse = 0;

for (const item of items) {
  nudityCounts[item.detectorLabel.nudity] += 1;
  sexualContextCounts[item.detectorLabel.sexualContext] += 1;
  graphicInjuryCounts[item.detectorLabel.graphicInjury] += 1;
  for (const signal of item.detectorLabel.sensitiveSignals) sensitiveSignalCounts[signal] += 1;
  if (item.detectorLabel.possibleMinorConcern) possibleMinorConcernTrue += 1;
  else possibleMinorConcernFalse += 1;
  sourcePoolCounts[item.sourcePoolId] = (sourcePoolCounts[item.sourcePoolId] || 0) + 1;
  sourcePoolsPerNudity[item.detectorLabel.nudity].add(item.sourcePoolId);
}

const sourcePoolCountsPerNudity = Object.fromEntries(NUDITY_VALUES.map((value) => [value, sourcePoolsPerNudity[value].size]));
const missing = {
  nudity: NUDITY_VALUES.filter((value) => nudityCounts[value] === 0),
  sexualContext: SEXUAL_CONTEXT_VALUES.filter((value) => sexualContextCounts[value] === 0),
  graphicInjury: GRAPHIC_INJURY_VALUES.filter((value) => graphicInjuryCounts[value] === 0),
  sensitiveSignals: SENSITIVE_SIGNALS.filter((value) => sensitiveSignalCounts[value] === 0),
  possibleMinorConcernTrue: possibleMinorConcernTrue === 0,
};

const combinedSeed = {
  schemaVersion: 1,
  seedVersion: 'combined_external_seed_v2',
  status: 'validated_human_labeled_poc_seed',
  sourceSeedVersions: ['combined_external_seed_v1', 'external_male_topless_v1'],
  itemCount: items.length,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  thresholdSelected: false,
  semanticClustersPromoted: false,
  sourcePoolLeakageGuardRequired: true,
  trainingReady: false,
  classifierTrainingRecommended: false,
  items,
};

const coverage = {
  schemaVersion: 1,
  seedVersion: combinedSeed.seedVersion,
  itemCount: items.length,
  humanConfirmed: items.length,
  metadataSuggestionOverrides: items.filter((item) => item.metadataSuggestionOverridden).length,
  sourcePoolCounts,
  sourcePoolCount: Object.keys(sourcePoolCounts).length,
  sourcePoolsPerNudity: sourcePoolCountsPerNudity,
  counts: {
    nudity: nudityCounts,
    sexualContext: sexualContextCounts,
    graphicInjury: graphicInjuryCounts,
    sensitiveSignals: sensitiveSignalCounts,
    possibleMinorConcern: { true: possibleMinorConcernTrue, false: possibleMinorConcernFalse },
  },
  missing,
  classifierTrainingRecommended: false,
  reason: 'combined_v2_is_observation_coverage_only_and_remains_far_below_per_class_probe_gates',
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(combinedSeed, null, 2)}\n`, 'utf8');
await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  seedVersion: combinedSeed.seedVersion,
  itemCount: combinedSeed.itemCount,
  humanConfirmed: coverage.humanConfirmed,
  sourcePoolCount: coverage.sourcePoolCount,
  sourcePoolCounts: coverage.sourcePoolCounts,
  sourcePoolsPerNudity: coverage.sourcePoolsPerNudity,
  counts: coverage.counts,
  missing: coverage.missing,
  trainingReady: false,
  classifierTrainingRecommended: false,
  outputs: [
    '.tmp/moderation-test-set/combined-external-v2/seed-v2.json',
    '.tmp/moderation-test-set/combined-external-v2/coverage-v2.json',
  ],
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
