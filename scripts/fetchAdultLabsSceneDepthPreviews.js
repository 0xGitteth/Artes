import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const INPUT_PATH = path.join(ROOT, 'adultlabs-scene-depth-preview-refs.json');
const FIRST_BATCH_PATH = path.join(ROOT, 'balanced-target-scene-preview-screening.json');
const PREVIEW_DIR = path.join(ROOT, 'adultlabs-scene-depth-previews');
const OUTPUT_PATH = path.join(ROOT, 'adultlabs-scene-depth-preview-screening.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const EXPECTED_REF_COUNT = 63;
const EXPECTED_POOL_COUNT = 21;

const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 260);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const sniffSupportedImage = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return { mimeType: 'image/png', extension: '.png' };
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return { mimeType: 'image/webp', extension: '.webp' };
  return null;
};

const assertAdultLabsPixboostSample = (rawUrl, expectedSetId = null) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'pixboost.com') {
    throw new Error('adultlabs_scene_depth_asset_host_not_allowed');
  }
  const match = url.pathname.match(/^\/api\/2\/img\/samples\/(\d+)\/cs\/[^/]+\.(?:jpe?g|png|webp)\/optimise$/i);
  if (!match) throw new Error('adultlabs_scene_depth_asset_shape_not_allowed');
  if (expectedSetId !== null && String(match[1]) !== String(expectedSetId)) {
    throw new Error('adultlabs_scene_depth_asset_set_mismatch');
  }
  return url;
};

