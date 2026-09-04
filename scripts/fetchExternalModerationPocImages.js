import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExternalImageTrainingEligible } from '../functions/moderationExternalImageEligibility.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_MANIFEST_NAME = 'moderation-external-poc-manifest-v1.json';
const DEFAULT_OUTPUT_SUBDIR = 'external-poc';
const MANIFEST_NAME_PATTERN = /^[A-Za-z0-9._-]+\.json$/;
const OUTPUT_SUBDIR_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const resolveBoundedName = (value, fallback, pattern, errorCode) => {
  const candidate = String(value || fallback).trim();
  if (!pattern.test(candidate) || candidate.includes('..')) throw new Error(errorCode);
  return candidate;
};

const MANIFEST_NAME = resolveBoundedName(
  process.env.ARTES_EXTERNAL_POC_MANIFEST,
  DEFAULT_MANIFEST_NAME,
  MANIFEST_NAME_PATTERN,
  'external_poc_manifest_name_invalid',
);
const OUTPUT_SUBDIR = resolveBoundedName(
  process.env.ARTES_EXTERNAL_POC_OUTPUT_SUBDIR,
  DEFAULT_OUTPUT_SUBDIR,
  OUTPUT_SUBDIR_PATTERN,
  'external_poc_output_subdir_invalid',
);
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', MANIFEST_NAME);
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', OUTPUT_SUBDIR);
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

const assertPinnedUrlMatchesPhotoId = (sourceUrl, imageUrl) => {
  const sourceMatch = new URL(sourceUrl).pathname.match(/\/(\d+)\/?$/);
  const photoId = sourceMatch?.[1];
  if (!photoId || !imageUrl.pathname.includes(`/${photoId}_`)) {
    throw new Error('external_poc_pinned_image_photo_id_mismatch');
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

  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const candidate = String(payload?.url || payload?.thumbnail_url || '').trim();
  if (!candidate) return null;
  try {
    const resolved = validateResolvedStaticImageUrl(candidate);
    assertPinnedUrlMatchesPhotoId(sourceUrl, resolved);
    return resolved;
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
      const resolved = validateResolvedStaticImageUrl(decodeHtmlAttribute(match[1]));
      assertPinnedUrlMatchesPhotoId(sourceUrl, resolved);
      return resolved;
    } catch {
      // Keep looking; fail closed below if no matching Flickr static image is found.
    }
  }
  throw new Error('external_poc_flickr_page_missing_allowed_og_image');
};

const resolveFlickrImageUrl = async ({ sourceUrl, resolvedImageUrl }) => {
  assertWhitelistedFlickrPhotoUrl(sourceUrl);

  if (resolvedImageUrl) {
    const pinned = validateResolvedStaticImageUrl(resolvedImageUrl);
    assertPinnedUrlMatchesPhotoId(sourceUrl, pinned);
    return pinned;
  }

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
    const imageUrl = await resolveFlickrImageUrl(entry);
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
    manifestName: MANIFEST_NAME,
    outputSubdir: OUTPUT_SUBDIR,
    imageCount: records.length,
    outputScope: 'local_embedding_poc_only',
    trainingReady: false,
    records,
  }, null, 2)}\n`, 'utf8');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    fetched: records.length,
    manifestName: MANIFEST_NAME,
    outputDirectory: path.relative(REPO_ROOT, OUTPUT_DIR),
    metadataFile: path.relative(REPO_ROOT, metadataPath),
    trainingReady: false,
  }, null, 2)}\n`);
};

main().catch((error) => {
  console.error(`External moderation POC fetch failed: ${error?.message || error}`);
  process.exit(1);
});
