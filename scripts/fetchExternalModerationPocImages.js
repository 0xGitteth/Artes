import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExternalImageTrainingEligible } from '../functions/moderationExternalImageEligibility.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'moderation-external-poc-manifest-v1.json');
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', 'external-poc');
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const ALLOWED_FLICKR_SOURCE_HOSTS = new Set(['www.flickr.com', 'flickr.com']);
const ALLOWED_STATIC_HOST = /^(?:live|farm\d+)\.staticflickr\.com$/i;

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const assertWhitelistedFlickrPhotoUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_FLICKR_SOURCE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('external_poc_source_must_be_flickr_https');
  }
  if (!/^\/photos\/[^/]+\/\d+\/?$/.test(url.pathname)) {
    throw new Error('external_poc_source_must_be_exact_flickr_photo');
  }
  return url;
};

const validateResolvedStaticImageUrl = (value) => {
  const imageUrl = new URL(value);
  if (imageUrl.protocol !== 'https:' || !ALLOWED_STATIC_HOST.test(imageUrl.hostname)) {
    throw new Error('external_poc_resolved_host_not_allowed');
  }
  return imageUrl;
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

  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const candidate = String(payload?.url || payload?.thumbnail_url || '').trim();
  if (!candidate) return null;
  try {
    return validateResolvedStaticImageUrl(candidate);
  } catch {
    return null;
  }
};

const resolveViaPhotoPage = async (sourceUrl) => {
  const response = await fetch(sourceUrl, { headers: { Accept: 'text/html' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`external_poc_flickr_page_http_${response.status}`);
  const finalUrl = assertWhitelistedFlickrPhotoUrl(response.url);
  if (finalUrl.pathname !== new URL(sourceUrl).pathname) {
    throw new Error('external_poc_flickr_page_redirect_mismatch');
  }
  const html = await response.text();
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      return validateResolvedStaticImageUrl(decodeHtmlAttribute(match[1]));
    } catch {
      // Keep looking; fail closed below if no Flickr static image is found.
    }
  }
  throw new Error('external_poc_flickr_page_missing_allowed_og_image');
};

const resolveFlickrImageUrl = async (sourceUrl) => {
  assertWhitelistedFlickrPhotoUrl(sourceUrl);
  const oembed = await resolveViaOembed(sourceUrl);
  if (oembed) return oembed;
  return resolveViaPhotoPage(sourceUrl);
};

const downloadImage = async (imageUrl) => {
  const response = await fetch(imageUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`external_poc_image_http_${response.status}`);
  const finalUrl = validateResolvedStaticImageUrl(response.url);
  const mimeType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`external_poc_unsupported_mime:${mimeType || 'missing'}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error('external_poc_image_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('external_poc_image_size_invalid');
  return { buffer, mimeType, extension, resolvedUrl: finalUrl.toString() };
};

const main = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  if (entries.length === 0) throw new Error('external_poc_manifest_empty');
  await mkdir(OUTPUT_DIR, { recursive: true });

  const records = [];
  for (const entry of entries) {
    assertExternalImageTrainingEligible(entry);
    assertWhitelistedFlickrPhotoUrl(entry.sourceUrl);
    const imageUrl = await resolveFlickrImageUrl(entry.sourceUrl);
    const downloaded = await downloadImage(imageUrl);
    const fileName = `${entry.id}${downloaded.extension}`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    await writeFile(filePath, downloaded.buffer, { flag: 'w' });
    records.push({
      id: entry.id,
      fileName,
      mimeType: downloaded.mimeType,
      byteLength: downloaded.buffer.length,
      sha256: sha256(downloaded.buffer),
      sourceUrl: entry.sourceUrl,
      resolvedImageHost: new URL(downloaded.resolvedUrl).hostname,
      creator: entry.creator,
      copyrightLicense: entry.copyrightLicense,
      visualFacet: entry.visualFacet,
      intendedUse: entry.intendedUse,
      trainingReady: false,
    });
    process.stdout.write(`Fetched ${entry.id}: ${downloaded.buffer.length} bytes\n`);
  }

  const metadataPath = path.join(OUTPUT_DIR, 'sources.json');
  await writeFile(metadataPath, `${JSON.stringify({
    schemaVersion: 1,
    manifestStatus: manifest.status,
    imageCount: records.length,
    outputScope: 'local_embedding_poc_only',
    trainingReady: false,
    records,
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    fetched: records.length,
    outputDirectory: path.relative(REPO_ROOT, OUTPUT_DIR),
    metadataFile: path.relative(REPO_ROOT, metadataPath),
    trainingReady: false,
  }, null, 2)}\n`);
};

main().catch((error) => {
  console.error(`External moderation POC fetch failed: ${error?.message || error}`);
  process.exit(1);
});
