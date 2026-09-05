import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'hard-gap-targeted-v1');
const INPUT_PATH = path.join(ROOT, 'flickr-targeted-candidates.json');
const PREVIEW_DIR = path.join(ROOT, 'previews');
const OUTPUT_PATH = path.join(ROOT, 'preview-sources.json');
const PREVIEW_MAX_DIMENSION = 768;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const FLICKR_SOURCE_HOSTS = new Set(['www.flickr.com', 'flickr.com']);
const STATIC_HOST = /^(?:live|farm\d+)\.staticflickr\.com$/i;
const EXACT_PHOTO_PATH = /^\/photos\/([^/]+)\/(\d+)\/?$/;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const clean = (value) => String(value || '').trim();
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 180);

const assertExactPhotoUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !FLICKR_SOURCE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('targeted_preview_source_host_not_allowed');
  }
  if (!EXACT_PHOTO_PATH.test(url.pathname)) throw new Error('targeted_preview_source_not_exact_flickr_photo');
  return url;
};

const validateStaticUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !STATIC_HOST.test(url.hostname)) throw new Error('targeted_preview_asset_host_not_allowed');
  return url;
};

const assertPhotoIdMatch = (sourceUrl, imageUrl) => {
  const photoId = assertExactPhotoUrl(sourceUrl).pathname.match(EXACT_PHOTO_PATH)?.[2];
  if (!photoId || !imageUrl.pathname.includes(`/${photoId}_`)) throw new Error('targeted_preview_photo_id_mismatch');
};

const forcePreviewSize = (value) => {
  const url = validateStaticUrl(value);
  url.pathname = url.pathname.replace(/_[a-z](?=\.[A-Za-z0-9]+$)/i, '_z');
  return url;
};

const decodeHtmlAttribute = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'");

const resolveViaOembed = async (sourceUrl) => {
  const endpoint = new URL('https://www.flickr.com/services/oembed/');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('maxwidth', String(PREVIEW_MAX_DIMENSION));
  endpoint.searchParams.set('maxheight', String(PREVIEW_MAX_DIMENSION));
  endpoint.searchParams.set('url', sourceUrl);
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, redirect: 'follow' });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const candidate = clean(payload?.url || payload?.thumbnail_url);
  if (!candidate) return null;
  try {
    const imageUrl = forcePreviewSize(candidate);
    assertPhotoIdMatch(sourceUrl, imageUrl);
    return imageUrl;
  } catch {
    return null;
  }
};

const resolveViaPage = async (sourceUrl) => {
  const response = await fetch(sourceUrl, { headers: { Accept: 'text/html' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`targeted_preview_flickr_page_http_${response.status}`);
  const finalUrl = assertExactPhotoUrl(response.url);
  if (finalUrl.pathname !== new URL(sourceUrl).pathname) throw new Error('targeted_preview_flickr_redirect_mismatch');
  const html = await response.text();
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      const imageUrl = forcePreviewSize(decodeHtmlAttribute(match[1]));
      assertPhotoIdMatch(sourceUrl, imageUrl);
      return imageUrl;
    } catch {
      // Keep looking for a valid public Flickr asset.
    }
  }
  throw new Error('targeted_preview_flickr_page_missing_asset');
};

const resolvePreviewUrl = async (sourceUrl) => (
  (await resolveViaOembed(sourceUrl)) || resolveViaPage(sourceUrl)
);

