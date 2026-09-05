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

const endpoint = assertLoopbackEndpoint(ENDPOINT);
const client = createModerationCustomVisionClient({ endpoint, timeoutMs: TIMEOUT_MS });
const items = [];
const labels = [];
for (const source of sources.records) {
  const fileName = clean(source?.fileName);
  if (!fileName || path.basename(fileName) !== fileName) throw new Error('invalid_web_research_filename');
  if (!clean(source?.sourcePoolId)) throw new Error(`missing_web_research_source_pool:${fileName}`);
  if (source?.researchOnly !== true || source?.trainingReady !== false || source?.productionEligible !== false) {
    throw new Error(`web_research_source_not_research_only:${fileName}`);
  }
  const mimeType = MIME_BY_EXT.get(path.extname(fileName).toLowerCase());
  if (!mimeType) throw new Error(`unsupported_web_research_image_type:${fileName}`);
  const buffer = await readFile(path.join(IMAGE_DIR, fileName));
  if (sha256(buffer) !== source.sha256) throw new Error(`web_research_image_sha_mismatch:${fileName}`);
  const inference = await client.infer({ buffer, mimeType });
  if (inference?.model !== EXPECTED_MODEL || inference?.embeddingDimension !== EXPECTED_DIMENSION || !Array.isArray(inference?.embedding) || inference.embedding.length !== EXPECTED_DIMENSION || !inference.embedding.every(Number.isFinite)) {
    throw new Error(`invalid_web_research_embedding:${fileName}`);
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
  labels.push({
    fileName,
    sha256: source.sha256,
    sourcePoolId: source.sourcePoolId,
    ageSafetyDecision: null,
    detectorLabel: null,
    labelStatus: 'pending_human_review',
  });
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(path.join(OUTPUT_DIR, 'intake.json'), `${JSON.stringify({
  schemaVersion: 1,
  sourceType: 'public_web_research_images',
  datasetSubdir: DATASET_SUBDIR,
  itemCount: items.length,
  sourcePoolCount: new Set(items.map((item) => item.sourcePoolId)).size,
  ageSafetyReviewRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  items,
}, null, 2)}\n`, 'utf8');
await writeFile(path.join(OUTPUT_DIR, 'labels.template.json'), `${JSON.stringify({
  schemaVersion: 1,
  datasetSubdir: DATASET_SUBDIR,
  labelStatus: 'pending_human_review',
  itemCount: labels.length,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  items: labels,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  datasetSubdir: DATASET_SUBDIR,
  itemCount: items.length,
  sourcePoolCount: new Set(items.map((item) => item.sourcePoolId)).size,
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
