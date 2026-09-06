import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const SOURCE_POOLS_PATH = path.join(ROOT, 'adultlabs-target-scene-source-pools.json');
const CURRENT_REFS_PATH = path.join(ROOT, 'balanced-target-scene-preview-refs.json');
const OUTPUT_PATH = path.join(ROOT, 'adultlabs-scene-depth-preview-refs.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const QUANTILES = [0.35, 0.65, 0.9];
const EXPECTED_POOL_COUNT = 21;
const EXPECTED_SELECTED_COUNT = EXPECTED_POOL_COUNT * QUANTILES.length;

const clean = (value) => String(value || '').trim();
const decodeHtml = (value) => String(value || '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 240);

const assertAdultLabsPage = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !['adultlabs.com', 'www.adultlabs.com'].includes(url.hostname.toLowerCase())) throw new Error('adultlabs_scene_depth_page_not_allowed');
  return url;
};
const fetchHtml = async (rawUrl) => {
  const requested = assertAdultLabsPage(rawUrl);
  const response = await fetch(requested, { headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!response.ok) throw new Error(`adultlabs_scene_depth_http_${response.status}`);
  const finalUrl = assertAdultLabsPage(response.url);
  return { html: await response.text(), finalUrl };
};

const normalizePixboostSample = (raw, pageUrl, setId) => {
  let url;
  try { url = new URL(decodeHtml(clean(raw)), pageUrl); } catch { return null; }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'pixboost.com') return null;
  const pattern = new RegExp(`^/api/2/img/samples/${setId}/cs/([^/]+\\.(?:jpe?g|png|webp))/optimise$`, 'i');
  const match = url.pathname.match(pattern);
  if (!match) return null;
  url.hash = '';
  return { assetUrl: url.toString(), fileToken: match[1] };
};

const collectSamplesInMarkupOrder = (html, pageUrl, setId) => {
  const byUrl = new Map();
  for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const sample = normalizePixboostSample(match[1], pageUrl, setId);
    if (sample && !byUrl.has(sample.assetUrl)) byUrl.set(sample.assetUrl, sample);
  }
  return [...byUrl.values()];
};

const sourcePools = JSON.parse(await readFile(SOURCE_POOLS_PATH, 'utf8'));
if (
  sourcePools?.status !== 'research_adultlabs_target_scene_source_pool_discovery_only'
  || sourcePools?.imageBytesDownloaded !== false || sourcePools?.authenticationUsed !== false || sourcePools?.purchasePerformed !== false
  || sourcePools?.sourceIntentIsLabelAuthority !== false || sourcePools?.researchOnly !== true
  || sourcePools?.trainingReady !== false || sourcePools?.productionEligible !== false
) throw new Error('adultlabs_scene_depth_source_pools_not_safe');

const currentRefs = JSON.parse(await readFile(CURRENT_REFS_PATH, 'utf8'));
if (
  currentRefs?.status !== 'research_balanced_professional_adult_target_scene_preview_refs_only'
  || currentRefs?.imageBytesDownloaded !== false || currentRefs?.authenticationUsed !== false || currentRefs?.purchasePerformed !== false
  || currentRefs?.sourceIntentIsLabelAuthority !== false || currentRefs?.researchOnly !== true
  || currentRefs?.trainingReady !== false || currentRefs?.productionEligible !== false
) throw new Error('adultlabs_scene_depth_current_refs_not_safe');
const previouslySelected = new Set(currentRefs.records
  .filter((record) => record.sourceId === 'adultlabs_public_catalog')
  .flatMap((record) => record.selectedAssetRefs || []).map((ref) => ref.assetUrl));

const pools = (sourcePools.acceptedRecords || []).filter((record) =>
  ['male_male', 'solo_male', 'male_female'].includes(record.targetFacet) && record.targetFacetSupportedByMetadata === true
);
if (pools.length !== EXPECTED_POOL_COUNT) throw new Error(`adultlabs_scene_depth_pool_count:${pools.length}`);