const downloadPreview = async (imageUrl) => {
  const response = await fetch(imageUrl, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`targeted_preview_image_http_${response.status}`);
  const finalUrl = validateStaticUrl(response.url);
  const mimeType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`targeted_preview_unsupported_mime:${mimeType || 'missing'}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PREVIEW_BYTES) throw new Error('targeted_preview_image_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_PREVIEW_BYTES) throw new Error('targeted_preview_image_size_invalid');
  return { buffer, extension, mimeType, resolvedUrl: finalUrl.toString() };
};

const discovery = JSON.parse(await readFile(INPUT_PATH, 'utf8'));
if (
  discovery?.status !== 'research_targeted_flickr_candidates_only'
  || discovery?.sourceIntentIsLabelAuthority !== false
  || discovery?.imageBytesDownloaded !== false
  || discovery?.researchOnly !== true
  || discovery?.trainingReady !== false
  || discovery?.productionEligible !== false
  || !Array.isArray(discovery?.candidates)
  || discovery.candidates.length < 40
) {
  throw new Error('targeted_hard_gap_candidates_not_ready_for_previews');
}

await rm(PREVIEW_DIR, { recursive: true, force: true });
await mkdir(PREVIEW_DIR, { recursive: true });

const records = [];
const failures = [];
for (let index = 0; index < discovery.candidates.length; index += 1) {
  const candidate = discovery.candidates[index];
  const sourcePageUrl = clean(candidate?.sourcePageUrl);
  const ownerSlug = clean(candidate?.ownerSlug);
  const photoId = clean(candidate?.photoId);
  try {
    assertExactPhotoUrl(sourcePageUrl);
    if (!ownerSlug || !photoId) throw new Error('targeted_preview_candidate_missing_source_identity');
    const imageUrl = await resolvePreviewUrl(sourcePageUrl);
    const downloaded = await downloadPreview(imageUrl);
    const ordinal = String(index + 1).padStart(3, '0');
    const hint = clean(candidate?.targetHints?.[0] || 'mixed').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
    const fileName = `${ordinal}__${hint}__${photoId}${downloaded.extension}`;
    await writeFile(path.join(PREVIEW_DIR, fileName), downloaded.buffer);
    records.push({
      index: index + 1,
      fileName,
      sourcePageUrl,
      ownerSlug,
      photoId,
      sourcePoolId: candidate.sourcePoolId || null,
      curatedSourceIds: candidate.curatedSourceIds || [],
      creator: candidate.creator || null,
      targetHints: candidate.targetHints || [],
      discoveryContext: candidate.discoveryContext || null,
      sourceContext: candidate.sourceContext || null,
      ageContext: candidate.ageContext || null,
      termsStatus: candidate.termsStatus || 'unverified_research_only',
      mimeType: downloaded.mimeType,
      byteLength: downloaded.buffer.length,
      sha256: sha256(downloaded.buffer),
      resolvedImageHost: new URL(downloaded.resolvedUrl).hostname,
      previewOnly: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      humanAgeSafetyReviewRequired: true,
      detectorLabel: null,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    process.stdout.write(`Fetched targeted preview ${index + 1}/${discovery.candidates.length}: ${fileName}\n`);
  } catch (error) {
    failures.push({ index: index + 1, sourcePageUrl, ownerSlug, photoId, error: safeError(error) });
    process.stdout.write(`Skipped targeted preview ${index + 1}/${discovery.candidates.length}: ${safeError(error)}\n`);
  }
}

const sourcePoolCount = new Set(records.map((record) => record.sourcePoolId).filter(Boolean)).size;
const ownerCount = new Set(records.map((record) => record.ownerSlug).filter(Boolean)).size;
const targetHintCounts = records.reduce((acc, record) => {
  for (const hint of record.targetHints || []) acc[hint] = (acc[hint] || 0) + 1;
  return acc;
}, {});
const previewCoverageRate = records.length / discovery.candidates.length;

await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_targeted_preview_screening_only',
  requestedCount: discovery.candidates.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  previewCoverageRate: Number(previewCoverageRate.toFixed(4)),
  sourcePoolCount,
  ownerCount,
  targetHintCounts,
  previewMaxDimension: PREVIEW_MAX_DIMENSION,
  maxPreviewBytes: MAX_PREVIEW_BYTES,
  previewOnly: true,
  sourceIntentIsLabelAuthority: false,
  humanVisualScreeningRequired: true,
  humanAgeSafetyReviewRequired: true,
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
  sourcePoolCount,
  ownerCount,
  targetHintCounts,
  previewDirectory: path.relative(REPO_ROOT, PREVIEW_DIR),
  metadataFile: path.relative(REPO_ROOT, OUTPUT_PATH),
  previewOnly: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
