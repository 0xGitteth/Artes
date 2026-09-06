import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const INPUT_PATH = path.join(ROOT, 'balanced-target-scene-preview-refs.json');
const PREVIEW_DIR = path.join(ROOT, 'balanced-target-scene-previews');
const OUTPUT_PATH = path.join(ROOT, 'balanced-target-scene-preview-screening.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const MAX_PIXBOOST_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_DIRECT_PREVIEW_BYTES = 12 * 1024 * 1024;
const EXPECTED_REF_COUNT = 78;
const EXPECTED_POOL_COUNT = 26;

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
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) return { mimeType: 'image/png', extension: '.png' };
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return { mimeType: 'image/webp', extension: '.webp' };
  return null;
};

const classifyAllowedAsset = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('balanced_target_preview_asset_not_https');
  const host = url.hostname.toLowerCase();
  if (
    host === 'pixboost.com'
    && /^\/api\/2\/img\/samples\/\d+\/cs\/.+\.(?:jpe?g|png|webp)\/optimise$/i.test(url.pathname)
  ) return { url, shape: 'adultlabs_pixboost_sample' };
  if (
    ['videobunch.com', 'www.videobunch.com'].includes(host)
    && /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
  ) return { url, shape: 'direct_image' };
  throw new Error('balanced_target_preview_asset_shape_not_allowed');
};

const requestHeadersFor = (assetShape) => ({
  Accept: assetShape === 'adultlabs_pixboost_sample'
    ? 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1'
    : 'image/jpeg,image/png,image/webp,*/*;q=0.5',
  'User-Agent': USER_AGENT,
});

const maxBytesFor = (assetShape) => (
  assetShape === 'adultlabs_pixboost_sample'
    ? MAX_PIXBOOST_PREVIEW_BYTES
    : MAX_DIRECT_PREVIEW_BYTES
);

