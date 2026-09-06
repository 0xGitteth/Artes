import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.join(REPO_ROOT, '.tmp', 'moderation-research-discovery', 'professional-adult-b2b-public-catalog-v1');
const ADULTLABS_PATH = path.join(ROOT, 'adultlabs-target-scene-source-pools.json');
const VIDEOBUNCH_PATH = path.join(ROOT, 'videobunch-male-female-source-pools.json');
const OUTPUT_PATH = path.join(ROOT, 'balanced-target-scene-preview-refs.json');
const USER_AGENT = 'ArtesModerationResearch/1.0';
const MAX_REFS_PER_POOL = 3;

const TARGET_POOL_COUNTS = {
  male_male: 10,
  solo_male: 6,
  male_female: 10,
};

const PAGE_HOSTS = new Set(['adultlabs.com', 'www.adultlabs.com', 'videobunch.com', 'www.videobunch.com']);
const clean = (value) => String(value || '').trim();
const safeError = (error) => clean(error?.message || error || 'unknown_error').slice(0, 220);
const decodeHtml = (value) => String(value || '')
  .replaceAll('&amp;', '&')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>');

const assertPublicPageUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || !PAGE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('balanced_preview_page_not_allowed');
  }
  return url;
};

const fetchHtml = async (rawUrl) => {
  const requested = assertPublicPageUrl(rawUrl);
  const response = await fetch(requested, {
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`balanced_preview_http_${response.status}`);
  const finalUrl = assertPublicPageUrl(response.url);
  return { html: await response.text(), finalUrl };
};

const normalizeAssetUrl = (raw, pageUrl) => {
  const value = decodeHtml(clean(raw));
  if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('javascript:')) return null;
  let url;
  try { url = new URL(value, pageUrl); } catch { return null; }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') return null;
  url.hash = '';
  if (!/\.(?:jpe?g|png|webp)(?:$|\?)/i.test(url.pathname + url.search)) return null;
  return url;
};

const NEGATIVE_ASSET = /(?:logo|icon|sprite|banner|button|payment|flag|avatar|loader|loading|social|header|footer|favicon|blank|pixel|spacer|captcha|rating|star|badge)/i;
const POSITIVE_ASSET = /(?:preview|sample|screenshot|gallery|photo|image|content|large|full|highres|hires|scene|set|product)/i;

const collectAssetRefs = (html, pageUrl) => {
  const byUrl = new Map();
  const add = (rawUrl, origin, context = '') => {
    const url = normalizeAssetUrl(rawUrl, pageUrl);
    if (!url) return;
    const evidence = `${url.pathname} ${url.search} ${origin} ${context}`;
    if (NEGATIVE_ASSET.test(evidence)) return;
    const key = url.toString();
    const score = (POSITIVE_ASSET.test(evidence) ? 4 : 0)
      + (/\.(?:jpe?g|webp)$/i.test(url.pathname) ? 1 : 0)
      + (/href_image|srcset|data-src|data-original/i.test(origin) ? 1 : 0);
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { assetUrl: key, assetHost: url.hostname.toLowerCase(), origins: [origin], score });
    } else {
      existing.origins = [...new Set([...existing.origins, origin])];
      existing.score = Math.max(existing.score, score);
    }
  };

  for (const match of html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:image(?::url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["'][^>]*>/gi)) {
    add(match[1], 'meta_image');
  }
  for (const match of html.matchAll(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::url)?|twitter:image(?::src)?)["'][^>]*>/gi)) {
    add(match[1], 'meta_image');
  }

  for (const imgMatch of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = imgMatch[0];
    const alt = tag.match(/\balt=["']([^"']*)["']/i)?.[1] || '';
    const title = tag.match(/\btitle=["']([^"']*)["']/i)?.[1] || '';
    const context = `${alt} ${title}`;
    for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-image']) {
      const match = tag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      if (match?.[1]) add(match[1], `img_${attr}`, context);
    }
    for (const attr of ['srcset', 'data-srcset']) {
      const match = tag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      if (!match?.[1]) continue;
      for (const part of match[1].split(',')) add(part.trim().split(/\s+/)[0], `img_${attr}`, context);
    }
  }

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const anchorText = decodeHtml(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 200);
    add(match[1], 'href_image', anchorText);
  }

  return [...byUrl.values()].sort((a, b) => b.score - a.score || a.assetUrl.localeCompare(b.assetUrl));
};

const readResearchJson = async (filePath, expectedStatus) => {
  const value = JSON.parse(await readFile(filePath, 'utf8'));
  if (
    value?.status !== expectedStatus
    || value?.authenticationUsed !== false
    || value?.purchasePerformed !== false
    || value?.sourceIntentIsLabelAuthority !== false
    || value?.researchOnly !== true
    || value?.trainingReady !== false
    || value?.productionEligible !== false
  ) throw new Error(`balanced_preview_input_not_research_safe:${path.basename(filePath)}`);
  return value;
};

