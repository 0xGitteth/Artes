import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createModerationCustomVisionClient } from '../functions/moderationCustomVisionClient.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const IMAGE_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-images');
const INTAKE_PATH = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-intake', 'intake.json');
const OUTPUT_PATH = path.join(REPO_ROOT, '.tmp', 'moderation-contributor-intake', 'embedding-intake.json');
const ENDPOINT = String(process.env.ARTES_CUSTOM_VISION_URL || 'http://127.0.0.1:8787').trim();
const TIMEOUT_MS = Number(process.env.ARTES_CUSTOM_VISION_TIMEOUT_MS || 300000);
const EXPECTED_PROVIDER = 'artes_custom_vision';
const EXPECTED_MODEL = 'dinov2_vitb14';
const EXPECTED_DIMENSION = 768;
const MIME_BY_EXT = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const fail = (code, fileName = null) => {
  throw new Error(fileName ? `${code}:${fileName}` : code);
};

if (!process.argv.includes('--confirm-authorized')) {
  fail('explicit_authorization_confirmation_required');
}

let endpointUrl;
try {
  endpointUrl = new URL(ENDPOINT);
} catch {
  fail('invalid_contributor_embedding_endpoint');
}
if (!LOOPBACK_HOSTS.has(endpointUrl.hostname)) fail('contributor_embedding_endpoint_must_be_loopback');

const intake = JSON.parse(await readFile(INTAKE_PATH, 'utf8'));
if (intake?.intakeType !== 'contributor_authorized_moderation_images') fail('invalid_contributor_intake_type');
if (intake?.authorizationConfirmed !== true) fail('contributor_authorization_not_confirmed');
if (intake?.trainingReady === true) fail('contributor_intake_must_not_be_training_ready');
if (!Array.isArray(intake?.items) || intake.items.length === 0) fail('contributor_intake_empty');

const client = createModerationCustomVisionClient({ endpoint: ENDPOINT, timeoutMs: TIMEOUT_MS });
const outputItems = [];
for (const item of intake.items) {
  const fileName = String(item?.fileName || '').trim();
  if (!fileName || path.basename(fileName) !== fileName) fail('invalid_contributor_filename');
  if (!item?.sourcePoolId) fail('missing_source_pool_id', fileName);
  if (item?.authorization?.rightsHolderConfirmed !== true || item?.authorization?.moderationMlUseAuthorized !== true) {
    fail('authorization_not_preserved', fileName);
  }
  const mimeType = MIME_BY_EXT.get(path.extname(fileName).toLowerCase());
  if (!mimeType) fail('unsupported_contributor_image_type', fileName);
  const buffer = await readFile(path.join(IMAGE_DIR, fileName));
  if (sha256(buffer) !== item.sha256) fail('contributor_image_sha_mismatch', fileName);

  const inference = await client.infer({ buffer, mimeType });
  const vector = inference?.embedding;
  if (
    inference?.provider !== EXPECTED_PROVIDER
    || inference?.model !== EXPECTED_MODEL
    || inference?.embeddingDimension !== EXPECTED_DIMENSION
    || !Array.isArray(vector)
    || vector.length !== EXPECTED_DIMENSION
    || !vector.every(Number.isFinite)
  ) {
    fail('invalid_contributor_embedding', fileName);
  }

  outputItems.push({
    fileName,
    sha256: item.sha256,
    byteLength: item.byteLength,
    sourcePoolId: item.sourcePoolId,
    authorization: item.authorization,
    embedding: {
      provider: EXPECTED_PROVIDER,
      model: EXPECTED_MODEL,
      dimension: EXPECTED_DIMENSION,
      vector,
    },
    detectorLabel: null,
    labelStatus: 'pending_human_review',
    semanticClusterId: null,
    semanticClusterApproved: false,
    benchmarkOnly: false,
    trainingReady: false,
  });
}

const output = {
  schemaVersion: 1,
  intakeType: 'contributor_authorized_moderation_embeddings',
  sourceIntakeType: intake.intakeType,
  itemCount: outputItems.length,
  authorizationConfirmed: true,
  embeddingProvider: EXPECTED_PROVIDER,
  embeddingModel: EXPECTED_MODEL,
  embeddingDimension: EXPECTED_DIMENSION,
  sourcePoolRequired: true,
  imagesCopied: false,
  networkScope: 'loopback_custom_vision_only',
  detectorLabelsInferred: false,
  trainingReady: false,
  items: outputItems,
};
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  itemCount: output.itemCount,
  sourcePoolCount: new Set(outputItems.map((item) => item.sourcePoolId)).size,
  embeddingProvider: output.embeddingProvider,
  embeddingModel: output.embeddingModel,
  embeddingDimension: output.embeddingDimension,
  labelsReady: 0,
  trainingReady: false,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  fullEmbeddingsPrinted: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
