import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'public-fhg-v1');
const INPUT_PATH = path.join(ROOT, 'gallery-assets.json');
const PREVIEW_DIR = path.join(ROOT, 'previews');
const OUTPUT_PATH = path.join(ROOT, 'preview-sources.json');
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const USER_AGENT = 'ArtesModerationResearch/1.0';

const ALLOWED_ASSET_HOSTS = new Set([
  'www.mastasia.com',
  'mastasia.com',
  'fhg.metart.com',
  'static-fhg.metart.com',
  'hosted.met-art.com',
  'www.metart.com',
  'metart.com',
  'fhg.met-art.com',
]);

const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 180);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const assertAllowedAssetUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('public_fhg_preview_asset_not_https');
  if (!ALLOWED_ASSET_HOSTS.has(url.hostname.toLowerCase())) throw new Error('public_fhg_preview_asset_host_not_allowed');
  return url;
};

const downloadPreview = async (rawUrl) => {
  const requested = assertAllowedAssetUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`public_fhg_preview_image_http_${response.status}`);
  const finalUrl = assertAllowedAssetUrl(response.url);
  const mimeType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`public_fhg_preview_unsupported_mime:${mimeType || 'missing'}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PREVIEW_BYTES) throw new Error('public_fhg_preview_image_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_PREVIEW_BYTES) throw new Error('public_fhg_preview_image_size_invalid');
  return { buffer, extension, mimeType, resolvedUrl: finalUrl.toString() };
};

const discovery = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
if (
  discovery?.status !== 'research_public_fhg_gallery_asset_candidates_only'
  || discovery?.sourceIntentIsLabelAuthority !== false
  || discovery?.imageBytesDownloaded !== false
  || discovery?.researchOnly !== true
  || discovery?.trainingReady !== false
  || discovery?.productionEligible !== false
  || !Array.isArray(discovery?.candidates)
  || discovery.candidates.length < 40
) throw new Error('public_fhg_candidates_not_ready_for_previews');

await rm(PREVIEW_DIR, { recursive: true, force: true });
await mkdir(PREVIEW_DIR, { recursive: true });

const records = [];
const failures = [];
for (let index = 0; index < discovery.candidates.length; index += 1) {
  const candidate = discovery.candidates[index];
  const assetUrl = clean(candidate?.assetUrl);
  try {
    assertAllowedAssetUrl(assetUrl);
    const downloaded = await downloadPreview(assetUrl);
    const ordinal = String(index + 1).padStart(3, '0');
    const sourceId = clean(candidate?.sourceIds?.[0] || 'fhg').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const fileName = `${ordinal}__${sourceId}${downloaded.extension}`;
    await writeFile(path.join(PREVIEW_DIR, fileName), downloaded.buffer);
    records.push({
      index: index + 1,
      fileName,
      assetUrl,
      assetHost: candidate.assetHost || new URL(assetUrl).hostname.toLowerCase(),
      sourceIds: candidate.sourceIds || [],
      galleryUrls: candidate.galleryUrls || [],
      targetHints: candidate.targetHints || [],
      origins: candidate.origins || [],
      ageContext: candidate.ageContext || null,
      rightsContext: candidate.rightsContext || null,
      termsStatus: candidate.termsStatus || 'unverified_research_only',
      mimeType: downloaded.mimeType,
      byteLength: downloaded.buffer.length,
      sha256: sha256(downloaded.buffer),
      resolvedImageHost: new URL(downloaded.resolvedUrl).hostname.toLowerCase(),
      previewOnly: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    process.stdout.write(`Fetched public FHG preview ${index + 1}/${discovery.candidates.length}: ${fileName}\n`);
  } catch (error) {
    failures.push({ index: index + 1, assetUrl, sourceIds: candidate?.sourceIds || [], error: safeError(error) });
    process.stdout.write(`Skipped public FHG preview ${index + 1}/${discovery.candidates.length}: ${safeError(error)}\n`);
  }
}

const sourceCounts = records.reduce((acc, record) => {
  for (const sourceId of record.sourceIds || []) acc[sourceId] = (acc[sourceId] || 0) + 1;
  return acc;
}, {});
const hostCounts = records.reduce((acc, record) => {
  acc[record.resolvedImageHost] = (acc[record.resolvedImageHost] || 0) + 1;
  return acc;
}, {});
const previewCoverageRate = records.length / discovery.candidates.length;

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_public_fhg_preview_screening_only',
  requestedCount: discovery.candidates.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  previewCoverageRate: Number(previewCoverageRate.toFixed(4)),
  sourceCounts,
  hostCounts,
  maxPreviewBytes: MAX_PREVIEW_BYTES,
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
  ok: true,
  requestedCount: discovery.candidates.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  previewCoverageRate: Number(previewCoverageRate.toFixed(4)),
  sourceCounts,
  hostCounts,
  previewDirectory: path.relative(REPO_ROOT, PREVIEW_DIR),
  metadataFile: path.relative(REPO_ROOT, OUTPUT_PATH),
  previewOnly: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