const downloadPreview = async (rawUrl) => {
  const requested = classifyAllowedAsset(rawUrl);
  const maxBytes = maxBytesFor(requested.shape);
  const response = await fetch(requested.url, {
    headers: requestHeadersFor(requested.shape),
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`balanced_target_preview_http_${response.status}`);
  const resolved = classifyAllowedAsset(response.url);
  if (resolved.shape !== requested.shape) throw new Error('balanced_target_preview_asset_shape_changed');

  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error(`balanced_target_preview_declared_too_large:${declaredLength}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > maxBytes) throw new Error(`balanced_target_preview_size_invalid:${buffer.length}`);

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
  if (!extension) throw new Error(`balanced_target_preview_unsupported_mime:${headerMimeType || 'missing'}`);

  return {
    buffer,
    extension,
    mimeType,
    responseMimeType: headerMimeType || null,
    mimeResolution,
    resolvedUrl: resolved.url.toString(),
    assetShape: resolved.shape,
    maxBytes,
  };
};

const discovery = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
if (
  discovery?.status !== 'research_balanced_professional_adult_target_scene_preview_refs_only'
  || discovery?.poolCount !== EXPECTED_POOL_COUNT
  || discovery?.selectedRefCount !== EXPECTED_REF_COUNT
  || discovery?.poolsWithThreeRefs !== EXPECTED_POOL_COUNT
  || discovery?.failedPoolCount !== 0
  || discovery?.imageBytesDownloaded !== false
  || discovery?.authenticationUsed !== false
  || discovery?.purchasePerformed !== false
  || discovery?.sourceIntentIsLabelAuthority !== false
  || discovery?.researchOnly !== true
  || discovery?.trainingReady !== false
  || discovery?.productionEligible !== false
  || !Array.isArray(discovery?.records)
) throw new Error('balanced_target_preview_refs_not_ready');

const flattened = [];
for (const pool of discovery.records) {
  const refs = Array.isArray(pool.selectedAssetRefs) ? pool.selectedAssetRefs : [];
  for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
    flattened.push({
      sourceId: pool.sourceId,
      sourcePoolId: pool.sourcePoolId,
      targetFacet: pool.targetFacet,
      studio: pool.studio || null,
      setId: pool.setId || null,
      productUrl: pool.productUrl,
      previewPageUrl: pool.resolvedPreviewPageUrl || pool.previewPageUrl,
      refIndexWithinPool: refIndex + 1,
      assetUrl: refs[refIndex].assetUrl,
      assetHost: refs[refIndex].assetHost,
      discoveryAssetShape: refs[refIndex].assetShape || null,
      discoveryOrigins: refs[refIndex].origins || [],
    });
  }
}
if (flattened.length !== EXPECTED_REF_COUNT) throw new Error('balanced_target_preview_flattened_count_mismatch');

await rm(PREVIEW_DIR, { recursive: true, force: true });
await mkdir(PREVIEW_DIR, { recursive: true });

const records = [];
const failures = [];
const seenHashes = new Map();
for (let index = 0; index < flattened.length; index += 1) {
  const candidate = flattened[index];
  try {
    const downloaded = await downloadPreview(candidate.assetUrl);
    const hash = sha256(downloaded.buffer);
    const ordinal = String(index + 1).padStart(3, '0');
    const facet = clean(candidate.targetFacet).replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const pool = clean(candidate.sourcePoolId).replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const withinPool = String(candidate.refIndexWithinPool).padStart(2, '0');
    const fileName = `${ordinal}__${facet}__${pool}__${withinPool}${downloaded.extension}`;
    await writeFile(path.join(PREVIEW_DIR, fileName), downloaded.buffer);
    const duplicateOf = seenHashes.get(hash) || null;
    if (!duplicateOf) seenHashes.set(hash, fileName);
    records.push({
      index: index + 1,
      fileName,
      ...candidate,
      resolvedAssetUrl: downloaded.resolvedUrl,
      resolvedImageHost: new URL(downloaded.resolvedUrl).hostname.toLowerCase(),
      assetShape: downloaded.assetShape,
      mimeType: downloaded.mimeType,
      responseMimeType: downloaded.responseMimeType,
      mimeResolution: downloaded.mimeResolution,
      byteLength: downloaded.buffer.length,
      maxAllowedBytesForShape: downloaded.maxBytes,
      sha256: hash,
      exactByteDuplicate: Boolean(duplicateOf),
      duplicateOf,
      previewOnly: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      imageBytesDownloadedLocallyForScreening: true,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    process.stdout.write(`Fetched balanced preview ${index + 1}/${flattened.length}: ${fileName}${duplicateOf ? ` duplicate-of=${duplicateOf}` : ''}\n`);
  } catch (error) {
    failures.push({
      index: index + 1,
      sourceId: candidate.sourceId,
      sourcePoolId: candidate.sourcePoolId,
      targetFacet: candidate.targetFacet,
      assetUrl: candidate.assetUrl,
      error: safeError(error),
    });
    process.stdout.write(`Skipped balanced preview ${index + 1}/${flattened.length}: ${safeError(error)}\n`);
  }
}

const countsByFacet = records.reduce((acc, record) => {
  acc[record.targetFacet] = (acc[record.targetFacet] || 0) + 1;
  return acc;
}, {});
const countsBySource = records.reduce((acc, record) => {
  acc[record.sourceId] = (acc[record.sourceId] || 0) + 1;
  return acc;
}, {});
const countsByHost = records.reduce((acc, record) => {
  acc[record.resolvedImageHost] = (acc[record.resolvedImageHost] || 0) + 1;
  return acc;
}, {});
const mimeResolutionCounts = records.reduce((acc, record) => {
  acc[record.mimeResolution] = (acc[record.mimeResolution] || 0) + 1;
  return acc;
}, {});
const uniquePoolCount = new Set(records.map((record) => record.sourcePoolId)).size;
const duplicateCount = records.filter((record) => record.exactByteDuplicate).length;

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_balanced_professional_adult_target_scene_preview_screening_only',
  requestedCount: flattened.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  uniquePoolCount,
  countsByFacet,
  countsBySource,
  countsByHost,
  mimeResolutionCounts,
  duplicateCount,
  maxPreviewBytesByShape: {
    adultlabs_pixboost_sample: MAX_PIXBOOST_PREVIEW_BYTES,
    direct_image: MAX_DIRECT_PREVIEW_BYTES,
  },
  publicCdnSignedQueryMayBePresent: true,
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
  countsBySource,
  countsByHost,
  mimeResolutionCounts,
  duplicateCount,
  previewDirectory: path.relative(REPO_ROOT, PREVIEW_DIR),
  metadataFile: path.relative(REPO_ROOT, OUTPUT_PATH),
  publicCdnSignedQueryMayBePresent: true,
  sessionAuthenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
