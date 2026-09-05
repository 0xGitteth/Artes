import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DATASET_SUBDIR = 'web-research-v1';
const TEST_SET_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', DATASET_SUBDIR);
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', DATASET_SUBDIR);
const INTAKE_PATH = path.join(TEST_SET_DIR, 'intake.json');
const LABELS_PATH = path.join(TEST_SET_DIR, 'labels.reviewed.json');
const SOURCES_PATH = path.join(IMAGE_DIR, 'sources.json');
const OUTPUT_PATH = path.join(TEST_SET_DIR, 'research-dataset.json');
const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;
const NUDITY_VALUES = ['none', 'underwear_swimwear', 'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia', 'male_topless'];

const [intake, labels, sources] = await Promise.all([
  readFile(INTAKE_PATH, 'utf8').then(JSON.parse),
  readFile(LABELS_PATH, 'utf8').then(JSON.parse),
  readFile(SOURCES_PATH, 'utf8').then(JSON.parse),
]);

if (intake?.researchOnly !== true || intake?.trainingReady !== false || intake?.productionEligible !== false) {
  throw new Error('invalid_web_research_intake_contract');
}
if (sources?.researchOnly !== true || sources?.trainingReady !== false || sources?.productionEligible !== false) {
  throw new Error('invalid_web_research_sources_contract');
}
if (labels?.reviewType !== 'public_web_research_local_human_review') throw new Error('invalid_web_research_review_type');
if (labels?.reviewStatus !== 'complete') throw new Error(`web_research_review_not_complete:${labels?.reviewStatus || 'missing'}`);
if (labels?.researchOnly !== true || labels?.trainingReady !== false || labels?.productionEligible !== false || labels?.runtimeEligible !== false) {
  throw new Error('unsafe_web_research_review_contract');
}
if (labels?.discoveryMetadataIsLabelAuthority !== false) throw new Error('discovery_metadata_must_not_be_label_authority');

const intakeItems = Array.isArray(intake?.items) ? intake.items : [];
const reviewedItems = Array.isArray(labels?.items) ? labels.items : [];
const sourceRecords = Array.isArray(sources?.records) ? sources.records : [];
if (intakeItems.length === 0) throw new Error('web_research_intake_empty');
if (reviewedItems.length !== intakeItems.length) throw new Error('web_research_review_count_mismatch');

const intakeByFile = new Map(intakeItems.map((item) => [item.fileName, item]));
const sourceByFile = new Map(sourceRecords.map((item) => [item.fileName, item]));
const reviewedByFile = new Map();

const validateEmbedding = (item) => {
  const embedding = item?.embedding;
  if (embedding?.model !== EXPECTED_MODEL || embedding?.dimension !== EXPECTED_DIMENSION) {
    throw new Error(`invalid_web_research_embedding_metadata:${item?.fileName || 'unknown'}`);
  }
  if (!Array.isArray(embedding?.vector) || embedding.vector.length !== EXPECTED_DIMENSION || !embedding.vector.every(Number.isFinite)) {
    throw new Error(`invalid_web_research_embedding_vector:${item?.fileName || 'unknown'}`);
  }
};

