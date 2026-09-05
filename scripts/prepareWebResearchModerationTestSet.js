import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModerationCustomVisionClient } from '../functions/moderationCustomVisionClient.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DATASET_SUBDIR = 'web-research-v1';
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', DATASET_SUBDIR);
const SOURCES_PATH = path.join(IMAGE_DIR, 'sources.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-set', DATASET_SUBDIR);
const INTAKE_PATH = path.join(OUTPUT_DIR, 'intake.json');
const LABELS_PATH = path.join(OUTPUT_DIR, 'labels.template.json');
const ENDPOINT = String(process.env.ARTES_CUSTOM_VISION_URL || 'http://127.0.0.1:8787').trim();
const TIMEOUT_MS = Number(process.env.ARTES_CUSTOM_VISION_TIMEOUT_MS || 300000);
const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;
const MIME_BY_EXT = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

const clean = (value) => String(value || '').trim();
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 160);
const assertLoopbackEndpoint = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('web_research_vision_endpoint_must_be_loopback');
  }
  return url.toString().replace(/\/$/, '');
};

const sources = JSON.parse(await readFile(SOURCES_PATH, 'utf8'));
if (sources?.researchOnly !== true || sources?.trainingReady !== false || sources?.productionEligible !== false) {
  throw new Error('invalid_web_research_sources_contract');
}
if (!Array.isArray(sources?.records) || sources.records.length === 0) throw new Error('web_research_sources_empty');

await mkdir(OUTPUT_DIR, { recursive: true });
let previous = { items: [] };
try {
  previous = JSON.parse(await readFile(INTAKE_PATH, 'utf8'));
} catch {
  // First run or intentionally cleared local output.
}
const previousBySha = new Map((Array.isArray(previous?.items) ? previous.items : []).map((item) => [item.sha256, item]));
const endpoint = assertLoopbackEndpoint(ENDPOINT);
const client = createModerationCustomVisionClient({ endpoint, timeoutMs: TIMEOUT_MS });
const items = [];
const failures = [];
let reusedCount = 0;
let embeddedCount = 0;

const validReusableItem = (item, source) => (
  item?.sha256 === source?.sha256
  && item?.sourcePoolId === source?.sourcePoolId
  && item?.embedding?.model === EXPECTED_MODEL
  && item?.embedding?.dimension === EXPECTED_DIMENSION
  && Array.isArray(item?.embedding?.vector)
  && item.embedding.vector.length === EXPECTED_DIMENSION
  && item.embedding.vector.every(Number.isFinite)
  && item?.researchOnly === true
  && item?.trainingReady === false
  && item?.productionEligible === false
);

const buildLabelTemplates = () => items.map((item) => ({
  fileName: item.fileName,
  sha256: item.sha256,
  sourcePoolId: item.sourcePoolId,
  ageSafetyDecision: null,
  detectorLabel: null,
  labelStatus: 'pending_human_review',
}));

const persistPartial = async () => {
  const sourcePoolCount = new Set(items.map((item) => item.sourcePoolId)).size;
  const labels = buildLabelTemplates();
  await writeFile(INTAKE_PATH, `${JSON.stringify({
    schemaVersion: 1,
    sourceType: 'public_web_research_images',
    datasetSubdir: DATASET_SUBDIR,
    requestedItemCount: sources.records.length,
    itemCount: items.length,
    failedItemCount: failures.length,
    sourcePoolCount,
    ageSafetyReviewRequired: true,
    researchOnly: true,
    trainingReady: false,
    productionEligible: false,
    items,
    failures,
  }, null, 2)}\n`, 'utf8');
  await writeFile(LABELS_PATH, `${JSON.stringify({
    schemaVersion: 1,
    datasetSubdir: DATASET_SUBDIR,
    labelStatus: 'pending_human_review',
    itemCount: labels.length,
    researchOnly: true,
    trainingReady: false,
    productionEligible: false,
    items: labels,
  }, null, 2)}\n`, 'utf8');
};

for (const source of sources.records) {
  const fileName = clean(source?.fileName);
  try {
    if (!fileName || path.basename(fileName) !== fileName) throw new Error('invalid_web_research_filename');
    if (!clean(source?.sourcePoolId)) throw new Error('missing_web_research_source_pool');
    if (source?.researchOnly !== true || source?.trainingReady !== false || source?.productionEligible !== false) {
      throw new Error('web_research_source_not_research_only');
    }
    const reusable = previousBySha.get(source.sha256);
    if (validReusableItem(reusable, source)) {
      items.push(reusable);
      reusedCount += 1;
      await persistPartial();
      process.stdout.write(`Reused research embedding ${fileName}\n`);
      continue;
    }
    const mimeType = MIME_BY_EXT.get(path.extname(fileName).toLowerCase());
    if (!mimeType) throw new Error('unsupported_web_research_image_type');
    const buffer = await readFile(path.join(IMAGE_DIR, fileName));
    if (sha256(buffer) !== source.sha256) throw new Error('web_research_image_sha_mismatch');
    const inference = await client.infer({ buffer, mimeType });
    if (inference?.model !== EXPECTED_MODEL || inference?.embeddingDimension !== EXPECTED_DIMENSION || !Array.isArray(inference?.embedding) || inference.embedding.length !== EXPECTED_DIMENSION || !inference.embedding.every(Number.isFinite)) {
      throw new Error('invalid_web_research_embedding');
    }
    items.push({
      fileName,
      sha256: source.sha256,
      sourcePoolId: source.sourcePoolId,
      sourceUrl: source.sourceUrl,
      rightsStatus: source.rightsStatus,
      ageStatus: source.ageStatus,
      humanAgeSafetyReviewRequired: true,
      labelStatus: 'pending_human_review',
      detectorLabel: null,
      embedding: {
        provider: inference.provider,
        model: inference.model,
        dimension: inference.embeddingDimension,
        vector: inference.embedding,
      },
      semanticClusterId: null,
      semanticClusterApproved: false,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    embeddedCount += 1;
    await persistPartial();
    process.stdout.write(`Embedded research image ${fileName}\n`);
  } catch (error) {
    failures.push({ fileName: fileName || null, sha256: source?.sha256 || null, error: safeError(error) });
    await persistPartial();
    process.stdout.write(`Skipped research embedding ${fileName || '(invalid file)'}: ${safeError(error)}\n`);
  }
}

if (items.length === 0) throw new Error('web_research_embedding_no_items');
const sourcePoolCount = new Set(items.map((item) => item.sourcePoolId)).size;
const meaningfulReviewBatch = items.length >= 5 && sourcePoolCount >= 2;
await persistPartial();

process.stdout.write(`${JSON.stringify({
  ok: true,
  datasetSubdir: DATASET_SUBDIR,
  requestedItemCount: sources.records.length,
  itemCount: items.length,
  failedItemCount: failures.length,
  reusedCount,
  embeddedCount,
  sourcePoolCount,
  meaningfulReviewBatch,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  labelsReady: 0,
  ageSafetyReviewRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  outputs: ['intake.json', 'labels.template.json'],
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
