import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'moderation-web-research-explicit-creative-draft-v1.json');
const OUTPUT_SUBDIR = 'web-research-explicit-creative-draft-v1';
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', OUTPUT_SUBDIR);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const ALLOWED_FLICKR_SOURCE_HOSTS = new Set(['www.flickr.com', 'flickr.com']);
const ALLOWED_FLICKR_STATIC_HOST = /^(?:live|farm\d+)\.staticflickr\.com$/i;
const ALLOWED_DIRECT_SOURCE_HOSTS = new Set(['www.folsomstreeteast.com', 'folsomstreeteast.com']);
const ALLOWED_DIRECT_ASSET_HOSTS = new Set(['images.squarespace-cdn.com']);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,159}$/;
const SAFE_POOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 180);

const assertHttpsHost = (value, allowedHosts, errorCode) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error(errorCode);
  return url;
};

const assertExactPublicFlickrPhotoUrl = (value) => {
  const url = assertHttpsHost(value, ALLOWED_FLICKR_SOURCE_HOSTS, 'creative_research_flickr_source_not_allowed');
  if (!/^\/photos\/[^/]+\/\d+\/?$/.test(url.pathname)) throw new Error('creative_research_flickr_source_not_exact_photo');
  return url;
};

const validateFlickrStaticUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_FLICKR_STATIC_HOST.test(url.hostname)) {
    throw new Error('creative_research_flickr_asset_host_not_allowed');
  }
  return url;
};

const assertFlickrPhotoIdMatch = (sourceUrl, imageUrl) => {
  const photoId = new URL(sourceUrl).pathname.match(/\/(\d+)\/?$/)?.[1];
  if (!photoId || !imageUrl.pathname.includes(`/${photoId}_`)) throw new Error('creative_research_flickr_photo_id_mismatch');
};

const decodeHtmlAttribute = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'");

const resolveFlickrViaOembed = async (sourceUrl) => {
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
    const imageUrl = validateFlickrStaticUrl(candidate);
    assertFlickrPhotoIdMatch(sourceUrl, imageUrl);
    return imageUrl;
  } catch {
    return null;
  }
};