const adultLabs = await readResearchJson(ADULTLABS_PATH, 'research_adultlabs_target_scene_source_pool_discovery_only');
const videoBunch = await readResearchJson(VIDEOBUNCH_PATH, 'research_videobunch_male_female_source_pool_discovery_only');

const pools = [];
for (const record of adultLabs.acceptedRecords || []) {
  if (!['male_male', 'solo_male', 'male_female'].includes(record.targetFacet)) continue;
  if (record.targetFacetSupportedByMetadata !== true) continue;
  pools.push({
    sourceId: 'adultlabs_public_catalog',
    sourcePoolId: record.sourcePoolId,
    targetFacet: record.targetFacet,
    setId: record.setId,
    productUrl: record.productUrl,
    previewPageUrl: `https://adultlabs.com/content/screenshots/${record.setId}`,
    studio: 'AdultLabs',
  });
}
for (const record of videoBunch.acceptedRecords || []) {
  if (record.targetFacet !== 'male_female' || record.acceptedForMaleFemaleDiscovery !== true) continue;
  pools.push({
    sourceId: 'videobunch_public_catalog',
    sourcePoolId: record.sourcePoolId,
    targetFacet: record.targetFacet,
    setId: null,
    productUrl: record.productUrl,
    previewPageUrl: record.productUrl,
    studio: record.studio || record.subStudio || null,
  });
}

const poolCounts = pools.reduce((acc, pool) => {
  acc[pool.targetFacet] = (acc[pool.targetFacet] || 0) + 1;
  return acc;
}, {});
for (const [facet, expected] of Object.entries(TARGET_POOL_COUNTS)) {
  if ((poolCounts[facet] || 0) < expected) throw new Error(`balanced_preview_pool_shortage:${facet}`);
}

const records = [];
const failures = [];
for (const pool of pools) {
  try {
    const { html, finalUrl } = await fetchHtml(pool.previewPageUrl);
    const discovered = collectAssetRefs(html, finalUrl);
    const selected = discovered.slice(0, MAX_REFS_PER_POOL);
    records.push({
      ...pool,
      resolvedPreviewPageUrl: finalUrl.toString(),
      discoveredAssetRefCount: discovered.length,
      selectedAssetRefCount: selected.length,
      selectedAssetRefs: selected,
      previewOnly: true,
      sourceIntentIsLabelAuthority: false,
      humanVisualScreeningRequired: true,
      detectorLabel: null,
      imageBytesDownloaded: false,
      authenticationUsed: false,
      purchasePerformed: false,
      researchOnly: true,
      trainingReady: false,
      productionEligible: false,
    });
  } catch (error) {
    failures.push({
      sourceId: pool.sourceId,
      sourcePoolId: pool.sourcePoolId,
      targetFacet: pool.targetFacet,
      previewPageUrl: pool.previewPageUrl,
      error: safeError(error),
    });
  }
}

const selectedRefCount = records.reduce((sum, record) => sum + record.selectedAssetRefCount, 0);
const poolsWithThreeRefs = records.filter((record) => record.selectedAssetRefCount >= MAX_REFS_PER_POOL).length;
const poolsWithAnyRefs = records.filter((record) => record.selectedAssetRefCount > 0).length;
const refsByFacet = records.reduce((acc, record) => {
  acc[record.targetFacet] = (acc[record.targetFacet] || 0) + record.selectedAssetRefCount;
  return acc;
}, {});
const poolsByFacet = records.reduce((acc, record) => {
  acc[record.targetFacet] = (acc[record.targetFacet] || 0) + 1;
  return acc;
}, {});
const assetHostCounts = records.flatMap((record) => record.selectedAssetRefs || []).reduce((acc, ref) => {
  acc[ref.assetHost] = (acc[ref.assetHost] || 0) + 1;
  return acc;
}, {});
const studioCounts = records.reduce((acc, record) => {
  const key = clean(record.studio || 'unknown');
  acc[key] = (acc[key] || 0) + record.selectedAssetRefCount;
  return acc;
}, {});

await mkdir(ROOT, { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify({
  schemaVersion: 1,
  status: 'research_balanced_professional_adult_target_scene_preview_refs_only',
  maxRefsPerPool: MAX_REFS_PER_POOL,
  targetPoolCounts: TARGET_POOL_COUNTS,
  poolCount: pools.length,
  poolCounts,
  processedPoolCount: records.length,
  failedPoolCount: failures.length,
  poolsWithAnyRefs,
  poolsWithThreeRefs,
  selectedRefCount,
  refsByFacet,
  poolsByFacet,
  assetHostCounts,
  studioCounts,
  previewOnly: true,
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
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
  poolCount: pools.length,
  poolCounts,
  processedPoolCount: records.length,
  failedPoolCount: failures.length,
  poolsWithAnyRefs,
  poolsWithThreeRefs,
  selectedRefCount,
  refsByFacet,
  assetHostCounts,
  studioCounts,
  output: path.relative(REPO_ROOT, OUTPUT_PATH),
  imageBytesDownloaded: false,
  authenticationUsed: false,
  purchasePerformed: false,
  researchOnly: true,
  trainingReady: false,
  productionEligible: false,
}, null, 2)}\n`);
