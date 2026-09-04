import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtesDetectorLabel, normalizeArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SEED_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'external-poc');
const EXPANSION_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'external-expansion-v1');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', 'combined-external-v1');
const ORIGINAL_SEED_PATH = path.join(SEED_DIR, 'seed-v1.json');
const EXPANSION_INTAKE_PATH = path.join(EXPANSION_DIR, 'intake.json');
const EXPANSION_LABELS_PATH = path.join(EXPANSION_DIR, 'labels.reviewed.json');
const EXPANSION_ANALYSIS_PATH = path.join(EXPANSION_DIR, 'reviewed-analysis.json');
const ORIGINAL_MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'moderation-external-poc-manifest-v1.json');
const EXPANSION_MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'moderation-external-expansion-poc-v1.json');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'seed-v1.json');
const COVERAGE_PATH = path.join(OUTPUT_DIR, 'coverage-v1.json');

const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;
const NUDITY_VALUES = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];
const SEXUAL_CONTEXT_VALUES = ['none', 'suggestive', 'bdsm_kink', 'explicit_act'];
const GRAPHIC_INJURY_VALUES = ['none', 'mild', 'graphic'];
const SENSITIVE_SIGNALS = ['bloodInjury', 'selfHarm', 'suicide', 'eatingDisorder', 'substanceDistress', 'violence', 'horrorScare'];
const countBy = (values) => Object.fromEntries(values.map((value) => [value, 0]));
const sourceIdFromFileName = (fileName) => String(fileName || '').replace(/\.(?:jpe?g|png|webp)$/i, '');

const [seed, expansionIntake, expansionLabels, expansionAnalysis, originalManifest, expansionManifest] = await Promise.all([
  readFile(ORIGINAL_SEED_PATH, 'utf8').then(JSON.parse),
  readFile(EXPANSION_INTAKE_PATH, 'utf8').then(JSON.parse),
  readFile(EXPANSION_LABELS_PATH, 'utf8').then(JSON.parse),
  readFile(EXPANSION_ANALYSIS_PATH, 'utf8').then(JSON.parse),
  readFile(ORIGINAL_MANIFEST_PATH, 'utf8').then(JSON.parse),
  readFile(EXPANSION_MANIFEST_PATH, 'utf8').then(JSON.parse),
]);

if (seed?.seedVersion !== 'external_poc_seed_v1' || seed?.trainingReady !== false || !Array.isArray(seed?.items) || seed.items.length !== 4) {
  throw new Error('combined_seed_invalid_original_seed');
}
if (expansionLabels?.labelStatus !== 'complete' || expansionLabels?.trainingReady === true) {
  throw new Error('combined_seed_requires_complete_expansion_labels');
}
if (expansionAnalysis?.analysisType !== 'external_expansion_v1_human_label_validation' || expansionAnalysis?.trainingReady !== false || expansionAnalysis?.thresholdSelected !== false) {
  throw new Error('combined_seed_requires_validated_unpromoted_expansion');
}

const originalManifestById = new Map((originalManifest?.entries || []).map((entry) => [entry.id, entry]));
const expansionManifestById = new Map((expansionManifest?.entries || []).map((entry) => [entry.id, entry]));
const requireSourcePoolId = (manifestById, fileName) => {
  const sourceId = sourceIdFromFileName(fileName);
  const entry = manifestById.get(sourceId);
  const sourcePoolId = String(entry?.sourcePoolId || '').trim();
  if (!sourcePoolId) throw new Error(`combined_seed_missing_source_pool:${fileName}`);
  return sourcePoolId;
};

const expansionIntakeItems = Array.isArray(expansionIntake?.items) ? expansionIntake.items : [];
const expansionLabelItems = Array.isArray(expansionLabels?.items) ? expansionLabels.items : [];
if (expansionIntakeItems.length !== 4 || expansionLabelItems.length !== 4) throw new Error('combined_seed_expansion_count_mismatch');

