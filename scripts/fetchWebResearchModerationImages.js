import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'moderation-web-research-batch-v1.json');
const OUTPUT_SUBDIR = 'web-research-v1';
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', OUTPUT_SUBDIR);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const ALLOWED_FLICKR_SOURCE_HOSTS = new Set(['www.flickr.com', 'flickr.com']);
const ALLOWED_STATIC_HOST = /^(?:live|farm\d+)\.staticflickr\.com$/i;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,159}$/;
const SAFE_POOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 160);

const assertExactPublicFlickrPhotoUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_FLICKR_SOURCE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('research_source_must_be_public_flickr_https');
  }
  if (!/^\/photos\/[^/]+\/\d+\/?$/.test(url.pathname)) {
    throw new Error('research_source_must_be_exact_flickr_photo');
  }
  return url;
};

const validateStaticImageUrl = (value) => {
  const imageUrl = new URL(value);
  if (imageUrl.protocol !== 'https:' || !ALLOWED_STATIC_HOST.test(imageUrl.hostname)) {
    throw new Error('research_resolved_image_host_not_allowed');
  }
  return imageUrl;
};

const assertPhotoIdMatch = (sourceUrl, imageUrl) => {
  const photoId = new URL(sourceUrl).pathname.match(/\/(\d+)\/?$/)?.[1];
  if (!photoId || !imageUrl.pathname.includes(`/${photoId}_`)) {
    throw new Error('research_resolved_photo_id_mismatch');
  }
};

const decodeHtmlAttribute = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'");

const resolveViaOembed = async (sourceUrl) => {
  const endpoint = new URL('https://www.flickr.com/services/oembed/');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('maxwidth', '2048');
  endpoint.searchParams.set('maxheight', '2048');
  endpoint.searchParams.set('url', sourceUrl);
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, redirect: 'follow' });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const candidate = clean(payload?.url || payload?.thumbnail_url);
  if (!candidate) return null;
  try {
    const imageUrl = validateStaticImageUrl(candidate);
    assertPhotoIdMatch(sourceUrl, imageUrl);
    return imageUrl;
  } catch {
    return null;
  }
};

const resolveViaPhotoPage = async (sourceUrl) => {
  const response = await fetch(sourceUrl, { headers: { Accept: 'text/html' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`research_flickr_page_http_${response.status}`);
  const finalUrl = assertExactPublicFlickrPhotoUrl(response.url);
  if (finalUrl.pathname !== new URL(sourceUrl).pathname) throw new Error('research_flickr_page_redirect_mismatch');
  const html = await response.text();
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      const imageUrl = validateStaticImageUrl(decodeHtmlAttribute(match[1]));
      assertPhotoIdMatch(sourceUrl, imageUrl);
      return imageUrl;
    } catch {
      // Try the next candidate. Restricted or unavailable pages are recorded as failures later.
    }
  }
  throw new Error('research_flickr_page_missing_allowed_image');
};

const resolveFlickrImageUrl = async (sourceUrl) => {
  assertExactPublicFlickrPhotoUrl(sourceUrl);
  const oembed = await resolveViaOembed(sourceUrl);
  if (oembed) return oembed;
  return resolveViaPhotoPage(sourceUrl);
};

const downloadImage = async (imageUrl) => {
  const response = await fetch(imageUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`research_image_http_${response.status}`);
  const finalUrl = validateStaticImageUrl(response.url);
  const mimeType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`research_unsupported_mime:${mimeType || 'missing'}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error('research_image_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('research_image_size_invalid');
  return { buffer, mimeType, extension, resolvedUrl: finalUrl.toString() };
};

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
if (manifest?.status !== 'research_only_not_training_approved' || !Array.isArray(manifest?.entries) || manifest.entries.length < 5) {
  throw new Error('invalid_web_research_manifest');
}
if (manifest?.rules?.trainingReady !== false || manifest?.rules?.productionEligible !== false || manifest?.rules?.publicPagesOnly !== true) {
  throw new Error('unsafe_web_research_manifest_rules');
}

await mkdir(OUTPUT_DIR, { recursive: true });
const records = [];
const failures = [];
for (const entry of manifest.entries) {
  const id = clean(entry?.id);
  const sourcePoolId = clean(entry?.sourcePoolId);
  const sourceUrl = clean(entry?.sourceUrl);
  try {
    if (!SAFE_ID_PATTERN.test(id)) throw new Error('invalid_research_id');
    if (!SAFE_POOL_PATTERN.test(sourcePoolId)) throw new Error('invalid_research_source_pool');
    assertExactPublicFlickrPhotoUrl(sourceUrl);
    const imageUrl = await resolveFlickrImageUrl(sourceUrl);
    const downloaded = await downloadImage(imageUrl);
    const fileName = `${id}${downloaded.extension}`;
    await writeFile(path.join(OUTPUT_DIR, fileName), downloaded.buffer, { flag: 'w' });
    records.push({
      id,
      fileName,
      sourcePoolId,
      sourceUrl,
      creator: clean(entry.creator) || null,
      title: clean(entry.title) || null,
      visualFacet: clean(entry.discoveryFacet) || null,
      sourceYear: Number.isInteger(entry.sourceYear) ? entry.sourceYear : null,
      rightsStatus: clean(entry.rightsStatus) || 'unverified_research_only',
      mimeType: downloaded.mimeType,
      byteLength: downloaded.buffer.length,
      sha256: sha256(downloaded.buffer),
      resolvedImageHost: new URL(downloaded.resolvedUrl).hostname,
      ageStatus: 'unverified_research_only',
      humanAgeSafetyReviewRequired: true,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
    process.stdout.write(`Fetched research image ${id}: ${downloaded.buffer.length} bytes\n`);
  } catch (error) {
    failures.push({ id: id || null, sourceUrl: sourceUrl || null, error: safeError(error) });
    process.stdout.write(`Skipped research image ${id || '(invalid id)'}: ${safeError(error)}\n`);
  }
}

if (records.length === 0) throw new Error('web_research_fetch_no_images');
const sourcePoolCount = new Set(records.map((record) => record.sourcePoolId)).size;
const meaningfulReviewBatch = records.length >= 5 && sourcePoolCount >= 2;
const metadataPath = path.join(OUTPUT_DIR, 'sources.json');
await writeFile(metadataPath, `${JSON.stringify({
  schemaVersion: 1,
  batchVersion: manifest.batchVersion,
  outputSubdir: OUTPUT_SUBDIR,
  outputScope: 'local_visual_research_only',
  requestedCount: manifest.entries.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  sourcePoolCount,
  meaningfulReviewBatch,
  ageSafetyReviewRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  records,
  failures,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  requested: manifest.entries.length,
  fetched: records.length,
  failed: failures.length,
  sourcePoolCount,
  meaningfulReviewBatch,
  outputDirectory: path.relative(REPO_ROOT, OUTPUT_DIR),
  metadataFile: path.relative(REPO_ROOT, metadataPath),
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