const resolveFlickrViaPage = async (sourceUrl) => {
  const response = await fetch(sourceUrl, { headers: { Accept: 'text/html' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`creative_research_flickr_page_http_${response.status}`);
  const finalUrl = assertExactPublicFlickrPhotoUrl(response.url);
  if (finalUrl.pathname !== new URL(sourceUrl).pathname) throw new Error('creative_research_flickr_redirect_mismatch');
  const html = await response.text();
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try {
      const imageUrl = validateFlickrStaticUrl(decodeHtmlAttribute(match[1]));
      assertFlickrPhotoIdMatch(sourceUrl, imageUrl);
      return imageUrl;
    } catch {
      // Continue to the next public page candidate.
    }
  }
  throw new Error('creative_research_flickr_page_missing_asset');
};

const resolveFlickrAsset = async (sourceUrl) => {
  assertExactPublicFlickrPhotoUrl(sourceUrl);
  return (await resolveFlickrViaOembed(sourceUrl)) || resolveFlickrViaPage(sourceUrl);
};

const assertDirectPublicEntry = (entry) => {
  const sourcePage = assertHttpsHost(
    clean(entry?.sourcePageUrl),
    ALLOWED_DIRECT_SOURCE_HOSTS,
    'creative_research_direct_source_host_not_allowed',
  );
  const asset = assertHttpsHost(
    clean(entry?.assetUrl),
    ALLOWED_DIRECT_ASSET_HOSTS,
    'creative_research_direct_asset_host_not_allowed',
  );
  if (sourcePage.pathname !== '/event-gallery') throw new Error('creative_research_direct_source_page_not_allowed');
  return asset;
};

const downloadBoundedImage = async (assetUrl, validateFinalUrl) => {
  const response = await fetch(assetUrl, {
    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`creative_research_image_http_${response.status}`);
  const finalUrl = validateFinalUrl(response.url);
  const mimeType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase();
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`creative_research_unsupported_mime:${mimeType || 'missing'}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error('creative_research_image_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('creative_research_image_size_invalid');
  return { buffer, mimeType, extension, resolvedUrl: finalUrl.toString() };
};

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
if (
  manifest?.status !== 'research_only_fetch_prototype_not_final_batch'
  || manifest?.datasetSubdir !== OUTPUT_SUBDIR
  || !Array.isArray(manifest?.entries)
  || manifest.entries.length < 5
) {
  throw new Error('invalid_creative_explicit_research_manifest');
}
if (
  manifest?.rules?.publicPagesOnly !== true
  || manifest?.rules?.noLoginOrPaywallBypass !== true
  || manifest?.rules?.humanLabelRequired !== true
  || manifest?.rules?.trainingReady !== false
  || manifest?.rules?.productionEligible !== false
) {
  throw new Error('unsafe_creative_explicit_research_rules');
}

await mkdir(OUTPUT_DIR, { recursive: true });
const records = [];
const failures = [];

for (const entry of manifest.entries) {
  const id = clean(entry?.id);
  const sourcePoolId = clean(entry?.sourcePoolId);
  const sourceType = clean(entry?.sourceType);
  const sourcePageUrl = clean(entry?.sourcePageUrl);
  try {
    if (!SAFE_ID_PATTERN.test(id)) throw new Error('invalid_creative_research_id');
    if (!SAFE_POOL_PATTERN.test(sourcePoolId)) throw new Error('invalid_creative_research_source_pool');

    let downloaded;
    if (sourceType === 'flickr_public_photo_page') {
      const imageUrl = await resolveFlickrAsset(sourcePageUrl);
      downloaded = await downloadBoundedImage(imageUrl, (value) => {
        const finalUrl = validateFlickrStaticUrl(value);
        assertFlickrPhotoIdMatch(sourcePageUrl, finalUrl);
        return finalUrl;
      });
    } else if (sourceType === 'direct_public_portfolio_asset') {
      const assetUrl = assertDirectPublicEntry(entry);
      downloaded = await downloadBoundedImage(assetUrl, (value) => (
        assertHttpsHost(value, ALLOWED_DIRECT_ASSET_HOSTS, 'creative_research_direct_asset_redirect_not_allowed')
      ));
    } else {
      throw new Error('unsupported_creative_research_source_type');
    }

    const fileName = `${id}${downloaded.extension}`;
    await writeFile(path.join(OUTPUT_DIR, fileName), downloaded.buffer, { flag: 'w' });
    records.push({
      id,
      fileName,
      sourceType,
      sourcePoolId,
      sourceUrl: sourcePageUrl,
      sourcePageUrl,
      creator: clean(entry.creator) || null,
      title: clean(entry.title) || null,
      visualFacet: clean(entry.discoveryFacet) || null,
      sourceYear: Number.isInteger(entry.sourceYear) ? entry.sourceYear : null,
      rightsStatus: 'unverified_research_only',
      termsStatus: clean(entry.termsStatus) || 'unverified_research_only',
      ageEvidence: clean(entry.ageEvidence) || null,
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
    process.stdout.write(`Fetched creative explicit research image ${id}: ${downloaded.buffer.length} bytes\n`);
  } catch (error) {
    failures.push({ id: id || null, sourcePageUrl: sourcePageUrl || null, error: safeError(error) });
    process.stdout.write(`Skipped creative explicit research image ${id || '(invalid id)'}: ${safeError(error)}\n`);
  }
}

if (records.length === 0) throw new Error('creative_explicit_research_fetch_no_images');
const sourcePoolCount = new Set(records.map((record) => record.sourcePoolId)).size;
const sourceTypeCounts = records.reduce((counts, record) => {
  counts[record.sourceType] = (counts[record.sourceType] || 0) + 1;
  return counts;
}, {});
const meaningfulPrototype = records.length >= 5 && sourcePoolCount >= 2;
const metadataPath = path.join(OUTPUT_DIR, 'sources.json');
await writeFile(metadataPath, `${JSON.stringify({
  schemaVersion: 1,
  batchVersion: manifest.batchVersion,
  datasetSubdir: OUTPUT_SUBDIR,
  outputSubdir: OUTPUT_SUBDIR,
  outputScope: 'local_creative_explicit_visual_research_prototype',
  requestedCount: manifest.entries.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  sourcePoolCount,
  sourceTypeCounts,
  meaningfulPrototype,
  discoveryMetadataIsLabelAuthority: false,
  ageSafetyReviewRequired: true,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  records,
  failures,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  batchVersion: manifest.batchVersion,
  datasetSubdir: OUTPUT_SUBDIR,
  requested: manifest.entries.length,
  fetched: records.length,
  failed: failures.length,
  sourcePoolCount,
  sourceTypeCounts,
  meaningfulPrototype,
  outputDirectory: path.relative(REPO_ROOT, OUTPUT_DIR),
  metadataFile: path.relative(REPO_ROOT, metadataPath),
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