const records = [];
const failures = [];
for (const pool of pools) {
  const setId = String(pool.setId);
  const previewPageUrl = `https://adultlabs.com/content/screenshots/${setId}`;
  try {
    const { html, finalUrl } = await fetchHtml(previewPageUrl);
    const samples = collectSamplesInMarkupOrder(html, finalUrl, setId);
    if (samples.length < 12) throw new Error(`adultlabs_scene_depth_too_few_samples:${samples.length}`);
    const selected = [];
    for (const quantile of QUANTILES) {
      let index = Math.round((samples.length - 1) * quantile);
      while (index < samples.length && (selected.some((item) => item.assetUrl === samples[index].assetUrl) || previouslySelected.has(samples[index].assetUrl))) index += 1;
      if (index >= samples.length) throw new Error(`adultlabs_scene_depth_quantile_unavailable:${quantile}`);
      selected.push({ ...samples[index], quantile, screenshotOrdinal: index + 1, totalScreenshots: samples.length });
    }
    records.push({
      sourceId: 'adultlabs_public_catalog', sourcePoolId: pool.sourcePoolId, setId: pool.setId,
      targetFacet: pool.targetFacet, productUrl: pool.productUrl, previewPageUrl: finalUrl.toString(),
      selectionStrategy: 'scene_depth_quantiles', quantiles: QUANTILES, discoveredScreenshotCount: samples.length,
      selectedAssetRefCount: selected.length, selectedAssetRefs: selected,
      overlapWithFirstThreeBatchCount: selected.filter((item) => previouslySelected.has(item.assetUrl)).length,
      sourceIntentIsLabelAuthority: false, humanVisualScreeningRequired: true, detectorLabel: null,
      imageBytesDownloaded: false, authenticationUsed: false, purchasePerformed: false,
      researchOnly: true, trainingReady: false, productionEligible: false,
    });
  } catch (error) {
    failures.push({ sourcePoolId: pool.sourcePoolId, setId: pool.setId, targetFacet: pool.targetFacet, previewPageUrl, error: safeError(error) });
  }
}

const selectedRefCount = records.reduce((sum, record) => sum + record.selectedAssetRefCount, 0);
const refsByFacet = records.reduce((acc, record) => { acc[record.targetFacet] = (acc[record.targetFacet] || 0) + record.selectedAssetRefCount; return acc; }, {});
const minScreenshotsPerPool = records.length ? Math.min(...records.map((record) => record.discoveredScreenshotCount)) : 0;
const maxScreenshotsPerPool = records.length ? Math.max(...records.map((record) => record.discoveredScreenshotCount)) : 0;
const overlapWithFirstThreeBatchCount = records.reduce((sum, record) => sum + record.overlapWithFirstThreeBatchCount, 0);

await mkdir(ROOT, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1, status: 'research_adultlabs_scene_depth_preview_refs_only',
  selectionStrategy: 'scene_depth_quantiles', quantiles: QUANTILES,
  poolCount: pools.length, processedPoolCount: records.length, failedPoolCount: failures.length,
  selectedRefCount, expectedSelectedRefCount: EXPECTED_SELECTED_COUNT, refsByFacet,
  minScreenshotsPerPool, maxScreenshotsPerPool, overlapWithFirstThreeBatchCount,
  imageBytesDownloaded: false, authenticationUsed: false, purchasePerformed: false,
  sourceIntentIsLabelAuthority: false, humanVisualScreeningRequired: true,
  researchOnly: true, trainingReady: false, productionEligible: false,
  records, failures,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: failures.length === 0 && selectedRefCount === EXPECTED_SELECTED_COUNT,
  poolCount: pools.length, processedPoolCount: records.length, failedPoolCount: failures.length,
  selectedRefCount, refsByFacet, minScreenshotsPerPool, maxScreenshotsPerPool, overlapWithFirstThreeBatchCount,
  output: path.relative(REPO_ROOT, OUTPUT_PATH), imageBytesDownloaded: false, authenticationUsed: false, purchasePerformed: false,
  researchOnly: true, trainingReady: false, productionEligible: false,
}, null, 2)}\n`);