const downloadPreview = async (rawUrl, setId) => {
  const requested = assertAdultLabsPixboostSample(rawUrl, setId);
  const response = await fetch(requested, {
    headers: {
      Accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1',
      'User-Agent': USER_AGENT,
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`adultlabs_scene_depth_http_${response.status}`);
  const resolved = assertAdultLabsPixboostSample(response.url, setId);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PREVIEW_BYTES) throw new Error(`adultlabs_scene_depth_declared_too_large:${declaredLength}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_PREVIEW_BYTES) throw new Error(`adultlabs_scene_depth_size_invalid:${buffer.length}`);

  const headerMimeType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
  const headerExtension = ALLOWED_MIME_TYPES.get(headerMimeType) || null;
  const sniffed = sniffSupportedImage(buffer);
  let mimeType = headerMimeType;
  let extension = headerExtension;
  let mimeResolution = 'response_header';
  if (!extension && headerMimeType === 'application/octet-stream' && sniffed) {
    mimeType = sniffed.mimeType;
    extension = sniffed.extension;
    mimeResolution = 'magic_bytes_from_octet_stream';
  }
  if (!extension) throw new Error(`adultlabs_scene_depth_unsupported_mime:${headerMimeType || 'missing'}`);
  return { buffer, mimeType, extension, mimeResolution, resolvedUrl: resolved.toString() };
};

const discovery = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
if (
  discovery?.status !== 'research_adultlabs_scene_depth_preview_refs_only'
  || discovery?.poolCount !== EXPECTED_POOL_COUNT
  || discovery?.processedPoolCount !== EXPECTED_POOL_COUNT
  || discovery?.failedPoolCount !== 0
  || discovery?.selectedRefCount !== EXPECTED_REF_COUNT
  || discovery?.overlapWithFirstThreeBatchCount !== 0
  || discovery?.imageBytesDownloaded !== false
  || discovery?.authenticationUsed !== false
  || discovery?.purchasePerformed !== false
  || discovery?.sourceIntentIsLabelAuthority !== false
  || discovery?.researchOnly !== true
  || discovery?.trainingReady !== false
  || discovery?.productionEligible !== false
  || !Array.isArray(discovery?.records)
) throw new Error('adultlabs_scene_depth_refs_not_ready');

let firstBatch = null;
try {
  firstBatch = JSON.parse(await readFile(FIRST_BATCH_PATH, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
if (firstBatch && (
  firstBatch?.status !== 'research_balanced_professional_adult_target_scene_preview_screening_only'
  || firstBatch?.researchOnly !== true || firstBatch?.trainingReady !== false || firstBatch?.productionEligible !== false
)) throw new Error('adultlabs_scene_depth_first_batch_not_safe');
const firstBatchHashToFile = new Map((firstBatch?.records || []).map((record) => [record.sha256, record.fileName]));

const flattened = [];
for (const pool of discovery.records) {
  const refs = Array.isArray(pool.selectedAssetRefs) ? pool.selectedAssetRefs : [];
  for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
    const ref = refs[refIndex];
    flattened.push({
      sourceId: pool.sourceId,
      sourcePoolId: pool.sourcePoolId,
      setId: pool.setId,
      targetFacet: pool.targetFacet,
      productUrl: pool.productUrl,
      previewPageUrl: pool.previewPageUrl,
      selectionStrategy: pool.selectionStrategy,
      refIndexWithinPool: refIndex + 1,
      assetUrl: ref.assetUrl,
      fileToken: ref.fileToken,
      quantile: ref.quantile,
      screenshotOrdinal: ref.screenshotOrdinal,
      totalScreenshots: ref.totalScreenshots,
    });
  }
}
if (flattened.length !== EXPECTED_REF_COUNT) throw new Error('adultlabs_scene_depth_flattened_count_mismatch');

await rm(PREVIEW_DIR, { recursive: true, force: true });
await mkdir(PREVIEW_DIR, { recursive: true });

const records = [];
const failures = [];
const seenHashes = new Map();
for (let index = 0; index < flattened.length; index += 1) {
  const candidate = flattened[index];
  try {
    const downloaded = await downloadPreview(candidate.assetUrl, candidate.setId);
    const hash = sha256(downloaded.buffer);
    const ordinal = String(index + 1).padStart(3, '0');
    const facet = clean(candidate.targetFacet).replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const pool = clean(candidate.sourcePoolId).replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const withinPool = String(candidate.refIndexWithinPool).padStart(2, '0');
    const fileName = `${ordinal}__${facet}__${pool}__depth${withinPool}${downloaded.extension}`;
    await writeFile(path.join(PREVIEW_DIR, fileName), downloaded.buffer);

    const duplicateOfDepthBatch = seenHashes.get(hash) || null;
    if (!duplicateOfDepthBatch) seenHashes.set(hash, fileName);
    const duplicateOfFirstBatchFileName = firstBatchHashToFile.get(hash) || null;
    records.push({
      index: index + 1,
      fileName,
      ...candidate,
      resolvedAssetUrl: downloaded.resolvedUrl,
      resolvedImageHost: 'pixboost.com',
      mimeType: downloaded.mimeType,
      mimeResolution: downloaded.mimeResolution,
      byteLength: downloaded.buffer.length,
      sha256: hash,
      exactByteDuplicateWithinDepthBatch: Boolean(duplicateOfDepthBatch),
      duplicateOfDepthBatch,
      exactByteDuplicateOfFirstBatch: Boolean(duplicateOfFirstBatchFileName),
      duplicateOfFirstBatchFileName,
      previewOnly: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      imageBytesDownloadedLocallyForScreening: true,
      authenticationUsed: false,
      purchasePerformed: false,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    process.stdout.write(`Fetched AdultLabs scene-depth preview ${index + 1}/${flattened.length}: ${fileName}\n`);
  } catch (error) {
    failures.push({
      index: index + 1,
      sourcePoolId: candidate.sourcePoolId,
      setId: candidate.setId,
      targetFacet: candidate.targetFacet,
      assetUrl: candidate.assetUrl,
      error: safeError(error),
    });
    process.stdout.write(`Skipped AdultLabs scene-depth preview ${index + 1}/${flattened.length}: ${safeError(error)}\n`);
  }
}

const countsByFacet = records.reduce((acc, record) => { acc[record.targetFacet] = (acc[record.targetFacet] || 0) + 1; return acc; }, {});
const mimeResolutionCounts = records.reduce((acc, record) => { acc[record.mimeResolution] = (acc[record.mimeResolution] || 0) + 1; return acc; }, {});
const uniquePoolCount = new Set(records.map((record) => record.sourcePoolId)).size;
const depthDuplicateCount = records.filter((record) => record.exactByteDuplicateWithinDepthBatch).length;
const firstBatchByteDuplicateCount = records.filter((record) => record.exactByteDuplicateOfFirstBatch).length;

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_adultlabs_scene_depth_preview_screening_only',
  selectionStrategy: 'scene_depth_quantiles',
  requestedCount: flattened.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  uniquePoolCount,
  countsByFacet,
  mimeResolutionCounts,
  depthDuplicateCount,
  firstBatchByteDuplicateCount,
  maxPreviewBytes: MAX_PREVIEW_BYTES,
  sessionAuthenticationUsed: false,
  purchasePerformed: false,
  previewOnly: true,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  records,
  failures,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: failures.length === 0,
  requestedCount: flattened.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  uniquePoolCount,
  countsByFacet,
  mimeResolutionCounts,
  depthDuplicateCount,
  firstBatchByteDuplicateCount,
  previewDirectory: path.relative(REPO_ROOT, PREVIEW_DIR),
  metadataFile: path.relative(REPO_ROOT, OUTPUT_PATH),
  sessionAuthenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
