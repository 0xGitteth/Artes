import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-public-preview-v1');
const INPUT_PATH = path.join(ROOT, 'asset-candidates.json');
const PREVIEW_DIR = path.join(ROOT, 'previews');
const OUTPUT_PATH = path.join(ROOT, 'preview-sources.json');
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const ALLOWED_SOURCE_ASSET_HOSTS = new Set([
  'fhg.vivthomas.com',
  'static-fhg.vivthomas.com',
  'static.vivthomas.com',
  'images.squarespace-cdn.com',
]);

const clean = (value) => String(value || '').trim();
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);

const validateAssetUrl = (raw) => {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('professional_preview_asset_not_https');
  if (!ALLOWED_SOURCE_ASSET_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('professional_preview_asset_host_not_allowed');
  }
  return url;
};

const downloadPreview = async (rawUrl) => {
  const requested = validateAssetUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5', 'User-Agent': 'ArtesModerationResearch/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`professional_preview_http_${response.status}`);
  const finalUrl = validateAssetUrl(response.url);
  const mimeType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`professional_preview_unsupported_mime:${mimeType || 'missing'}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PREVIEW_BYTES) throw new Error('professional_preview_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_PREVIEW_BYTES) throw new Error('professional_preview_size_invalid');
  return { buffer, extension, mimeType, resolvedUrl: finalUrl.toString() };
};

const discovery = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
if (
  discovery?.status !== 'research_professional_adult_public_preview_asset_candidates_only'
  || discovery?.imageBytesDownloaded !== false
  || discovery?.sourceIntentIsLabelAuthority !== false
  || discovery?.researchOnly !== true
  || discovery?.trainingReady !== false
  || discovery?.productionEligible !== false
  || !Array.isArray(discovery?.candidates)
  || discovery.candidates.length < 40
) {
  throw new Error('professional_preview_candidates_not_ready');
}

await rm(PREVIEW_DIR, { recursive: true, force: true });
await mkdir(PREVIEW_DIR, { recursive: true });

const records = [];
const failures = [];
for (let index = 0; index < discovery.candidates.length; index += 1) {
  const candidate = discovery.candidates[index];
  const assetUrl = clean(candidate?.assetUrl);
  const sourceIds = Array.isArray(candidate?.sourceIds) ? candidate.sourceIds : [];
  try {
    validateAssetUrl(assetUrl);
    const downloaded = await downloadPreview(assetUrl);
    const ordinal = String(index + 1).padStart(3, '0');
    const source = clean(sourceIds[0] || 'professional').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const fileName = `${ordinal}__${source}${downloaded.extension}`;
    await writeFile(path.join(PREVIEW_DIR, fileName), downloaded.buffer);
    records.push({
      index: index + 1,
      fileName,
      assetUrl,
      sourceIds,
      seedPages: candidate.seedPages || [],
      targetHints: candidate.targetHints || [],
      ageContext: candidate.ageContext || null,
      termsStatus: candidate.termsStatus || 'unverified_research_only',
      mimeType: downloaded.mimeType,
      byteLength: downloaded.buffer.length,
      sha256: sha256(downloaded.buffer),
      resolvedImageHost: new URL(downloaded.resolvedUrl).hostname,
      previewOnly: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    process.stdout.write(`Fetched professional preview ${index + 1}/${discovery.candidates.length}: ${fileName}\n`);
  } catch (error) {
    failures.push({ index: index + 1, assetUrl, sourceIds, error: safeError(error) });
    process.stdout.write(`Skipped professional preview ${index + 1}/${discovery.candidates.length}: ${safeError(error)}\n`);
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

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_professional_adult_preview_screening_only',
  requestedCount: discovery.candidates.length,
  fetchedCount: records.length,
  failedCount: failures.length,
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
  sourceCounts,
  hostCounts,
  previewDirectory: path.relative(REPO_ROOT, PREVIEW_DIR),
  metadataFile: path.relative(REPO_ROOT, OUTPUT_PATH),
  previewOnly: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
