import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtesDetectorLabel, normalizeArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'external-poc');
const INTAKE_PATH = path.join(BASE_DIR, 'intake.json');
const LABELS_PATH = path.join(BASE_DIR, 'labels.reviewed.json');
const ANALYSIS_PATH = path.join(BASE_DIR, 'reviewed-analysis.json');
const OUTPUT_PATH = path.join(BASE_DIR, 'seed-v1.json');
const COVERAGE_PATH = path.join(BASE_DIR, 'coverage-v1.json');

const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;
const NUDITY_VALUES = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];
const SEXUAL_CONTEXT_VALUES = ['none', 'suggestive', 'bdsm_kink', 'explicit_act'];
const GRAPHIC_INJURY_VALUES = ['none', 'mild', 'graphic'];
const SENSITIVE_SIGNALS = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare'];

const countBy = (values) => Object.fromEntries(values.map((value) => [value, 0]));

const intake = JSON.parse(await readFile(INTAKE_PATH, 'utf8'));
const reviewed = JSON.parse(await readFile(LABELS_PATH, 'utf8'));
const analysis = JSON.parse(await readFile(ANALYSIS_PATH, 'utf8'));

const intakeItems = Array.isArray(intake?.items) ? intake.items : [];
const labelItems = Array.isArray(reviewed?.items) ? reviewed.items : [];
const pairGroups = Array.isArray(analysis?.mutualNearestNeighborPairs) ? analysis.mutualNearestNeighborPairs : [];

if (intakeItems.length === 0 || intakeItems.length !== labelItems.length) {
  throw new Error('seed_input_count_mismatch');
}
if (reviewed?.labelStatus !== 'complete' || labelItems.some((item) => item.labelStatus !== 'human_confirmed')) {
  throw new Error('seed_requires_complete_human_labels');
}
if (analysis?.thresholdSelected !== false || analysis?.trainingReady !== false) {
  throw new Error('seed_requires_unpromoted_poc_analysis');
}

const labelByFile = new Map(labelItems.map((item) => [item.fileName, item]));
const provisionalGroupByFile = new Map();
for (const group of pairGroups) {
  for (const fileName of group.items || []) provisionalGroupByFile.set(`${fileName}.png`, group.groupId);
  for (const fileName of group.items || []) provisionalGroupByFile.set(`${fileName}.jpg`, group.groupId);
  for (const fileName of group.items || []) provisionalGroupByFile.set(`${fileName}.jpeg`, group.groupId);
  for (const fileName of group.items || []) provisionalGroupByFile.set(`${fileName}.webp`, group.groupId);
}

const items = intakeItems.map((item) => {
  const labelItem = labelByFile.get(item.fileName);
  if (!labelItem || labelItem.sha256 !== item.sha256) throw new Error(`seed_label_hash_mismatch:${item.fileName}`);
  const validation = validateArtesDetectorLabel(labelItem.detectorLabel);
  if (!validation.valid) throw new Error(`seed_invalid_label:${item.fileName}:${validation.errors.join(',')}`);
  const embedding = item.embedding;
  if (!embedding || embedding.model !== EXPECTED_MODEL || embedding.dimension !== EXPECTED_DIMENSION || !Array.isArray(embedding.vector) || embedding.vector.length !== EXPECTED_DIMENSION) {
    throw new Error(`seed_invalid_embedding:${item.fileName}`);
  }
  if (!embedding.vector.every(Number.isFinite)) throw new Error(`seed_non_finite_embedding:${item.fileName}`);

  return {
    sourceFileName: item.fileName,
    sourceSha256: item.sha256,
    labelVersion: item.labelVersion,
    detectorLabel: normalizeArtesDetectorLabel(labelItem.detectorLabel),
    labelSource: 'local_human_review',
    labelStatus: 'human_confirmed',
    embedding: {
      model: embedding.model,
      dimension: embedding.dimension,
      vector: embedding.vector,
    },
    provisionalNeighborGroupId: provisionalGroupByFile.get(item.fileName) || null,
    semanticClusterId: null,
    datasetSplit: null,
    trainingReady: false,
  };
});

const nudityCounts = countBy(NUDITY_VALUES);
const sexualContextCounts = countBy(SEXUAL_CONTEXT_VALUES);
const graphicInjuryCounts = countBy(GRAPHIC_INJURY_VALUES);
const sensitiveSignalCounts = countBy(SENSITIVE_SIGNALS);
let possibleMinorConcernTrue = 0;
let possibleMinorConcernFalse = 0;

for (const item of items) {
  nudityCounts[item.detectorLabel.nudity] += 1;
  sexualContextCounts[item.detectorLabel.sexualContext] += 1;
  graphicInjuryCounts[item.detectorLabel.graphicInjury] += 1;
  for (const signal of item.detectorLabel.sensitiveSignals) sensitiveSignalCounts[signal] += 1;
  if (item.detectorLabel.possibleMinorConcern) possibleMinorConcernTrue += 1;
  else possibleMinorConcernFalse += 1;
}

const missing = {
  nudity: NUDITY_VALUES.filter((value) => nudityCounts[value] === 0),
  sexualContext: SEXUAL_CONTEXT_VALUES.filter((value) => sexualContextCounts[value] === 0),
  graphicInjury: GRAPHIC_INJURY_VALUES.filter((value) => graphicInjuryCounts[value] === 0),
  sensitiveSignals: SENSITIVE_SIGNALS.filter((value) => sensitiveSignalCounts[value] === 0),
  possibleMinorConcernTrue: possibleMinorConcernTrue === 0,
};

const seed = {
  schemaVersion: 1,
  seedVersion: 'external_poc_seed_v1',
  status: 'validated_human_labeled_poc_seed',
  itemCount: items.length,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  thresholdSelected: false,
  semanticClustersPromoted: false,
  trainingReady: false,
  items,
};

const coverage = {
  schemaVersion: 1,
  seedVersion: seed.seedVersion,
  itemCount: items.length,
  counts: {
    nudity: nudityCounts,
    sexualContext: sexualContextCounts,
    graphicInjury: graphicInjuryCounts,
    sensitiveSignals: sensitiveSignalCounts,
    possibleMinorConcern: { true: possibleMinorConcernTrue, false: possibleMinorConcernFalse },
  },
  missing,
  classifierTrainingRecommended: false,
  reason: 'seed_is_valid_but_too_small_and_category_coverage_is_incomplete',
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  seedVersion: seed.seedVersion,
  itemCount: items.length,
  humanConfirmed: items.length,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  provisionalNeighborGroups: new Set(items.map((item) => item.provisionalNeighborGroupId).filter(Boolean)).size,
  trainingReady: false,
  classifierTrainingRecommended: false,
  missing,
  outputs: [
    '.tmp/moderation-test-set/external-poc/seed-v1.json',
    '.tmp/moderation-test-set/external-poc/coverage-v1.json',
  ],
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
