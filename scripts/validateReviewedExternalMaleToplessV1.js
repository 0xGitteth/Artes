import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtesDetectorLabel, normalizeArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DATASET = 'external-male-topless-v1';
const BASE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', DATASET);
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', DATASET);
const INTAKE_PATH = path.join(BASE_DIR, 'intake.json');
const LABELS_PATH = path.join(BASE_DIR, 'labels.reviewed.json');
const SOURCES_PATH = path.join(IMAGE_DIR, 'sources.json');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'moderation-external-male-topless-poc-v1.json');
const OUTPUT_PATH = path.join(BASE_DIR, 'reviewed-analysis.json');

const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;
const sourceIdFromFileName = (fileName) => String(fileName || '').replace(/\.(?:jpe?g|png|webp)$/i, '');

const [intake, labels, sources, manifest] = await Promise.all([
  readFile(INTAKE_PATH, 'utf8').then(JSON.parse),
  readFile(LABELS_PATH, 'utf8').then(JSON.parse),
  readFile(SOURCES_PATH, 'utf8').then(JSON.parse),
  readFile(MANIFEST_PATH, 'utf8').then(JSON.parse),
]);

const intakeItems = Array.isArray(intake?.items) ? intake.items : [];
const labelItems = Array.isArray(labels?.items) ? labels.items : [];
const sourceRecords = Array.isArray(sources?.records) ? sources.records : [];
const manifestEntries = Array.isArray(manifest?.entries) ? manifest.entries : [];

if (intakeItems.length !== 1 || labelItems.length !== 1 || manifestEntries.length !== 1) {
  throw new Error('male_topless_v1_expected_exactly_one_item');
}
if (labels?.labelStatus !== 'complete') throw new Error(`reviewed_labels_not_complete:${labels?.labelStatus || 'missing'}`);
if (labels?.trainingReady === true || intake?.trainingReady === true || manifest?.trainingReady === true) {
  throw new Error('male_topless_v1_must_not_be_training_ready');
}

const intakeItem = intakeItems[0];
const labelItem = labelItems[0];
const source = sourceRecords.find((record) => record.fileName === intakeItem.fileName);
const manifestEntry = manifestEntries.find((entry) => entry.id === sourceIdFromFileName(intakeItem.fileName));
if (!source || !manifestEntry) throw new Error('male_topless_v1_missing_source_metadata');
if (labelItem.fileName !== intakeItem.fileName || labelItem.sha256 !== intakeItem.sha256 || source.sha256 !== intakeItem.sha256) {
  throw new Error('male_topless_v1_hash_or_file_mismatch');
}
if (labelItem.labelStatus !== 'human_confirmed' || labelItem.labelSource !== 'local_human_review') {
  throw new Error('male_topless_v1_label_not_human_confirmed');
}

const validation = validateArtesDetectorLabel(labelItem.detectorLabel);
if (!validation.valid) throw new Error(`invalid_reviewed_detector_label:${validation.errors.join(',')}`);
const detectorLabel = normalizeArtesDetectorLabel(labelItem.detectorLabel);
const embedding = intakeItem.embedding;
if (!embedding || embedding.model !== EXPECTED_MODEL || embedding.dimension !== EXPECTED_DIMENSION || !Array.isArray(embedding.vector) || embedding.vector.length !== EXPECTED_DIMENSION || !embedding.vector.every(Number.isFinite)) {
  throw new Error('male_topless_v1_invalid_embedding');
}

const sourcePoolId = String(manifestEntry.sourcePoolId || '').trim();
if (!sourcePoolId) throw new Error('male_topless_v1_missing_source_pool');
const suggested = { nudity: 'male_topless', sexualContext: 'none' };
const metadataSuggestionOverrideFields = [];
if (detectorLabel.nudity !== suggested.nudity) metadataSuggestionOverrideFields.push('nudity');
if (detectorLabel.sexualContext !== suggested.sexualContext) metadataSuggestionOverrideFields.push('sexualContext');

const output = {
  schemaVersion: 1,
  analysisType: 'external_male_topless_v1_human_label_validation',
  dataset: DATASET,
  labelVersion: labels.labelVersion,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  itemCount: 1,
  humanConfirmedLabelCount: 1,
  labelsComplete: true,
  sourcePoolCount: 1,
  thresholdSelected: false,
  semanticClusterPromoted: false,
  trainingReady: false,
  item: {
    fileName: intakeItem.fileName,
    sha256: intakeItem.sha256,
    sourcePoolId,
    sourceFacet: source.visualFacet || manifestEntry.visualFacet || null,
    detectorLabel,
    humanConfirmed: true,
    humanOverrodeMetadataSuggestion: metadataSuggestionOverrideFields.length > 0,
    metadataSuggestionOverrideFields,
    trainingReady: false,
  },
  fullEmbeddingsIncluded: false,
  imageBytesIncluded: false,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  dataset: DATASET,
  itemCount: 1,
  humanConfirmedLabelCount: 1,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  sourcePoolId,
  detectorLabel,
  humanOverrodeMetadataSuggestion: output.item.humanOverrodeMetadataSuggestion,
  metadataSuggestionOverrideFields,
  trainingReady: false,
  thresholdSelected: false,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
