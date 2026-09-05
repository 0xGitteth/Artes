import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'moderation-web-research-explicit-v1.json');
const OUTPUT_SUBDIR = 'web-research-explicit-v1';
const OUTPUT_DIR = path.join(REPO_ROOT, '.tmp', 'moderation-test-images', OUTPUT_SUBDIR);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const THUMB_WIDTH = 2048;
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,159}$/;
const SAFE_POOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/;

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 180);

const assertCommonsFilePage = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'commons.wikimedia.org') {
    throw new Error('explicit_research_source_must_be_commons_https');
  }
  if (!url.pathname.startsWith('/wiki/File:')) throw new Error('explicit_research_source_must_be_commons_file_page');
  return url;
};

const assertUploadUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'upload.wikimedia.org') {
    throw new Error('explicit_research_resolved_host_not_allowed');
  }
  return url;
};

const resolveCommonsImage = async (fileTitle) => {
  if (!fileTitle.startsWith('File:')) throw new Error('explicit_research_missing_commons_file_title');
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php');
  endpoint.searchParams.set('action', 'query');
  endpoint.searchParams.set('format', 'json');
  endpoint.searchParams.set('formatversion', '2');
  endpoint.searchParams.set('prop', 'imageinfo');
  endpoint.searchParams.set('iiprop', 'url|mime|size');
  endpoint.searchParams.set('iiurlwidth', String(THUMB_WIDTH));
  endpoint.searchParams.set('titles', fileTitle);

  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'User-Agent': 'ArtesModerationResearch/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`explicit_research_commons_api_http_${response.status}`);
  const payload = await response.json();
  const page = payload?.query?.pages?.[0];
  if (!page || page.missing === true || !Array.isArray(page.imageinfo) || !page.imageinfo[0]) {
    throw new Error('explicit_research_commons_file_missing');
  }
  const info = page.imageinfo[0];
  const candidate = clean(info.thumburl || info.url);
  if (!candidate) throw new Error('explicit_research_commons_image_url_missing');
  const resolved = assertUploadUrl(candidate);
  const mimeType = clean(info.thumbmime || info.mime).toLowerCase();
  return { imageUrl: resolved.toString(), mimeType: mimeType || null };
};

const downloadImage = async ({ imageUrl, hintedMimeType }) => {
  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': 'ArtesModerationResearch/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`explicit_research_image_http_${response.status}`);
  const finalUrl = assertUploadUrl(response.url);
  const mimeType = clean(response.headers.get('content-type')).split(';')[0].toLowerCase() || hintedMimeType;
  const extension = ALLOWED_MIME_TYPES.get(mimeType);
  if (!extension) throw new Error(`explicit_research_unsupported_mime:${mimeType || 'missing'}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error('explicit_research_image_too_large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) throw new Error('explicit_research_image_size_invalid');
  return { buffer, mimeType, extension, resolvedUrl: finalUrl.toString() };
};

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
if (manifest?.status !== 'research_only_not_training_approved' || manifest?.datasetSubdir !== OUTPUT_SUBDIR || !Array.isArray(manifest?.entries) || manifest.entries.length < 10) {
  throw new Error('invalid_explicit_web_research_manifest');
}
if (manifest?.rules?.trainingReady !== false || manifest?.rules?.productionEligible !== false || manifest?.rules?.publicPagesOnly !== true || manifest?.rules?.humanLabelRequired !== true) {
  throw new Error('unsafe_explicit_web_research_manifest_rules');
}

await mkdir(OUTPUT_DIR, { recursive: true });
const records = [];
const failures = [];
const seenCommonsTitles = new Set();

for (const entry of manifest.entries) {
  const id = clean(entry?.id);
  const sourcePoolId = clean(entry?.sourcePoolId);
  const sourceUrl = clean(entry?.sourceUrl);
  const fileTitle = clean(entry?.commonsFileTitle);
  try {
    if (!SAFE_ID_PATTERN.test(id)) throw new Error('invalid_explicit_research_id');
    if (!SAFE_POOL_PATTERN.test(sourcePoolId)) throw new Error('invalid_explicit_research_source_pool');
    if (clean(entry?.sourceType) !== 'wikimedia_commons') throw new Error('explicit_research_source_type_not_supported');
    assertCommonsFilePage(sourceUrl);
    if (!fileTitle.startsWith('File:')) throw new Error('invalid_explicit_research_commons_title');
    const duplicateKey = `${fileTitle}::${clean(entry.discoveryFacet)}`;
    if (seenCommonsTitles.has(duplicateKey)) throw new Error('duplicate_explicit_research_candidate');
    seenCommonsTitles.add(duplicateKey);

    const resolved = await resolveCommonsImage(fileTitle);
    const downloaded = await downloadImage({ imageUrl: resolved.imageUrl, hintedMimeType: resolved.mimeType });
    const fileName = `${id}${downloaded.extension}`;
    await writeFile(path.join(OUTPUT_DIR, fileName), downloaded.buffer, { flag: 'w' });
    records.push({
      id,
      fileName,
      sourceType: 'wikimedia_commons',
      sourcePoolId,
      sourceUrl,
      sourceFileTitle: fileTitle,
      creator: clean(entry.creator) || null,
      title: clean(entry.title) || null,
      visualFacet: clean(entry.discoveryFacet) || null,
      sourceYear: Number.isInteger(entry.sourceYear) ? entry.sourceYear : null,
      rightsStatus: clean(entry.rightsStatus) || 'unverified_research_only',
      ageEvidence: clean(entry.ageEvidence) || 'human_confirmation_required',
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
    process.stdout.write(`Fetched explicit research image ${id}: ${downloaded.buffer.length} bytes\n`);
  } catch (error) {
    failures.push({ id: id || null, sourceUrl: sourceUrl || null, error: safeError(error) });
    process.stdout.write(`Skipped explicit research image ${id || '(invalid id)'}: ${safeError(error)}\n`);
  }
}

if (records.length === 0) throw new Error('explicit_web_research_fetch_no_images');
const sourcePoolCount = new Set(records.map((record) => record.sourcePoolId)).size;
const facetCounts = records.reduce((counts, record) => {
  counts[record.visualFacet] = (counts[record.visualFacet] || 0) + 1;
  return counts;
}, {});
const meaningfulReviewBatch = records.length >= 10 && sourcePoolCount >= 6;
const metadataPath = path.join(OUTPUT_DIR, 'sources.json');
await writeFile(metadataPath, `${JSON.stringify({
  schemaVersion: 1,
  batchVersion: manifest.batchVersion,
  outputSubdir: OUTPUT_SUBDIR,
  outputScope: 'local_explicit_visual_research_only',
  requestedCount: manifest.entries.length,
  fetchedCount: records.length,
  failedCount: failures.length,
  sourcePoolCount,
  facetCounts,
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
  facetCounts,
  meaningfulReviewBatch,
  outputDirectory: path.relative(REPO_ROOT, OUTPUT_DIR),
  metadataFile: path.relative(REPO_ROOT, metadataPath),
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
  imageBytesPrinted: false,
}, null, 2)}\n`);
