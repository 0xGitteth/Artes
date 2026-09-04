import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArtesDetectorLabel, validateArtesDetectorLabel } from '../functions/moderationLearningDataset.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-intake');
const EMBEDDING_PATH = path.join(BASE_DIR, 'embedding-intake.json');
const LABELS_PATH = path.join(BASE_DIR, 'labels.reviewed.json');
const OUTPUT_PATH = path.join(BASE_DIR, 'reviewed-candidates.json');
const EXPECTED_PROVIDER = 'artes_custom_vision';
const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;

const fail = (code, fileName = null) => {
  throw new Error(fileName ? `${code}:${fileName}` : code);
};

const [embeddingIntake, reviewed] = await Promise.all([
  readFile(EMBEDDING_PATH, 'utf8').then(JSON.parse),
  readFile(LABELS_PATH, 'utf8').then(JSON.parse),
]);

if (embeddingIntake?.intakeType !== 'contributor_authorized_moderation_embeddings') fail('invalid_contributor_embedding_intake');
if (embeddingIntake?.authorizationConfirmed !== true || embeddingIntake?.trainingReady === true) fail('invalid_contributor_embedding_authorization_state');
if (embeddingIntake?.embeddingProvider !== EXPECTED_PROVIDER || embeddingIntake?.embeddingModel !== EXPECTED_MODEL || embeddingIntake?.embeddingDimension !== EXPECTED_DIMENSION) {
  fail('invalid_contributor_embedding_contract');
}
if (reviewed?.reviewType !== 'contributor_authorized_local_human_review') fail('invalid_contributor_review_type');
if (reviewed?.labelStatus !== 'complete') fail('contributor_labels_not_complete');
if (reviewed?.trainingReady === true || reviewed?.semanticClusterApproved === true) fail('contributor_review_must_remain_unpromoted');

const embeddingItems = Array.isArray(embeddingIntake?.items) ? embeddingIntake.items : [];
const labelItems = Array.isArray(reviewed?.items) ? reviewed.items : [];
if (embeddingItems.length === 0 || embeddingItems.length !== labelItems.length) fail('contributor_review_count_mismatch');

const labelByFile = new Map();
for (const labelItem of labelItems) {
  const fileName = String(labelItem?.fileName || '').trim();
  if (!fileName || labelByFile.has(fileName)) fail('duplicate_or_missing_contributor_label');
  labelByFile.set(fileName, labelItem);
}

const outputItems = embeddingItems.map((item) => {
  const fileName = String(item?.fileName || '').trim();
  const labelItem = labelByFile.get(fileName);
  if (!labelItem) fail('missing_contributor_label', fileName);
  if (!item?.sha256 || labelItem.sha256 !== item.sha256) fail('contributor_label_sha_mismatch', fileName);
  if (!item?.sourcePoolId || labelItem.sourcePoolId !== item.sourcePoolId) fail('contributor_source_pool_mismatch', fileName);
  if (item?.authorization?.rightsHolderConfirmed !== true || item?.authorization?.moderationMlUseAuthorized !== true) fail('contributor_authorization_missing', fileName);
  if (labelItem?.authorization?.rightsHolderConfirmed !== true || labelItem?.authorization?.moderationMlUseAuthorized !== true) fail('contributor_review_authorization_missing', fileName);
  if (labelItem.labelStatus !== 'human_confirmed' || labelItem.labelSource !== 'local_human_review') fail('contributor_label_not_human_confirmed', fileName);

  const validation = validateArtesDetectorLabel(labelItem.detectorLabel);
  if (!validation.valid) fail(`invalid_contributor_detector_label:${validation.errors.join(',')}`, fileName);

  const embedding = item.embedding;
  if (
    embedding?.provider !== EXPECTED_PROVIDER
    || embedding?.model !== EXPECTED_MODEL
    || embedding?.dimension !== EXPECTED_DIMENSION
    || !Array.isArray(embedding?.vector)
    || embedding.vector.length !== EXPECTED_DIMENSION
    || !embedding.vector.every(Number.isFinite)
  ) {
    fail('invalid_contributor_embedding', fileName);
  }

  return {
    fileName,
    sha256: item.sha256,
    byteLength: item.byteLength,
    sourcePoolId: item.sourcePoolId,
    authorization: item.authorization,
    detectorLabel: normalizeArtesDetectorLabel(labelItem.detectorLabel),
    labelStatus: 'human_confirmed',
    labelSource: 'local_human_review',
    embedding: {
      provider: EXPECTED_PROVIDER,
      model: EXPECTED_MODEL,
      dimension: EXPECTED_DIMENSION,
      vector: embedding.vector,
    },
    semanticClusterId: null,
    semanticClusterApproved: false,
    benchmarkOnly: false,
    trainingReady: false,
  };
});

const output = {
  schemaVersion: 1,
  candidateType: 'contributor_authorized_reviewed_moderation_candidates',
  itemCount: outputItems.length,
  humanConfirmed: outputItems.length,
  sourcePoolCount: new Set(outputItems.map((item) => item.sourcePoolId)).size,
  authorizationPreserved: true,
  embeddingProvider: EXPECTED_PROVIDER,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  semanticClusterApproved: false,
  trainingReady: false,
  nextRequiredStep: 'explicit_semantic_cluster_review_and_dataset_promotion',
  items: outputItems,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  ok: true,
  itemCount: output.itemCount,
  humanConfirmed: output.humanConfirmed,
  sourcePoolCount: output.sourcePoolCount,
  authorizationPreserved: output.authorizationPreserved,
  embeddingProvider: output.embeddingProvider,
  embeddingModel: output.embeddingModel,
  embeddingDimension: output.embeddingDimension,
  semanticClusterApproved: false,
  trainingReady: false,
  nextRequiredStep: output.nextRequiredStep,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