for (const reviewed of reviewedItems) {
  const fileName = String(reviewed?.fileName || '').trim();
  if (!fileName || reviewedByFile.has(fileName)) throw new Error('duplicate_or_missing_web_research_review_file');
  const intakeItem = intakeByFile.get(fileName);
  const source = sourceByFile.get(fileName);
  if (!intakeItem || !source) throw new Error(`web_research_review_unknown_file:${fileName}`);
  if (reviewed.sha256 !== intakeItem.sha256 || reviewed.sha256 !== source.sha256) throw new Error(`web_research_review_sha_mismatch:${fileName}`);
  if (reviewed.sourcePoolId !== intakeItem.sourcePoolId || reviewed.sourcePoolId !== source.sourcePoolId) throw new Error(`web_research_review_source_pool_mismatch:${fileName}`);
  if (reviewed.sourceUrl !== source.sourceUrl) throw new Error(`web_research_review_source_url_mismatch:${fileName}`);
  if (reviewed.discoveryFacet !== (source.visualFacet || null)) throw new Error(`web_research_review_discovery_facet_mismatch:${fileName}`);
  if (reviewed.semanticClusterApproved !== false || reviewed.trainingReady !== false || reviewed.productionEligible !== false || reviewed.runtimeEligible !== false || reviewed.researchOnly !== true) {
    throw new Error(`unsafe_web_research_review_item:${fileName}`);
  }
  validateEmbedding(intakeItem);

  if (reviewed.ageSafetyDecision === 'adult_clear') {
    if (reviewed.labelStatus !== 'human_confirmed' || reviewed.labelSource !== 'local_human_review') {
      throw new Error(`web_research_label_not_human_confirmed:${fileName}`);
    }
    const validation = validateArtesDetectorLabel(reviewed.detectorLabel);
    if (!validation.valid) throw new Error(`invalid_web_research_detector_label:${fileName}:${validation.errors.join(',')}`);
    if (reviewed.detectorLabel.possibleMinorConcern !== false) throw new Error(`web_research_possible_minor_not_excluded:${fileName}`);
  } else if (reviewed.ageSafetyDecision === 'skip_minor_or_age_uncertain') {
    if (reviewed.labelStatus !== 'excluded_age_safety' || reviewed.detectorLabel !== null) {
      throw new Error(`invalid_web_research_age_exclusion:${fileName}`);
    }
  } else {
    throw new Error(`missing_web_research_age_decision:${fileName}`);
  }
  reviewedByFile.set(fileName, reviewed);
}

for (const intakeItem of intakeItems) {
  if (!reviewedByFile.has(intakeItem.fileName)) throw new Error(`missing_web_research_review:${intakeItem.fileName}`);
}

const researchItems = [];
const excludedItems = [];
for (const intakeItem of intakeItems) {
  const reviewed = reviewedByFile.get(intakeItem.fileName);
  const source = sourceByFile.get(intakeItem.fileName);
  if (reviewed.labelStatus === 'excluded_age_safety') {
    excludedItems.push({
      fileName: intakeItem.fileName,
      sha256: intakeItem.sha256,
      sourcePoolId: intakeItem.sourcePoolId,
      sourceUrl: source.sourceUrl,
      discoveryFacet: source.visualFacet || null,
      exclusionReason: 'minor_or_age_uncertain',
    });
    continue;
  }
  researchItems.push({
    fileName: intakeItem.fileName,
    sha256: intakeItem.sha256,
    sourcePoolId: intakeItem.sourcePoolId,
    sourceUrl: source.sourceUrl,
    rightsStatus: source.rightsStatus,
    discoveryFacet: source.visualFacet || null,
    detectorLabel: reviewed.detectorLabel,
    humanConfirmed: true,
    ageSafetyDecision: 'adult_clear',
    embedding: intakeItem.embedding,
    semanticClusterId: null,
    semanticClusterApproved: false,
    researchOnly: true,
    trainingReady: false,
    productionEligible: false,
    runtimeEligible: false,
  });
}

const nudityCounts = Object.fromEntries(NUDITY_VALUES.map((value) => [value, 0]));
for (const item of researchItems) nudityCounts[item.detectorLabel.nudity] += 1;
const sourcePoolCount = new Set(researchItems.map((item) => item.sourcePoolId)).size;

const output = {
  schemaVersion: 1,
  datasetVersion: 'web_research_v1_human_reviewed',
  datasetRole: 'offline_research_probe_only',
  performanceInterpretation: 'research_only_not_production_ready',
  labelVersion: labels.labelVersion,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  requestedItemCount: intakeItems.length,
  researchItemCount: researchItems.length,
  ageSafetyExcludedCount: excludedItems.length,
  sourcePoolCount,
  nudityCounts,
  humanLabelsAuthoritative: true,
  discoveryMetadataIsLabelAuthority: false,
  dinoSimilarityIsLabelAuthority: false,
  thresholdSelected: false,
  semanticClustersApproved: false,
  benchmarkDataset: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  runtimeEligible: false,
  items: researchItems,
  excludedItems,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: true,
  datasetVersion: output.datasetVersion,
  datasetRole: output.datasetRole,
  requestedItemCount: output.requestedItemCount,
  researchItemCount: output.researchItemCount,
  ageSafetyExcludedCount: output.ageSafetyExcludedCount,
  sourcePoolCount: output.sourcePoolCount,
  nudityCounts: output.nudityCounts,
  humanLabelsAuthoritative: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  runtimeEligible: false,
  thresholdSelected: false,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