const expansionLabelByFile = new Map(expansionLabelItems.map((item) => [item.fileName, item]));
const expansionAnalysisByFile = new Map((expansionAnalysis.items || []).map((item) => [item.fileName, item]));
const expansionItems = expansionIntakeItems.map((item) => {
  const labelItem = expansionLabelByFile.get(item.fileName);
  const analysisItem = expansionAnalysisByFile.get(item.fileName);
  if (!labelItem || !analysisItem) throw new Error(`combined_seed_missing_expansion_metadata:${item.fileName}`);
  if (labelItem.sha256 !== item.sha256 || analysisItem.sha256 !== item.sha256) throw new Error(`combined_seed_expansion_hash_mismatch:${item.fileName}`);
  if (labelItem.labelStatus !== 'human_confirmed' || labelItem.labelSource !== 'local_human_review') throw new Error(`combined_seed_expansion_not_human_confirmed:${item.fileName}`);
  const validation = validateArtesDetectorLabel(labelItem.detectorLabel);
  if (!validation.valid) throw new Error(`combined_seed_invalid_expansion_label:${item.fileName}:${validation.errors.join(',')}`);
  const embedding = item.embedding;
  if (!embedding || embedding.model !== EXPECTED_MODEL || embedding.dimension !== EXPECTED_DIMENSION || !Array.isArray(embedding.vector) || embedding.vector.length !== EXPECTED_DIMENSION || !embedding.vector.every(Number.isFinite)) {
    throw new Error(`combined_seed_invalid_expansion_embedding:${item.fileName}`);
  }
  return {
    sourceDataset: 'external-expansion-v1',
    sourceFileName: item.fileName,
    sourceSha256: item.sha256,
    sourcePoolId: requireSourcePoolId(expansionManifestById, item.fileName),
    labelVersion: item.labelVersion,
    detectorLabel: normalizeArtesDetectorLabel(labelItem.detectorLabel),
    labelSource: 'local_human_review',
    labelStatus: 'human_confirmed',
    embedding: {
      model: embedding.model,
      dimension: embedding.dimension,
      vector: embedding.vector,
    },
    provisionalNeighborGroupId: analysisItem.pocNeighborGroupId || null,
    metadataSuggestionOverridden: analysisItem.humanOverrodeMetadataSuggestion === true,
    semanticClusterId: null,
    datasetSplit: null,
    trainingReady: false,
  };
});

const originalItems = seed.items.map((item) => {
  const validation = validateArtesDetectorLabel(item.detectorLabel);
  if (!validation.valid) throw new Error(`combined_seed_invalid_original_label:${item.sourceFileName}:${validation.errors.join(',')}`);
  const embedding = item.embedding;
  if (!embedding || embedding.model !== EXPECTED_MODEL || embedding.dimension !== EXPECTED_DIMENSION || !Array.isArray(embedding.vector) || embedding.vector.length !== EXPECTED_DIMENSION || !embedding.vector.every(Number.isFinite)) {
    throw new Error(`combined_seed_invalid_original_embedding:${item.sourceFileName}`);
  }
  return {
    ...item,
    sourceDataset: 'external-poc',
    sourcePoolId: requireSourcePoolId(originalManifestById, item.sourceFileName),
    metadataSuggestionOverridden: false,
    trainingReady: false,
    semanticClusterId: null,
    datasetSplit: null,
  };
});

const items = [...originalItems, ...expansionItems];
const fingerprintSet = new Set();
for (const item of items) {
  if (!item.sourceSha256 || fingerprintSet.has(item.sourceSha256)) throw new Error('combined_seed_duplicate_or_missing_sha256');
  fingerprintSet.add(item.sourceSha256);
}

const nudityCounts = countBy(NUDITY_VALUES);
const sexualContextCounts = countBy(SEXUAL_CONTEXT_VALUES);
const graphicInjuryCounts = countBy(GRAPHIC_INJURY_VALUES);
const sensitiveSignalCounts = countBy(SENSITIVE_SIGNALS);
const sourcePoolCounts = {};
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
}

const missing = {
  nudity: NUDITY_VALUES.filter((value) => nudityCounts[value] === 0),
  sexualContext: SEXUAL_CONTEXT_VALUES.filter((value) => sexualContextCounts[value] === 0),
  graphicInjury: GRAPHIC_INJURY_VALUES.filter((value) => graphicInjuryCounts[value] === 0),
  sensitiveSignals: SENSITIVE_SIGNALS.filter((value) => sensitiveSignalCounts[value] === 0),
  possibleMinorConcernTrue: possibleMinorConcernTrue === 0,
};

const combinedSeed = {
  schemaVersion: 1,
  seedVersion: 'combined_external_seed_v1',
  status: 'validated_human_labeled_poc_seed',
  sourceSeedVersions: ['external_poc_seed_v1', 'external_expansion_v1'],
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
  counts: {
    nudity: nudityCounts,
    sexualContext: sexualContextCounts,
    graphicInjury: graphicInjuryCounts,
    sensitiveSignals: sensitiveSignalCounts,
    possibleMinorConcern: { true: possibleMinorConcernTrue, false: possibleMinorConcernFalse },
  },
  missing,
  classifierTrainingRecommended: false,
  reason: 'combined_seed_is_valid_but_still_too_small_and_category_coverage_is_incomplete',
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(combinedSeed, null, 2)}\n`, 'utf8');
await writeFile(COVERAGE_PATH, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  seedVersion: combinedSeed.seedVersion,
  itemCount: combinedSeed.itemCount,
  humanConfirmed: coverage.humanConfirmed,
  embeddingModel: combinedSeed.embeddingModel,
  embeddingDimension: combinedSeed.embeddingDimension,
  metadataSuggestionOverrides: coverage.metadataSuggestionOverrides,
  sourcePoolCount: coverage.sourcePoolCount,
  sourcePoolCounts: coverage.sourcePoolCounts,
  counts: coverage.counts,
  missing: coverage.missing,
  sourcePoolLeakageGuardRequired: true,
  trainingReady: false,
  classifierTrainingRecommended: false,
  outputs: [
    '.tmp/moderation-test-set/combined-external-v1/seed-v1.json',
    '.tmp/moderation-test-set/combined-external-v1/coverage-v1.json',
  ],
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
